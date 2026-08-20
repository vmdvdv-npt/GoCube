import { LinearHistory } from '../history/LinearHistory';
import type { RepetitionPolicy } from '../rules/RepetitionPolicy';
import type { PointId } from '../topology/Topology';
import {
  GameEngine,
  type MoveRejectionReason,
} from './GameEngine';
import type { GameState, StoneColor } from './types';

export type GameCommand =
  | Readonly<{ type: 'place-stone'; point: PointId }>
  | Readonly<{ type: 'pass' }>
  | Readonly<{ type: 'undo' }>;

export type GameSessionRejectionReason = MoveRejectionReason | 'nothing-to-undo';

export interface AcceptedPlaceStoneSessionResult {
  readonly ok: true;
  readonly action: 'place-stone';
  readonly state: GameState;
  readonly captured: readonly PointId[];
}

export interface AcceptedPassSessionResult {
  readonly ok: true;
  readonly action: 'pass';
  readonly state: GameState;
  readonly passedBy: StoneColor;
}

export interface AcceptedUndoSessionResult {
  readonly ok: true;
  readonly action: 'undo';
  readonly state: GameState;
}

export interface RejectedGameSessionResult {
  readonly ok: false;
  readonly state: GameState;
  readonly reason: GameSessionRejectionReason;
}

export type GameSessionResult =
  | AcceptedPlaceStoneSessionResult
  | AcceptedPassSessionResult
  | AcceptedUndoSessionResult
  | RejectedGameSessionResult;

export class GameSession {
  private readonly history: LinearHistory;

  constructor(
    private readonly engine: GameEngine,
    private readonly repetitionPolicy: RepetitionPolicy,
    initialState: GameState = engine.createInitialState(),
  ) {
    this.history = new LinearHistory(initialState);
  }

  state(): GameState {
    return this.history.current();
  }

  historyLength(): number {
    return this.history.length();
  }

  execute(command: GameCommand): GameSessionResult {
    switch (command.type) {
      case 'place-stone':
        return this.placeStone(command.point);
      case 'pass':
        return this.pass();
      case 'undo':
        return this.undo();
    }
  }

  private placeStone(point: PointId): GameSessionResult {
    const currentState = this.history.current();
    const result = this.engine.placeStone(
      currentState,
      point,
      currentState.currentPlayer,
      this.repetitionPolicy,
      this.history.repetitionContext(),
    );

    if (!result.ok) {
      return Object.freeze({
        ok: false,
        state: currentState,
        reason: result.reason,
      });
    }

    const state = this.history.push(result.state);
    return Object.freeze({
      ok: true,
      action: 'place-stone',
      state,
      captured: result.captured,
    });
  }

  private pass(): GameSessionResult {
    const currentState = this.history.current();
    const result = this.engine.pass(currentState);

    if (!result.ok) {
      return Object.freeze({
        ok: false,
        state: currentState,
        reason: result.reason,
      });
    }

    const state = this.history.push(result.state);
    return Object.freeze({
      ok: true,
      action: 'pass',
      state,
      passedBy: result.passedBy,
    });
  }

  private undo(): GameSessionResult {
    const state = this.history.undo();

    if (!state) {
      return Object.freeze({
        ok: false,
        state: this.history.current(),
        reason: 'nothing-to-undo',
      });
    }

    return Object.freeze({
      ok: true,
      action: 'undo',
      state,
    });
  }
}
