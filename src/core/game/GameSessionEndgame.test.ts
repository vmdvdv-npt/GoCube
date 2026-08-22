import { describe, expect, it } from 'vitest';
import type {
  EndgameAnalysisContext,
  EndgameClassification,
  EndgameClassifier,
  EndgameProposal,
} from '../endgame/EndgameClassifier';
import { ManualEndgameClassifier } from '../endgame/ManualEndgameClassifier';
import { ChineseScoring } from '../scoring/ChineseScoring';
import type { FinalScore, ScoringStrategy } from '../scoring/Scoring';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession, type GameSessionConfig } from './GameSession';
import type { GameState, PointOccupancy } from './types';

class RecordingClassifier implements EndgameClassifier {
  readonly calls: EndgameAnalysisContext[] = [];

  constructor(
    private readonly build: (context: EndgameAnalysisContext) => EndgameProposal,
  ) {}

  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    this.calls.push(context);
    return this.build(context);
  }
}

class RecordingScoring implements ScoringStrategy {
  readonly ruleSet: ScoringStrategy['ruleSet'];
  readonly calls: {
    readonly state: GameState;
    readonly classification: EndgameClassification;
    readonly komi: number;
  }[] = [];

  constructor(private readonly delegate: ScoringStrategy) {
    this.ruleSet = delegate.ruleSet;
  }

  score(
    state: GameState,
    classification: EndgameClassification,
    komi: number,
  ): FinalScore {
    this.calls.push({ state, classification, komi });
    return this.delegate.score(state, classification, komi);
  }
}

const config = (
  endgameClassifier: EndgameClassifier,
  scoringStrategy: ScoringStrategy,
  komi = 0,
): GameSessionConfig => Object.freeze({ endgameClassifier, scoringStrategy, komi });

const makePosition = (
  topology: Topology,
  stones: Readonly<Record<PointId, PointOccupancy>>,
): GameState => {
  const engine = new GameEngine(topology);
  const initial = engine.createInitialState();
  return Object.freeze({
    ...initial,
    board: Object.freeze({ ...initial.board, ...stones }),
  });
};

const unresolvedClassifier = (): EndgameClassifier => new ManualEndgameClassifier();

const resolvedProposal = (
  context: EndgameAnalysisContext,
  status: 'alive' | 'dead' | 'seki' = 'alive',
): EndgameProposal => Object.freeze(
  context.groups.map((points) => Object.freeze({ points, status, source: 'automatic' as const })),
);

