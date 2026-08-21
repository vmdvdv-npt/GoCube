import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import { PresentationModel, type PresentationSessionSource } from './PresentationModel';

const state = (
  board: GameState['board'],
  overrides: Partial<Omit<GameState, 'board'>> = {},
): GameState => ({
  board,
  currentPlayer: 'black',
  moveNumber: 0,
  consecutivePasses: 0,
  phase: 'playing',
  captures: { black: 0, white: 0 },
  ...overrides,
});

const snapshot = (history: readonly GameState[]): GameSessionSnapshot => ({
  version: 1,
  boardSize: 9,
  ruleSet: 'chinese',
  komi: 7.5,
  history,
  finalScore: null,
});

const source = (history: readonly GameState[]): PresentationSessionSource => ({
  state: () => history[history.length - 1]!,
  snapshot: () => snapshot(history),
});

describe('PresentationModel stone action metadata', () => {
  it('keeps pass numbers as gaps and leaves the marker on the last placed stone', () => {
    const initial = state({ '0,0': 'empty', '1,0': 'empty', '2,0': 'empty' });
    const move1 = state(
      { '0,0': 'black', '1,0': 'empty', '2,0': 'empty' },
      { currentPlayer: 'white', moveNumber: 1 },
    );
    const pass2 = state(
      { '0,0': 'black', '1,0': 'empty', '2,0': 'empty' },
      { currentPlayer: 'black', moveNumber: 2, consecutivePasses: 1 },
    );
    const move3 = state(
      { '0,0': 'black', '1,0': 'black', '2,0': 'empty' },
      { currentPlayer: 'white', moveNumber: 3 },
    );
    const pass4 = state(
      { '0,0': 'black', '1,0': 'black', '2,0': 'empty' },
      { currentPlayer: 'black', moveNumber: 4, consecutivePasses: 1 },
    );

    const view = new PresentationModel().fromSession(
      source([initial, move1, pass2, move3, pass4]),
    );

    expect(view.lastMovePointId).toBe('1,0');
    expect(view.points).toEqual([
      { logicalPointId: '0,0', occupancy: 'black', moveNumber: 1 },
      { logicalPointId: '1,0', occupancy: 'black', moveNumber: 3 },
      { logicalPointId: '2,0', occupancy: 'empty', moveNumber: null },
    ]);
  });

  it('drops numbers for captured stones and follows an undone history snapshot', () => {
    const initial = state({ '0,0': 'empty', '1,0': 'empty', '2,0': 'empty' });
    const move1 = state(
      { '0,0': 'black', '1,0': 'empty', '2,0': 'empty' },
      { currentPlayer: 'white', moveNumber: 1 },
    );
    const move2 = state(
      { '0,0': 'black', '1,0': 'white', '2,0': 'empty' },
      { currentPlayer: 'black', moveNumber: 2 },
    );
    const move3WithCapture = state(
      { '0,0': 'empty', '1,0': 'white', '2,0': 'black' },
      { currentPlayer: 'white', moveNumber: 3, captures: { black: 0, white: 1 } },
    );

    const afterCapture = new PresentationModel().fromSession(
      source([initial, move1, move2, move3WithCapture]),
    );
    expect(afterCapture.lastMovePointId).toBe('2,0');
    expect(afterCapture.points).toEqual([
      { logicalPointId: '0,0', occupancy: 'empty', moveNumber: null },
      { logicalPointId: '1,0', occupancy: 'white', moveNumber: 2 },
      { logicalPointId: '2,0', occupancy: 'black', moveNumber: 3 },
    ]);

    const afterUndo = new PresentationModel().fromSession(source([initial, move1, move2]));
    expect(afterUndo.lastMovePointId).toBe('1,0');
    expect(afterUndo.points.find((point) => point.logicalPointId === '0,0')?.moveNumber).toBe(1);
    expect(afterUndo.points.find((point) => point.logicalPointId === '1,0')?.moveNumber).toBe(2);
  });
});
