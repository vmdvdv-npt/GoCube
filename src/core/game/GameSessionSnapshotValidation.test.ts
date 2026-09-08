import { describe, expect, it } from 'vitest';
import type {
  EndgameAnalysisContext,
  EndgameClassifier,
} from '../endgame/EndgameClassifier';
import type { GameSessionSnapshot } from '../persistence/GameSessionSnapshot';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession, type GameSessionConfig } from './GameSession';
import type { GameState } from './types';

const emptyClassifier: EndgameClassifier = Object.freeze({
  analyze: async () => Object.freeze([]),
});

const unresolvedClassifier: EndgameClassifier = Object.freeze({
  analyze: async ({ groups }: EndgameAnalysisContext) =>
    Object.freeze(
      groups.map((points) =>
        Object.freeze({
          points: Object.freeze([...points]),
          status: 'unresolved' as const,
        }),
      ),
    ),
});

const deadClassifier: EndgameClassifier = Object.freeze({
  analyze: async ({ groups }: EndgameAnalysisContext) =>
    Object.freeze(
      groups.map((points) =>
        Object.freeze({
          points: Object.freeze([...points]),
          status: 'dead' as const,
          source: 'automatic' as const,
        }),
      ),
    ),
});

type MutableState = Record<string, unknown>;
type MutableSnapshot = {
  history: MutableState[];
  redo?: Array<{
    state: MutableState;
    endgameReview?: unknown;
    endgameClassification?: unknown;
    finalScore?: unknown;
  }>;
  endgameReview?: unknown;
  endgameClassification?: unknown;
  finalScore?: unknown;
};

const setup = (endgameClassifier: EndgameClassifier = emptyClassifier) => {
  const topology = new TorusTopology(9);
  const engine = new GameEngine(topology);
  const config: GameSessionConfig = Object.freeze({
    endgameClassifier,
    scoringStrategy: new ChineseScoring(topology),
    boardSize: 9,
    komi: 7.5,
  });
  const snapshot = new GameSession(engine, config).snapshot();
  return { engine, config, snapshot };
};

const playKoCapture = async (session: GameSession): Promise<void> => {
  const sequence = [
    '3,4',
    '4,4',
    '5,4',
    '3,5',
    '4,3',
    '5,5',
    '0,0',
    '4,6',
    '4,5',
  ] as const;

  for (const point of sequence) {
    const result = await session.execute({ type: 'place-stone', point });
    expect(result.ok).toBe(true);
  }

  expect(session.state().board['4,4']).toBe('empty');
  expect(session.state().board['4,5']).toBe('black');
};

const corruptCurrentState = (
  snapshot: GameSessionSnapshot,
  mutate: (state: MutableState) => void,
): GameSessionSnapshot => {
  const copy = structuredClone(snapshot) as unknown as MutableSnapshot;
  const state = copy.history.at(-1);
  if (!state) throw new Error('Expected current state');
  mutate(state);
  return copy as unknown as GameSessionSnapshot;
};

const boardOf = (state: MutableState): Record<string, unknown> => {
  const board = state.board;
  if (typeof board !== 'object' || board === null || Array.isArray(board)) {
    throw new Error('Expected board object');
  }
  return board as Record<string, unknown>;
};

const groupsOf = (value: unknown): Array<Record<string, unknown>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected metadata object');
  }
  const groups = (value as Record<string, unknown>).groups;
  if (!Array.isArray(groups)) throw new Error('Expected groups array');
  return groups as Array<Record<string, unknown>>;
};

const scoreOf = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected score object');
  }
  return value as Record<string, unknown>;
};

