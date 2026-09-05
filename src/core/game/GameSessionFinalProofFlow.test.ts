import { describe, expect, it } from 'vitest';
import type {
  EndgameAnalysisContext,
  EndgameClassifier,
  EndgameProposal,
  FinalEndgameAnalysisContext,
  FinalProofSearchProgressListener,
} from '../endgame/EndgameClassifier';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession } from './GameSession';
import type { GameState } from './types';

class FinalRecordingClassifier implements EndgameClassifier {
  analyzeCalls = 0;
  finalCalls = 0;

  constructor(
    private readonly finalStatus: 'alive' | 'dead' | 'seki' | 'unresolved',
  ) {}

  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    this.analyzeCalls += 1;
    return Object.freeze(
      context.groups.map((points) => Object.freeze({ points, status: 'unresolved' as const })),
    );
  }

  async analyzeFinal(
    context: FinalEndgameAnalysisContext,
    onProgress?: FinalProofSearchProgressListener,
  ): Promise<EndgameProposal> {
    this.finalCalls += 1;
    onProgress?.(Object.freeze({
      phase: 'searching',
      totalRegions: context.groups.length,
      completedRegions: 0,
      currentGroupId: null,
      tier: 1,
      resolvedAutomatically: 0,
      remainingUnresolved: context.groups.length,
      nodesExplored: 1,
      elapsedMilliseconds: 1,
    }));
    const proposal = Object.freeze(
      context.groups.map((points) =>
        this.finalStatus === 'unresolved'
          ? Object.freeze({ points, status: 'unresolved' as const })
          : Object.freeze({
              points,
              status: this.finalStatus,
              source: 'automatic' as const,
              evidence: Object.freeze({ algorithm: 'test-final-proof' }),
            }),
      ),
    );
    onProgress?.(Object.freeze({
      phase: 'complete',
      totalRegions: context.groups.length,
      completedRegions: context.groups.length,
      currentGroupId: null,
      tier: 1,
      resolvedAutomatically: this.finalStatus === 'unresolved' ? 0 : context.groups.length,
      remainingUnresolved: this.finalStatus === 'unresolved' ? context.groups.length : 0,
      nodesExplored: 2,
      elapsedMilliseconds: 2,
    }));
    return proposal;
  }
}

const initialWithStone = (engine: GameEngine): GameState => {
  const initial = engine.createInitialState();
  return Object.freeze({
    ...initial,
    board: Object.freeze({ ...initial.board, '0,0': 'black' as const }),
  });
};

const createSession = (classifier: EndgameClassifier) => {
  const topology = new TorusTopology(9);
  const engine = new GameEngine(topology);
  return new GameSession(
    engine,
    Object.freeze({
      endgameClassifier: classifier,
      scoringStrategy: new ChineseScoring(topology),
      komi: 0,
    }),
    initialWithStone(engine),
  );
};

const enterReview = async (session: GameSession): Promise<void> => {
  await session.execute({ type: 'pass' });
  await session.execute({ type: 'pass' });
  expect(session.state().phase).toBe('endgame');
};

describe('GameSession Final Proof Search lifecycle', () => {
  it('runs the expensive pass on Finish and scores immediately when it resolves all groups', async () => {
    const classifier = new FinalRecordingClassifier('alive');
    const session = createSession(classifier);
    const progress: string[] = [];
    await enterReview(session);

    expect(classifier.analyzeCalls).toBe(1);
    expect(classifier.finalCalls).toBe(0);
    expect(session.endgameReview()?.groups[0]?.proposal.status).toBe('unresolved');

    await session.finishEndgameReview((update) => progress.push(update.phase));

    expect(classifier.finalCalls).toBe(1);
    expect(progress).toEqual(['searching', 'complete']);
    expect(session.state().phase).toBe('finished');
    expect(session.snapshot().endgameClassification).toEqual([
      { points: ['0,0'], status: 'alive', source: 'automatic' },
    ]);
  });

  it('stays in review after an incomplete proof and does not rerun search after manual resolution', async () => {
    const classifier = new FinalRecordingClassifier('unresolved');
    const session = createSession(classifier);
    await enterReview(session);

    await session.finishEndgameReview();

    expect(classifier.finalCalls).toBe(1);
    expect(session.state().phase).toBe('endgame');
    expect(session.finalScore()).toBeNull();
    expect(session.endgameReview()?.groups[0]?.proposal.status).toBe('unresolved');

    await session.setEndgameReviewDecision(['0,0'], 'alive');
    await session.finishEndgameReview();

    expect(classifier.finalCalls).toBe(1);
    expect(session.state().phase).toBe('finished');
    expect(session.snapshot().endgameClassification).toEqual([
      { points: ['0,0'], status: 'alive', source: 'user' },
    ]);
  });

  it('preserves an explicit user override when final proof proposes a different status', async () => {
    const classifier = new FinalRecordingClassifier('dead');
    const session = createSession(classifier);
    await enterReview(session);
    await session.setEndgameReviewDecision(['0,0'], 'alive');

    await session.finishEndgameReview();

    expect(classifier.finalCalls).toBe(1);
    expect(session.state().phase).toBe('finished');
    expect(session.snapshot().endgameClassification).toEqual([
      { points: ['0,0'], status: 'alive', source: 'user' },
    ]);
  });
});
