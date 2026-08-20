import { describe, expect, it } from 'vitest';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import type { GameState } from './types';

describe('GameEngine capture counters', () => {
  it('starts at zero and increments the capturing color without any rule-set branch', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();
    const board = { ...initial.board };
    board['3,4'] = 'black';
    board['5,4'] = 'black';
    board['4,3'] = 'black';
    board['4,4'] = 'white';
    const state: GameState = Object.freeze({
      ...initial,
      board: Object.freeze(board),
      currentPlayer: 'black',
    });

    expect(initial.captures).toEqual({ black: 0, white: 0 });

    const result = engine.placeStone(state, '4,5', 'black');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Expected accepted move, got ${result.reason}`);

    expect(result.captured).toEqual(['4,4']);
    expect(result.state.captures).toEqual({ black: 1, white: 0 });
  });

  it('preserves capture counters through Pass', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const state: GameState = Object.freeze({
      ...engine.createInitialState(),
      captures: Object.freeze({ black: 4, white: 2 }),
    });

    const pass = engine.pass(state);
    expect(pass.ok).toBe(true);
    if (!pass.ok) throw new Error('Expected accepted pass');

    expect(pass.state.captures).toEqual({ black: 4, white: 2 });
  });
});
