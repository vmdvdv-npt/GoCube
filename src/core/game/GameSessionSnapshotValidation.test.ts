import { describe, expect, it } from 'vitest';
import type { EndgameClassifier } from '../endgame/EndgameClassifier';
import type { GameSessionSnapshot } from '../persistence/GameSessionSnapshot';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession, type GameSessionConfig } from './GameSession';

const emptyClassifier: EndgameClassifier = Object.freeze({
  analyze: async () => Object.freeze([]),
});

type MutableState = Record<string, unknown>;
type MutableSnapshot = {
  history: MutableState[];
  redo?: Array<{
    state: MutableState;
    endgameReview?: unknown;
    endgameClassification: unknown;
    finalScore: unknown;
  }>;
};

const setup = () => {
  const topology = new TorusTopology(9);
  const engine = new GameEngine(topology);
  const config: GameSessionConfig = Object.freeze({
    endgameClassifier: emptyClassifier,
    scoringStrategy: new ChineseScoring(topology),
    boardSize: 9,
    komi: 7.5,
  });
  const snapshot = new GameSession(engine, config).snapshot();
  return { engine, config, snapshot };
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