describe('GameSession persisted GameState validation', () => {
  it('rejects a non-object board before constructing History', () => {
    const { engine, config, snapshot } = setup();
    const corrupted = corruptCurrentState(snapshot, (state) => {
      state.board = null;
    });

    expect(() => GameSession.fromSnapshot(engine, config, corrupted)).toThrow(
      'board must be an object',
    );
  });

  it('requires the exact topology point set', () => {
    const { engine, config, snapshot } = setup();
    const missingPoint = corruptCurrentState(snapshot, (state) => {
      delete boardOf(state)['0,0'];
    });
    const extraPoint = corruptCurrentState(snapshot, (state) => {
      boardOf(state).unexpected = 'empty';
    });

    expect(() => GameSession.fromSnapshot(engine, config, missingPoint)).toThrow(
      'board point set does not match topology',
    );
    expect(() => GameSession.fromSnapshot(engine, config, extraPoint)).toThrow(
      'board point set does not match topology',
    );
  });

  it('rejects invalid occupancy values', () => {
    const { engine, config, snapshot } = setup();
    const corrupted = corruptCurrentState(snapshot, (state) => {
      boardOf(state)['0,0'] = 'blocked';
    });

    expect(() => GameSession.fromSnapshot(engine, config, corrupted)).toThrow(
      'invalid occupancy',
    );
  });

  it('rejects invalid currentPlayer, moveNumber and consecutivePasses', () => {
    const { engine, config, snapshot } = setup();
    const invalidPlayer = corruptCurrentState(snapshot, (state) => {
      state.currentPlayer = 'green';
    });
    const invalidMoveNumber = corruptCurrentState(snapshot, (state) => {
      state.moveNumber = -1;
    });
    const invalidPasses = corruptCurrentState(snapshot, (state) => {
      state.moveNumber = 2;
      state.consecutivePasses = 2;
    });

    expect(() => GameSession.fromSnapshot(engine, config, invalidPlayer)).toThrow(
      'invalid current player',
    );
    expect(() => GameSession.fromSnapshot(engine, config, invalidMoveNumber)).toThrow(
      'invalid move number',
    );
    expect(() => GameSession.fromSnapshot(engine, config, invalidPasses)).toThrow(
      'phase is inconsistent with consecutive passes',
    );
  });

  it('rejects malformed or negative capture counters', () => {
    const { engine, config, snapshot } = setup();
    const missingCaptures = corruptCurrentState(snapshot, (state) => {
      state.captures = null;
    });
    const negativeCapture = corruptCurrentState(snapshot, (state) => {
      state.captures = { black: -1, white: 0 };
    });

    expect(() => GameSession.fromSnapshot(engine, config, missingCaptures)).toThrow(
      'invalid capture counters',
    );
    expect(() => GameSession.fromSnapshot(engine, config, negativeCapture)).toThrow(
      'invalid capture counters',
    );
  });

  it('validates non-current history states, not only the current state', async () => {
    const { engine, config } = setup();
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    const copy = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    copy.history[0]!.captures = null;

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Saved history state 0 has invalid capture counters');
  });

  it('validates every Redo state before restoring the Redo stack', () => {
    const { engine, config, snapshot } = setup();
    const copy = structuredClone(snapshot) as unknown as MutableSnapshot;
    const redoState = structuredClone(copy.history[0]!);
    boardOf(redoState)['0,0'] = 'invalid';
    copy.redo = [
      {
        state: redoState,
        endgameClassification: null,
        finalScore: null,
      },
    ];

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Saved Redo state 0 has invalid occupancy');
  });
});

describe('GameSession persisted History transition validation', () => {
  it('requires the first persisted state to exactly match GameEngine initial state', () => {
    const { engine, config, snapshot } = setup();
    const copy = structuredClone(snapshot) as unknown as MutableSnapshot;
    boardOf(copy.history[0]!)['0,0'] = 'black';

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Saved history state 0 does not match GameEngine initial state');
  });

  it('rejects a structurally valid but impossible board transition', async () => {
    const { engine, config } = setup();
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });

    const copy = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    boardOf(copy.history.at(-1)!)['1,1'] = 'black';

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Saved history transition 0 -> 1 is impossible');
  });

  it('rejects a tampered previous board that would change Simple Ko', async () => {
    const { engine, config } = setup();
    const session = new GameSession(engine, config);
    await playKoCapture(session);

    const snapshot = session.snapshot();
    const truePrevious = snapshot.history.at(-2);
    const captureState = snapshot.history.at(-1);
    if (!truePrevious || !captureState) throw new Error('Expected ko history states');

    const trueRecapture = engine.placeStone(captureState, '4,4', 'white', {
      previousBoard: truePrevious.board,
    });
    expect(trueRecapture.ok).toBe(false);
    if (trueRecapture.ok) throw new Error('Expected Simple Ko rejection');
    expect(trueRecapture.reason).toBe('repetition');

    const copy = structuredClone(snapshot) as unknown as MutableSnapshot;
    const tamperedPrevious = copy.history.at(-2);
    if (!tamperedPrevious) throw new Error('Expected previous state');
    boardOf(tamperedPrevious)['0,1'] = 'black';

    const recaptureWithTamperedContext = engine.placeStone(captureState, '4,4', 'white', {
      previousBoard: boardOf(tamperedPrevious) as GameState['board'],
    });
    expect(recaptureWithTamperedContext.ok).toBe(true);

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Saved history transition');
  });

  it('accepts valid placement, capture and Pass history', async () => {
    const { engine, config } = setup();
    const session = new GameSession(engine, config);
    await playKoCapture(session);
    await session.execute({ type: 'pass' });

    const snapshot = session.snapshot();
    const restored = GameSession.fromSnapshot(engine, config, snapshot);

    expect(restored.snapshot()).toEqual(snapshot);
    expect(restored.state()).toEqual(session.state());
  });

  it('replays Redo in actual stack order and rejects a damaged Redo transition', async () => {
    const { engine, config } = setup();
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'place-stone', point: '1,1' });
    await session.execute({ type: 'place-stone', point: '2,2' });
    await session.executeSessionCommand({ type: 'undo' });
    await session.executeSessionCommand({ type: 'undo' });

    const snapshot = session.snapshot();
    expect(() => GameSession.fromSnapshot(engine, config, snapshot)).not.toThrow();

    const copy = structuredClone(snapshot) as unknown as MutableSnapshot;
    const laterRedoTarget = copy.redo?.[0];
    if (!laterRedoTarget) throw new Error('Expected two-step Redo future');
    boardOf(laterRedoTarget.state)['3,3'] = 'black';

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Saved Redo transition to stack entry 0');
  });

  it('accepts a valid finished snapshot produced by second Pass and endgame completion', async () => {
    const { engine, config } = setup();
    const session = new GameSession(engine, config);
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.finishEndgameReview();

    const snapshot = session.snapshot();
    expect(snapshot.history.at(-1)?.phase).toBe('finished');

    const restored = GameSession.fromSnapshot(engine, config, snapshot);
    expect(restored.state()).toEqual(session.state());
    expect(restored.snapshot()).toEqual(snapshot);
  });
});

