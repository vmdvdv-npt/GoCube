import type { GameState } from '../game/types';
import type { SimpleKoContext } from '../rules/SimpleKoPolicy';

const snapshotState = (state: GameState): GameState =>
  Object.freeze({
    ...state,
    board: Object.freeze({ ...state.board }),
    captures: Object.freeze({ ...state.captures }),
  });

export class LinearHistory {
  private readonly snapshots: GameState[];
  private readonly futureSnapshots: GameState[] = [];

  constructor(initialState: GameState) {
    this.snapshots = [snapshotState(initialState)];
  }

  static fromStates(
    states: readonly GameState[],
    futureStates: readonly GameState[] = [],
  ): LinearHistory {
    const [initialState, ...rest] = states;
    if (!initialState) throw new Error('History must contain at least one state');

    const history = new LinearHistory(initialState);
    for (const state of rest) history.push(state);
    history.futureSnapshots.push(...futureStates.map(snapshotState));
    return history;
  }

  current(): GameState {
    return this.snapshots[this.snapshots.length - 1];
  }

  push(state: GameState): GameState {
    const snapshot = snapshotState(state);
    this.snapshots.push(snapshot);
    this.futureSnapshots.length = 0;
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

    const future = this.snapshots.pop();
    if (future) this.futureSnapshots.push(future);
    return this.current();
  }

  redo(): GameState | null {
    const next = this.futureSnapshots.pop();
    if (!next) return null;

    this.snapshots.push(next);
    return this.current();
  }

  canUndo(): boolean {
    return this.snapshots.length > 1;
  }

  canRedo(): boolean {
    return this.futureSnapshots.length > 0;
  }

  length(): number {
    return this.snapshots.length;
  }

  states(): readonly GameState[] {
    return Object.freeze([...this.snapshots]);
  }

  /** Internal stack order: the last state is the next state returned by redo(). */
  futureStates(): readonly GameState[] {
    return Object.freeze([...this.futureSnapshots]);
  }

  simpleKoContext(): SimpleKoContext {
    const previousState = this.snapshots[this.snapshots.length - 2];
    return Object.freeze({ previousBoard: previousState?.board ?? null });
  }
}
