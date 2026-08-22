import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/GameEngine';
import { TorusTopology } from '../topology/TorusTopology';
import { LinearHistory } from './LinearHistory';

describe('LinearHistory redo', () => {
  it('restores undone snapshots in order', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();
    const first = engine.placeStone(initial, '0,0', 'black');
    if (!first.ok) throw new Error(`Expected first move, got ${first.reason}`);
    const second = engine.placeStone(first.state, '1,0', 'white');
    if (!second.ok) throw new Error(`Expected second move, got ${second.reason}`);

    const history = new LinearHistory(initial);
    history.push(first.state);
    history.push(second.state);

    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toEqual(first.state);
    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toEqual(second.state);
    expect(history.canRedo()).toBe(false);
  });

  it('restores a persisted future stack with the same next-Redo order', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();
    const first = engine.placeStone(initial, '0,0', 'black');
    if (!first.ok) throw new Error(`Expected first move, got ${first.reason}`);
    const second = engine.placeStone(first.state, '1,0', 'white');
    if (!second.ok) throw new Error(`Expected second move, got ${second.reason}`);

    const source = new LinearHistory(initial);
    source.push(first.state);
    source.push(second.state);
    source.undo();
    source.undo();

    const restored = LinearHistory.fromStates(source.states(), source.futureStates());

    expect(restored.current()).toEqual(initial);
    expect(restored.futureStates()).toEqual(source.futureStates());
    expect(restored.redo()).toEqual(first.state);
    expect(restored.redo()).toEqual(second.state);
    expect(restored.canRedo()).toBe(false);
  });

  it('discards the old future after a new action from an undone state', () => {
    const engine = new GameEngine(new TorusTopology(9));
    const initial = engine.createInitialState();
    const first = engine.placeStone(initial, '0,0', 'black');
    if (!first.ok) throw new Error(`Expected first move, got ${first.reason}`);
    const oldSecond = engine.placeStone(first.state, '1,0', 'white');
    if (!oldSecond.ok) throw new Error(`Expected old second move, got ${oldSecond.reason}`);
    const newSecond = engine.placeStone(first.state, '2,0', 'white');
    if (!newSecond.ok) throw new Error(`Expected new second move, got ${newSecond.reason}`);

    const history = new LinearHistory(initial);
    history.push(first.state);
    history.push(oldSecond.state);
    history.undo();
    history.push(newSecond.state);

    expect(history.current()).toEqual(newSecond.state);
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeNull();
  });
});