describe('GameSession persisted session metadata validation', () => {
  it('rejects an endgame review point that is not a stone in the associated state', async () => {
    const { engine, config } = setup(unresolvedClassifier);
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    const copy = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    groupsOf(copy.endgameReview)[0]!.points = ['1,1'];

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('contains a point that is not a stone: 1,1');
  });

  it('rejects a partial persisted group even when every listed point is a stone', async () => {
    const { engine, config } = setup(unresolvedClassifier);
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'place-stone', point: '4,4' });
    await session.execute({ type: 'place-stone', point: '0,1' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    const copy = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    const blackGroup = groupsOf(copy.endgameReview).find((group) =>
      Array.isArray(group.points) && group.points.includes('0,0'),
    );
    if (!blackGroup) throw new Error('Expected black endgame group');
    blackGroup.points = ['0,0'];

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('does not match all logical stone groups exactly once');
  });

  it('rejects an endgame classification that does not describe the finished board groups', async () => {
    const { engine, config } = setup(deadClassifier);
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.finishEndgameReview();

    const copy = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    if (!Array.isArray(copy.endgameClassification)) {
      throw new Error('Expected endgame classification');
    }
    (copy.endgameClassification[0] as Record<string, unknown>).points = ['1,1'];

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('contains a point that is not a stone: 1,1');
  });

  it('rejects malformed persisted classification status and source', async () => {
    const { engine, config } = setup(deadClassifier);
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.finishEndgameReview();

    const invalidStatus = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    const invalidSource = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    if (!Array.isArray(invalidStatus.endgameClassification)) {
      throw new Error('Expected endgame classification');
    }
    if (!Array.isArray(invalidSource.endgameClassification)) {
      throw new Error('Expected endgame classification');
    }
    (invalidStatus.endgameClassification[0] as Record<string, unknown>).status = 'unknown';
    (invalidSource.endgameClassification[0] as Record<string, unknown>).source = 'storage';

    expect(() =>
      GameSession.fromSnapshot(
        engine,
        config,
        invalidStatus as unknown as GameSessionSnapshot,
      ),
    ).toThrow('has invalid status');
    expect(() =>
      GameSession.fromSnapshot(
        engine,
        config,
        invalidSource as unknown as GameSessionSnapshot,
      ),
    ).toThrow('has invalid source');
  });

  it('rejects a persisted FinalScore that differs from authoritative rescoring', async () => {
    const { engine, config } = setup(deadClassifier);
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.finishEndgameReview();

    const copy = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    const score = scoreOf(copy.finalScore);
    score.black = (score.black as number) + 100;
    score.winner = 'black';

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Saved FinalScore for current saved state does not match recomputed score');
  });

  it('validates endgame/result metadata in the Redo future too', async () => {
    const { engine, config } = setup(deadClassifier);
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.finishEndgameReview();
    await session.executeSessionCommand({ type: 'undo' });

    const copy = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    const redo = copy.redo?.[0];
    if (!redo) throw new Error('Expected finished Redo entry');
    const score = scoreOf(redo.finalScore);
    score.margin = (score.margin as number) + 1;

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Saved FinalScore for saved Redo state 0 does not match recomputed score');
  });

  it('fails closed for legacy finished snapshots that lack authoritative classification', async () => {
    const { engine, config } = setup(deadClassifier);
    const session = new GameSession(engine, config);
    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.finishEndgameReview();

    const copy = structuredClone(session.snapshot()) as unknown as MutableSnapshot;
    copy.endgameClassification = null;

    expect(() =>
      GameSession.fromSnapshot(engine, config, copy as unknown as GameSessionSnapshot),
    ).toThrow('Finished current saved state must include endgame classification');
  });
});