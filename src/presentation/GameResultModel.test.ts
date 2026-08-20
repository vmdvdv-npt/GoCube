import { describe, expect, it } from 'vitest';
import type { EndgameClassification } from '../core/endgame/EndgameClassifier';
import type { GameState } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import type { FinalScore } from '../core/scoring/Scoring';
import { createGameResultModel } from './GameResultModel';

const board = {
  '0,0': 'black',
  '1,0': 'white',
  '2,0': 'empty',
} as const;

const state = (
  moveNumber: number,
  consecutivePasses: number,
  phase: GameState['phase'] = 'playing',
): GameState => ({
  board: { ...board },
  currentPlayer: moveNumber % 2 === 0 ? 'black' : 'white',
  moveNumber,
  consecutivePasses,
  phase,
  captures: { black: 2, white: 1 },
});

const score: FinalScore = {
  ruleSet: 'chinese',
  black: 2,
  white: 8.5,
  komi: 7.5,
  territory: { black: 1, white: 0, neutral: 0, seki: 0 },
  territoryPoints: { black: ['2,0'], white: [], neutral: [], seki: [] },
  stonesOnBoard: { black: 1, white: 1 },
  captures: { black: 2, white: 1 },
  prisoners: null,
  deadStones: { black: 1, white: 0 },
  winner: 'white',
  margin: 6.5,
};

const classification: EndgameClassification = [
  { points: ['0,0'], status: 'dead', source: 'user' },
  { points: ['1,0'], status: 'alive', source: 'user' },
];

const snapshot = (overrides: Partial<GameSessionSnapshot> = {}): GameSessionSnapshot => ({
  version: 1,
  boardSize: 9,
  ruleSet: 'chinese',
  komi: 7.5,
  history: [
    state(0, 0),
    state(1, 0),
    state(2, 1),
    state(3, 0),
    state(4, 1),
    state(5, 2, 'finished'),
  ],
  endgameClassification: classification,
  finalScore: score,
  ...overrides,
});

describe('GameResultModel', () => {
  it('derives result statistics from the persisted session snapshot', () => {
    const result = createGameResultModel(snapshot());

    expect(result).not.toBeNull();
    expect(result?.statistics).toEqual({
      totalActions: 5,
      passes: 3,
      boardSize: 9,
      ruleSet: 'chinese',
      captures: { black: 2, white: 1 },
      deadStones: { black: 1, white: 0 },
      deadGroups: { black: 1, white: 0 },
    });
    expect(result?.score).toEqual(score);
    expect(result?.score).not.toBe(score);
  });

  it('does not mistake a normal move after a pass for another pass', () => {
    expect(createGameResultModel(snapshot())?.statistics.passes).toBe(3);
  });

  it('supports legacy finished saves that predate persisted endgame classification', () => {
    const legacy = snapshot({ endgameClassification: undefined });

    expect(createGameResultModel(legacy)?.statistics.deadGroups).toBeNull();
  });

  it('uses an application fallback for legacy snapshots without boardSize', () => {
    const legacy = snapshot({ boardSize: undefined });

    expect(createGameResultModel(legacy, 13)?.statistics.boardSize).toBe(13);
  });

  it('returns null for unfinished sessions', () => {
    const unfinished = snapshot({
      history: [state(0, 0), state(1, 1, 'playing')],
      endgameClassification: null,
      finalScore: null,
    });

    expect(createGameResultModel(unfinished)).toBeNull();
  });
});
