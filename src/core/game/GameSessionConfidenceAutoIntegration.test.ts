import { describe, expect, it } from 'vitest';
import type {
  EndgameAnalysisContext,
  EndgameClassifier,
  EndgameProposal,
  GroupStatus,
} from '../endgame/EndgameClassifier';
import {
  ConfidenceAutoEndgameClassifier,
  type ConfidenceAutoEndgameClassifierDependencies,
} from '../endgame/ConfidenceAutoEndgameClassifier';
import { classifyPositionConfidence } from '../endgame/EndgameConfidenceClassifier';
import {
  selectAutomaticPositionStatuses,
  type EndgameConfidenceAutoPositionSelectionResult,
  type EndgameConfidenceAutoSelectionResult,
} from '../endgame/EndgameConfidenceAutoSelector';
import { buildEndgameGraph } from '../endgame/EndgameGraphCore';
import { endgameGroupId } from '../endgame/EndgameGroupIdentity';
import {
  buildEngine2ConfidenceCorpus,
  type Engine2ConfidenceCorpusCase,
} from '../endgame/testlab/Engine2ConfidenceCorpus';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { JapaneseScoring } from '../scoring/JapaneseScoring';
import type { ScoringStrategy } from '../scoring/Scoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession, type GameSessionConfig } from './GameSession';
import type { GameState } from './types';

const corpus = buildEngine2ConfidenceCorpus();

const corpusCase = (id: string): Engine2ConfidenceCorpusCase => {
  const found = corpus.find((item) => item.id === id);
  if (!found) throw new Error(`Missing E2-12d fixture: ${id}`);
  return found;
};

const scoringFor = (
  ruleSet: 'chinese' | 'japanese',
  fixture: Engine2ConfidenceCorpusCase,
): ScoringStrategy => ruleSet === 'chinese'
  ? new ChineseScoring(fixture.topology)
  : new JapaneseScoring(fixture.topology);

const sessionConfig = (
  classifier: EndgameClassifier,
  scoring: ScoringStrategy,
  komi = 0,
): GameSessionConfig => Object.freeze({ endgameClassifier: classifier, scoringStrategy: scoring, komi });

const targetGroupId = (fixture: Engine2ConfidenceCorpusCase): string => {
  const graph = buildEndgameGraph(fixture.state, fixture.topology);
  const key = graph.pointOwner.get(fixture.targetPoint);
  if (!key) throw new Error(`Missing target group for ${fixture.id}`);
  return key;
};

const alternateStatus = (status: GroupStatus): GroupStatus =>
  status === 'alive' ? 'dead' : 'alive';

const reviewFixture = async (
  id: string,
  ruleSet: 'chinese' | 'japanese' = 'chinese',
  classifier: EndgameClassifier = new ConfidenceAutoEndgameClassifier(),
  komi = 0,
) => {
  const fixture = corpusCase(id);
  const session = new GameSession(
    new GameEngine(fixture.topology),
    sessionConfig(classifier, scoringFor(ruleSet, fixture), komi),
    fixture.state,
  );
  await session.resumeEndgame();
  return Object.freeze({ fixture, session, groupId: targetGroupId(fixture) });
};

const technicalFailureDependencies = (): ConfidenceAutoEndgameClassifierDependencies => Object.freeze({
  classifyPosition: classifyPositionConfidence,
  selectPosition: (position) => {
    const selected = selectAutomaticPositionStatuses(position);
    const first = selected.decisions[0];
    if (!first) throw new Error('Expected confidence selector decision');
    const failure: EndgameConfidenceAutoSelectionResult = Object.freeze({
      outcome: 'technical-failure' as const,
      selectorAlgorithm: selected.selectorAlgorithm,
      sourceAlgorithm: first.sourceAlgorithm,
      groupKey: first.groupKey,
      rawLabel: first.rawLabel,
      failure: 'invalid-input' as const,
      reasons: Object.freeze(['synthetic-e2-12d-session-failure']),
      scores: first.scores,
      diagnostics: Object.freeze({
        additionalGraphBuilds: 0 as const,
        additionalConfidenceAnalyses: 0 as const,
        deepProofSearchInvocations: 0 as const,
      }),
    });
    const result: EndgameConfidenceAutoPositionSelectionResult = Object.freeze({
      ...selected,
      decisions: Object.freeze([failure, ...selected.decisions.slice(1)]),
      diagnostics: Object.freeze({
        ...selected.diagnostics,
        automaticSelections: selected.diagnostics.automaticSelections - 1,
        technicalFailures: selected.diagnostics.technicalFailures + 1,
      }),
    });
    return result;
  },
});