describe('GameSession endgame proposal/review flow', () => {
  it('does not start endgame after the first Pass', async () => {
    const topology = new TorusTopology(9);
    const classifier = new RecordingClassifier((context) => resolvedProposal(context));
    const session = new GameSession(
      new GameEngine(topology),
      config(classifier, new ChineseScoring(topology)),
    );

    await session.execute({ type: 'pass' });

    expect(session.state()).toMatchObject({ consecutivePasses: 1, phase: 'playing' });
    expect(classifier.calls).toHaveLength(0);
    expect(session.endgameReview()).toBeNull();
  });

  it('enters ENDGAME_REVIEW after the second Pass without waiting for a UI Promise', async () => {
    const topology = new TorusTopology(9);
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    const session = new GameSession(
      new GameEngine(topology),
      config(unresolvedClassifier(), scoring),
      makePosition(topology, { '0,0': 'black', '4,4': 'white' }),
    );

    await session.execute({ type: 'pass' });
    const secondPass = await session.execute({ type: 'pass' });

    expect(secondPass.ok).toBe(true);
    expect(session.state().phase).toBe('endgame');
    expect(session.endgameReview()).toEqual({
      groups: [
        { points: ['0,0'], proposal: { status: 'unresolved' }, userDecision: null },
        { points: ['4,4'], proposal: { status: 'unresolved' }, userDecision: null },
      ],
    });
    expect(scoring.calls).toHaveLength(0);
  });

  it('manual decisions resolve only their group and can be changed before completion', async () => {
    const topology = new TorusTopology(9);
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    const session = new GameSession(
      new GameEngine(topology),
      config(unresolvedClassifier(), scoring),
      makePosition(topology, { '0,0': 'black', '4,4': 'white' }),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    const revisionBefore = session.snapshot().sessionRevision ?? 0;

    await session.setEndgameReviewDecision(['0,0'], 'alive');
    expect(session.endgameReview()?.groups).toEqual([
      { points: ['0,0'], proposal: { status: 'unresolved' }, userDecision: 'alive' },
      { points: ['4,4'], proposal: { status: 'unresolved' }, userDecision: null },
    ]);
    expect(session.snapshot().sessionRevision).toBeGreaterThan(revisionBefore);

    await session.setEndgameReviewDecision(['0,0'], 'seki');
    expect(session.endgameReview()?.groups[0]?.userDecision).toBe('seki');
    expect(scoring.calls).toHaveLength(0);
  });

  it('physically blocks scoring while any required group is unresolved', async () => {
    const topology = new TorusTopology(9);
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    const session = new GameSession(
      new GameEngine(topology),
      config(unresolvedClassifier(), scoring),
      makePosition(topology, { '0,0': 'black', '4,4': 'white' }),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.setEndgameReviewDecision(['0,0'], 'alive');

    await expect(session.finishEndgameReview()).rejects.toThrow('Endgame review is incomplete');
    expect(session.state().phase).toBe('endgame');
    expect(scoring.calls).toHaveLength(0);
  });

  it('merges automatic proposals with manual fallback and assigns source correctly', async () => {
    const topology = new TorusTopology(9);
    const classifier = new RecordingClassifier((context) => Object.freeze([
      Object.freeze({ points: context.groups[0]!, status: 'alive' as const, source: 'automatic' as const }),
      Object.freeze({ points: context.groups[1]!, status: 'dead' as const, source: 'automatic' as const }),
      Object.freeze({ points: context.groups[2]!, status: 'unresolved' as const }),
    ]));
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    const session = new GameSession(
      new GameEngine(topology),
      config(classifier, scoring),
      makePosition(topology, { '0,0': 'black', '4,4': 'white', '7,7': 'black' }),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    expect(session.state().phase).toBe('endgame');

    await session.setEndgameReviewDecision(['4,4'], 'seki');
    await session.setEndgameReviewDecision(['7,7'], 'alive');
    await session.finishEndgameReview();

    expect(session.state().phase).toBe('finished');
    expect(scoring.calls).toHaveLength(1);
    expect(scoring.calls[0]?.classification).toEqual([
      { points: ['0,0'], status: 'alive', source: 'automatic' },
      { points: ['4,4'], status: 'seki', source: 'user' },
      { points: ['7,7'], status: 'alive', source: 'user' },
    ]);
    expect(session.snapshot().endgameClassification).toEqual(scoring.calls[0]?.classification);
  });

  it('only invokes scoring after a complete classification exists', async () => {
    const topology = new TorusTopology(9);
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    const session = new GameSession(
      new GameEngine(topology),
      config(unresolvedClassifier(), scoring),
      makePosition(topology, { '0,0': 'black' }),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    expect(scoring.calls).toHaveLength(0);

    await session.setEndgameReviewDecision(['0,0'], 'alive');
    expect(scoring.calls).toHaveLength(0);

    await session.finishEndgameReview();
    expect(scoring.calls).toHaveLength(1);
    expect(scoring.calls[0]?.classification).toEqual([
      { points: ['0,0'], status: 'alive', source: 'user' },
    ]);
  });

  it('immediately completes when the proposal is already fully automatic', async () => {
    const topology = new TorusTopology(9);
    const classifier = new RecordingClassifier((context) => resolvedProposal(context, 'alive'));
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    const session = new GameSession(
      new GameEngine(topology),
      config(classifier, scoring, 6.5),
      makePosition(topology, { '0,0': 'black' }),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    expect(session.state().phase).toBe('finished');
    expect(session.endgameReview()).toBeNull();
    expect(scoring.calls).toHaveLength(1);
    expect(scoring.calls[0]?.classification).toEqual([
      { points: ['0,0'], status: 'alive', source: 'automatic' },
    ]);
  });

  it('keeps scoring identical for the same statuses regardless of automatic/user source', () => {
    const topology = new TorusTopology(9);
    const scoring = new ChineseScoring(topology);
    const state = makePosition(topology, { '0,0': 'black', '4,4': 'white' });
    const automatic: EndgameClassification = Object.freeze([
      Object.freeze({ points: ['0,0'], status: 'alive', source: 'automatic' }),
      Object.freeze({ points: ['4,4'], status: 'dead', source: 'automatic' }),
    ]);
    const user: EndgameClassification = Object.freeze([
      Object.freeze({ points: ['0,0'], status: 'alive', source: 'user' }),
      Object.freeze({ points: ['4,4'], status: 'dead', source: 'user' }),
    ]);

    expect(scoring.score(state, automatic, 7.5)).toEqual(scoring.score(state, user, 7.5));
  });

  it.each([
    ['torus', new TorusTopology(9), '0,0'],
    ['cube', new CubeTopology(2), 'front:0:0'],
  ] as const)('runs the same unresolved lifecycle on %s topology', async (_name, topology, point) => {
    const scoring = new RecordingScoring(new ChineseScoring(topology));
    const session = new GameSession(
      new GameEngine(topology),
      config(unresolvedClassifier(), scoring),
      makePosition(topology, { [point]: 'black' }),
    );

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    expect(session.endgameReview()?.groups).toHaveLength(1);
    expect(session.endgameReview()?.groups[0]?.proposal.status).toBe('unresolved');

    await session.setEndgameReviewDecision([point], 'alive');
    await session.finishEndgameReview();
    expect(session.state().phase).toBe('finished');
    expect(scoring.calls).toHaveLength(1);
  });
});
