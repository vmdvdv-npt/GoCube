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

  current(): GameState {
    return this.snapshots[this.snapshots.length - 1];
  }

  push(state: GameState): GameState {
    const snapshot = snapshotState(state);
    this.snapshots.push(snapshot);
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