const torusPlayingState = (engine: GameEngine): GameState => {
  const initial = engine.createInitialState();
  return Object.freeze({
    ...initial,
    board: Object.freeze({ ...initial.board, '0,0': 'black', '4,4': 'white' }),
    moveNumber: 2,
  });
};

describe('E2-12d GameSession application integration', () => {
  it('creates resolved automatic proposals, permits immediate finish, and keeps source=automatic without overrides', async () => {
    const { session } = await reviewFixture('ambiguous-three-liberty-contact');
    const review = session.endgameReview();
    expect(review).not.toBeNull();
    expect(review?.groups.every((group) => group.proposal.status !== 'unresolved')).toBe(true);
    expect(review?.groups.some((group) => group.proposal.evidence?.rawLabel === 'unresolved')).toBe(true);

    await session.finishEndgameReview();
    expect(session.state().phase).toBe('finished');
    expect(session.snapshot().endgameClassification?.every((group) => group.source === 'automatic')).toBe(true);
  });

  it('lets the player override any automatic result repeatedly without mutating its proposal', async () => {
    const { session, groupId } = await reviewFixture('one-liberty-strict-dead');
    const before = session.endgameReview()?.groups.find((group) => endgameGroupId(group.points) === groupId);
    expect(before?.proposal.status).toBe('dead');
    expect(before?.proposal.evidence).toMatchObject({ mode: 'strict-proof' });

    await session.setEndgameReviewDecision(before!.points, 'alive');
    await session.setEndgameReviewDecision(before!.points, 'seki');
    const changed = session.endgameReview()?.groups.find((group) => endgameGroupId(group.points) === groupId);
    expect(changed?.proposal.status).toBe('dead');
    expect(changed?.userDecision).toBe('seki');

    await session.finishEndgameReview();
    expect(session.snapshot().endgameClassification).toContainEqual(
      expect.objectContaining({ points: before!.points, status: 'seki', source: 'user' }),
    );
  });

  it('blocks Finish scoring only for selector technical failure and becomes finishable after a manual decision', async () => {
    const classifier = new ConfidenceAutoEndgameClassifier(technicalFailureDependencies());
    const { session } = await reviewFixture('torus9-isolated-open-space', 'chinese', classifier);
    const failed = session.endgameReview()?.groups.find((group) => group.proposal.status === 'unresolved');
    expect(failed?.proposal.evidence).toMatchObject({
      outcome: 'technical-failure',
      failure: 'invalid-input',
    });

    await expect(session.finishEndgameReview()).rejects.toThrow('Missing manual endgame decision');
    await session.setEndgameReviewDecision(failed!.points, 'alive');
    await session.finishEndgameReview();
    expect(session.snapshot().endgameClassification).toContainEqual(
      expect.objectContaining({ points: failed!.points, status: 'alive', source: 'user' }),
    );
  });

  it('persists proposal + override and restores Undo/Redo metadata without re-analysis', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    let analysisCalls = 0;
    const dependencies: ConfidenceAutoEndgameClassifierDependencies = Object.freeze({
      classifyPosition: (state, logicalTopology) => {
        analysisCalls += 1;
        return classifyPositionConfidence(state, logicalTopology);
      },
      selectPosition: selectAutomaticPositionStatuses,
    });
    const config = sessionConfig(
      new ConfidenceAutoEndgameClassifier(dependencies),
      new ChineseScoring(topology),
      6.5,
    );
    const session = new GameSession(engine, config, torusPlayingState(engine));

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    expect(analysisCalls).toBe(1);
    const first = session.endgameReview()!.groups[0]!;
    const override = alternateStatus(first.proposal.status as GroupStatus);
    await session.setEndgameReviewDecision(first.points, override);
    const reviewBefore = session.endgameReview();
    const snapshot = session.snapshot();

    let restoredAnalysisCalls = 0;
    const restored = GameSession.fromSnapshot(
      new GameEngine(topology),
      sessionConfig(
        new ConfidenceAutoEndgameClassifier(Object.freeze({
          classifyPosition: (state, logicalTopology) => {
            restoredAnalysisCalls += 1;
            return classifyPositionConfidence(state, logicalTopology);
          },
          selectPosition: selectAutomaticPositionStatuses,
        })),
        new ChineseScoring(topology),
        6.5,
      ),
      snapshot,
    );
    expect(restoredAnalysisCalls).toBe(0);
    expect(restored.endgameReview()).toEqual(reviewBefore);

    await session.executeSessionCommand({ type: 'undo' });
    expect(session.state().phase).toBe('playing');
    expect(session.endgameReview()).toBeNull();
    expect(analysisCalls).toBe(1);

    await session.executeSessionCommand({ type: 'redo' });
    expect(session.state().phase).toBe('endgame');
    expect(session.endgameReview()).toEqual(reviewBefore);
    expect(analysisCalls).toBe(1);
  });

  it('does not install a stale analysis result after the endgame state changes', async () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    let capturedContext: EndgameAnalysisContext | null = null;
    let resolveAnalysis: ((proposal: EndgameProposal) => void) | null = null;
    const classifier: EndgameClassifier = Object.freeze({
      analyze: (context: EndgameAnalysisContext) => {
        capturedContext = context;
        return new Promise<EndgameProposal>((resolve) => {
          resolveAnalysis = resolve;
        });
      },
    });
    const session = new GameSession(
      engine,
      sessionConfig(classifier, new ChineseScoring(topology)),
      torusPlayingState(engine),
    );

    await session.execute({ type: 'pass' });
    const pendingSecondPass = session.execute({ type: 'pass' });
    await Promise.resolve();
    expect(capturedContext).not.toBeNull();

    await session.executeSessionCommand({ type: 'undo' });
    const context = capturedContext!;
    resolveAnalysis!(Object.freeze(
      context.groups.map((points) => Object.freeze({
        points,
        status: 'alive' as const,
        source: 'automatic' as const,
      })),
    ));

    await expect(pendingSecondPass).rejects.toThrow('Endgame state changed while analysis was pending');
    expect(session.state().phase).toBe('playing');
    expect(session.endgameReview()).toBeNull();
  });
});

