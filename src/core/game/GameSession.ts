import type { EndgameClassifier } from '../endgame/EndgameClassifier';
import { LinearHistory } from '../history/LinearHistory';
import type { GameRepository } from '../persistence/GameRepository';
import {
  GAME_SESSION_SNAPSHOT_VERSION,
  type GameSessionSnapshot,
} from '../persistence/GameSessionSnapshot';
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

export interface GameSessionPersistenceConfig {
  readonly repository: GameRepository<GameSessionSnapshot>;
  readonly gameId: string;
  readonly now?: () => string;
}

export interface GameSessionConfig {
  readonly endgameClassifier: EndgameClassifier;
  readonly scoringStrategy: ScoringStrategy;
  readonly komi: number;
  readonly persistence?: GameSessionPersistenceConfig;
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

const cloneFinalScore = (score: FinalScore | null): FinalScore | null => {
  if (!score) return null;

  return Object.freeze({
    ...score,
    territory: Object.freeze({ ...score.territory }),
    territoryPoints: Object.freeze({
      black: Object.freeze([...score.territoryPoints.black]),
      white: Object.freeze([...score.territoryPoints.white]),
      neutral: Object.freeze([...score.territoryPoints.neutral]),
      seki: Object.freeze([...score.territoryPoints.seki]),
    }),
    stonesOnBoard: Object.freeze({ ...score.stonesOnBoard }),
    captures: Object.freeze({ ...score.captures }),
    prisoners: score.prisoners ? Object.freeze({ ...score.prisoners }) : null,
    deadStones: Object.freeze({ ...score.deadStones }),
  });
};

export class GameSession {
  private history: LinearHistory;
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
      persistence: config.persistence
        ? Object.freeze({
            repository: config.persistence.repository,
            gameId: config.persistence.gameId,
            now: config.persistence.now,
          })
        : undefined,
    });
    this.history = new LinearHistory(initialState);
  }

  static fromSnapshot(
    engine: GameEngine,
    repetitionPolicy: RepetitionPolicy,
    config: GameSessionConfig,
    snapshot: GameSessionSnapshot,
  ): GameSession {
    GameSession.assertCompatibleSnapshot(config, snapshot);

    const [initialState] = snapshot.history;
    if (!initialState) throw new Error('Saved game history must not be empty');

    const session = new GameSession(engine, repetitionPolicy, config, initialState);
    session.history = LinearHistory.fromStates(snapshot.history);
    session.currentFinalScore = cloneFinalScore(snapshot.finalScore);
    return session;
  }

  static async load(
    engine: GameEngine,
    repetitionPolicy: RepetitionPolicy,
    config: GameSessionConfig,
  ): Promise<GameSession | null> {
    const persistence = config.persistence;
    if (!persistence) throw new Error('GameSession persistence is not configured');

    const saved = await persistence.repository.load(persistence.gameId);
    if (!saved) return null;
    if (saved.id !== persistence.gameId) {
      throw new Error(`Saved game id mismatch: expected ${persistence.gameId}, got ${saved.id}`);
    }

    return GameSession.fromSnapshot(engine, repetitionPolicy, config, saved.state);
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

  snapshot(): GameSessionSnapshot {
    return Object.freeze({
      version: GAME_SESSION_SNAPSHOT_VERSION,
      ruleSet: this.config.scoringStrategy.ruleSet,
      komi: this.config.komi,
      history: this.history.states(),
      finalScore: cloneFinalScore(this.currentFinalScore),
    });
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

  private async placeStone(point: PointId): Promise<GameSessionResult> {
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
    await this.persist();
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
      await this.persist();
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
    await this.persist();

    return Object.freeze({
      ok: true,
      action: 'pass',
      state: finishedState,
      passedBy: result.passedBy,
    });
  }

  private async undo(): Promise<GameSessionResult> {
    const state = this.history.undo();

    if (!state) {
      return Object.freeze({
        ok: false,
        state: this.history.current(),
        reason: 'nothing-to-undo',
      });
    }

    this.currentFinalScore = null;
    await this.persist();
    return Object.freeze({
      ok: true,
      action: 'undo',
      state,
    });
  }

  private async persist(): Promise<void> {
    const persistence = this.config.persistence;
    if (!persistence) return;

    await persistence.repository.save({
      id: persistence.gameId,
      savedAt: (persistence.now ?? (() => new Date().toISOString()))(),
      state: this.snapshot(),
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

  private static assertCompatibleSnapshot(
    config: GameSessionConfig,
    snapshot: GameSessionSnapshot,
  ): void {
    if (snapshot.version !== GAME_SESSION_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported saved game version: ${String(snapshot.version)}`);
    }
    if (snapshot.ruleSet !== config.scoringStrategy.ruleSet) {
      throw new Error(
        `Saved rule set mismatch: expected ${config.scoringStrategy.ruleSet}, got ${snapshot.ruleSet}`,
      );
    }
    if (snapshot.komi !== config.komi) {
      throw new Error(`Saved komi mismatch: expected ${config.komi}, got ${snapshot.komi}`);
    }
    if (snapshot.history.length === 0) {
      throw new Error('Saved game history must not be empty');
    }

    const currentState = snapshot.history[snapshot.history.length - 1]!;
    if (currentState.phase === 'finished' && !snapshot.finalScore) {
      throw new Error('Finished saved game must include FinalScore');
    }
    if (currentState.phase !== 'finished' && snapshot.finalScore) {
      throw new Error('Unfinished saved game must not include FinalScore');
    }
    if (
      snapshot.finalScore &&
      (snapshot.finalScore.ruleSet !== snapshot.ruleSet || snapshot.finalScore.komi !== snapshot.komi)
    ) {
      throw new Error('Saved FinalScore does not match saved game configuration');
    }
  }
}
