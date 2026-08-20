import type { EndgameClassifier } from '../endgame/EndgameClassifier';
import { LinearHistory } from '../history/LinearHistory';
import type { RepetitionPolicy } from '../rules/RepetitionPolicy';
import type { FinalScore, ScoringStrategy } from '../scoring/Scoring';
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

export interface GameSessionConfig {
  readonly endgameClassifier: EndgameClassifier;
  readonly scoringStrategy: ScoringStrategy;
  readonly komi: number;
}

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

const comparePointIds = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

export class GameSession {
  private readonly history: LinearHistory;
  private readonly config: GameSessionConfig;
  private currentFinalScore: FinalScore | null = null;

  constructor(
    private readonly engine: GameEngine,
    private readonly repetitionPolicy: RepetitionPolicy,
    config: GameSessionConfig,
    initialState: GameState = engine.createInitialState(),
  ) {
    this.config = Object.freeze({
      endgameClassifier: config.endgameClassifier,
      scoringStrategy: config.scoringStrategy,
      komi: config.komi,
    });
    this.history = new LinearHistory(initialState);
  }

  state(): GameState {
    return this.history.current();
  }

  finalScore(): FinalScore | null {
    return this.currentFinalScore;
  }

  historyLength(): number {
    return this.history.length();
  }

  async execute(command: GameCommand): Promise<GameSessionResult> {
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

  private async pass(): Promise<GameSessionResult> {
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
    if (state.phase !== 'endgame') {
      return Object.freeze({
        ok: true,
        action: 'pass',
        state,
        passedBy: result.passedBy,
      });
    }

    const classification = await this.config.endgameClassifier.classify(
      this.groupsForClassification(state),
    );
    const finalScore = this.config.scoringStrategy.score(
      state,
      classification,
      this.config.komi,
    );
    const finishedState = this.history.replaceCurrent({
      ...state,
      phase: 'finished',
    });
    this.currentFinalScore = finalScore;

    return Object.freeze({
      ok: true,
      action: 'pass',
      state: finishedState,
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

    this.currentFinalScore = null;
    return Object.freeze({
      ok: true,
      action: 'undo',
      state,
    });
  }

  private groupsForClassification(
    state: GameState,
  ): readonly (readonly PointId[])[] {
    const visited = new Set<PointId>();
    const groups: (readonly PointId[])[] = [];

    for (const point of Object.keys(state.board).sort(comparePointIds)) {
      if (visited.has(point) || state.board[point] === 'empty') continue;

      const group = this.engine.groupAt(state, point);
      if (!group) continue;

      const points = [...group.points].sort(comparePointIds);
      for (const groupPoint of points) visited.add(groupPoint);
      groups.push(Object.freeze(points));
    }

    return Object.freeze(groups);
  }
}