describe('E2-12d scoring handoff', () => {
  it('routes automatic dead and player dead→alive override through Chinese scoring', async () => {
    const automatic = await reviewFixture('one-liberty-strict-dead', 'chinese');
    const automaticTarget = automatic.session.endgameReview()!.groups.find(
      (group) => endgameGroupId(group.points) === automatic.groupId,
    )!;
    expect(automaticTarget.proposal.status).toBe('dead');
    await automatic.session.finishEndgameReview();
    const automaticScore = automatic.session.finalScore()!;

    const overridden = await reviewFixture('one-liberty-strict-dead', 'chinese');
    const overrideTarget = overridden.session.endgameReview()!.groups.find(
      (group) => endgameGroupId(group.points) === overridden.groupId,
    )!;
    await overridden.session.setEndgameReviewDecision(overrideTarget.points, 'alive');
    await overridden.session.finishEndgameReview();
    const overrideScore = overridden.session.finalScore()!;

    expect(automaticScore.deadStones.white).toBe(1);
    expect(overrideScore.deadStones.white).toBe(0);
    expect(automaticScore.stonesOnBoard.white).toBeLessThan(overrideScore.stonesOnBoard.white);
    expect(automaticScore).not.toEqual(overrideScore);
  });

  it('routes automatic dead and player dead→alive override through Japanese prisoner semantics', async () => {
    const automatic = await reviewFixture('one-liberty-strict-dead', 'japanese', undefined, 6.5);
    await automatic.session.finishEndgameReview();
    const automaticScore = automatic.session.finalScore()!;

    const overridden = await reviewFixture('one-liberty-strict-dead', 'japanese', undefined, 6.5);
    const target = overridden.session.endgameReview()!.groups.find(
      (group) => endgameGroupId(group.points) === overridden.groupId,
    )!;
    await overridden.session.setEndgameReviewDecision(target.points, 'alive');
    await overridden.session.finishEndgameReview();
    const overrideScore = overridden.session.finalScore()!;

    expect(automaticScore.deadStones.white).toBe(1);
    expect(automaticScore.prisoners?.black).toBe(1);
    expect(overrideScore.deadStones.white).toBe(0);
    expect(overrideScore.prisoners?.black).toBe(0);
    expect(automaticScore.captures).toEqual(overrideScore.captures);
    expect(automaticScore.komi).toBe(6.5);
    expect(overrideScore.komi).toBe(6.5);
  });

  it('uses the identical seki-neutral scoring path for automatic and manual seki', async () => {
    const automatic = await reviewFixture('strict-seki-black', 'chinese');
    await automatic.session.finishEndgameReview();
    const automaticScore = automatic.session.finalScore()!;
    expect(automaticScore.territory.seki).toBeGreaterThan(0);
    expect(automaticScore.deadStones).toEqual({ black: 0, white: 0 });

    const manual = await reviewFixture('strict-seki-black', 'chinese');
    const target = manual.session.endgameReview()!.groups.find(
      (group) => endgameGroupId(group.points) === manual.groupId,
    )!;
    expect(target.proposal.status).toBe('seki');
    await manual.session.setEndgameReviewDecision(target.points, 'seki');
    await manual.session.finishEndgameReview();

    expect(manual.session.finalScore()).toEqual(automaticScore);
    expect(manual.session.snapshot().endgameClassification).toContainEqual(
      expect.objectContaining({ points: target.points, status: 'seki', source: 'user' }),
    );
  });
});
