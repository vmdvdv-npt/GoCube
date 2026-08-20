import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/GameEngine';
import type { GameState } from '../game/types';
import { TorusTopology } from '../topology/TorusTopology';
import { LinearHistory } from './LinearHistory';

describe('LinearHistory', () => {
  it('stores full state snapshots and isolates board data from later mutation', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();
    const mutableBoard = { ...initial.board };
    const state: GameState = {
      ...initial,
      board: mutableBoard,
      currentPlayer: 'white',
      moveNumber: 7,
      consecutivePasses: 1,
      phase: 'playing',
    };
    const history = new LinearHistory(initial);

    history.push(state);
    mutableBoard['4,4'] = 'black';

    expect(history.current()).toMatchObject({
      currentPlayer: 'white',
      moveNumber: 7,
      consecutivePasses: 1,
      phase: 'playing',
    });
    expect(history.current().board['4,4']).toBe('empty');
  });

  it('undoes one snapshot without removing the initial state', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();
    const history = new LinearHistory(initial);
    const move = engine.placeStone(initial, '0,0', 'black');

    if (!move.ok) throw new Error(`Expected accepted move, got ${move.reason}`);
    history.push(move.state);

    expect(history.undo()).toEqual(initial);
    expect(history.length()).toBe(1);
    expect(history.undo()).toBeNull();
  });
});
