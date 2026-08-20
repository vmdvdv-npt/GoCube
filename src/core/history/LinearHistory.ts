import type { GameState } from '../game/types';
import type { RepetitionContext } from '../rules/RepetitionPolicy';

const snapshotState = (state: GameState): GameState =>
  Object.freeze({
    ...state,
    board: Object.freeze({ ...state.board }),
    captures: Object.freeze({ ...state.captures }),
  });

export class LinearHistory {
  private readonly snapshots: GameState[];

  constructor(initialState: GameState) {
    this.snapshots = [snapshotState(initialState)];
  }

  static fromStates(states: readonly GameState[]): LinearHistory {
    const [initialState, ...rest] = states;
    if (!initialState) throw new Error('History must contain at least one state');

    const history = new LinearHistory(initialState);
    for (const state of rest) history.push(state);
    return history;
  }

  current(): GameState {
    return this.snapshots[this.snapshots.length - 1];
  }

  push(state: GameState): GameState {
    const snapshot = snapshotState(state);
    this.snapshots.push(snapshot);
    return snapshot;
  }

  replaceCurrent(state: GameState): GameState {
    const snapshot = snapshotState(state);
    this.snapshots[this.snapshots.length - 1] = snapshot;
    return snapshot;
  }

  undo(): GameState | null {
    if (this.snapshots.length <= 1) {
      return null;
    }

    this.snapshots.pop();
    return this.current();
  }

  length(): number {
    return this.snapshots.length;
  }

  states(): readonly GameState[] {
    return Object.freeze([...this.snapshots]);
  }

  repetitionContext(): RepetitionContext {
    return Object.freeze({ states: this.states() });
  }
}
