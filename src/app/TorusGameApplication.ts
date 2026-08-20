import type { RuleSet } from '../core/game/types';
import type {
  GameRepository,
  SavedGame,
} from '../core/persistence/GameRepository';
import {
  GAME_SESSION_SNAPSHOT_VERSION,
  type GameSessionSnapshot,
} from '../core/persistence/GameSessionSnapshot';
import { TORUS_SIZES, type TorusSize } from '../core/topology/TorusTopology';
import { LocalStorageGameRepository } from './persistence/LocalStorageGameRepository';
import { TorusGameController } from './TorusGameController';

export const CURRENT_GAME_ID = 'current';

export interface NewGameSettings {
  readonly size: TorusSize;
  readonly ruleSet: RuleSet;
  readonly komi: number;
}

export interface SavedGameSummary extends NewGameSettings {
  readonly moveNumber: number;
  readonly phase: 'playing' | 'endgame';
  readonly savedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isTorusSize = (value: unknown): value is TorusSize =>
  typeof value === 'number' && TORUS_SIZES.some((size) => size === value);

const isRuleSet = (value: unknown): value is RuleSet =>
  value === 'chinese' || value === 'japanese';

const isUnfinishedPhase = (value: unknown): value is 'playing' | 'endgame' =>
  value === 'playing' || value === 'endgame';

/** Owns browser/application lifecycle decisions without moving them into GameEngine. */
export class TorusGameApplication {
  constructor(
    private readonly repository: GameRepository<GameSessionSnapshot> =
      new LocalStorageGameRepository<GameSessionSnapshot>(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async findUnfinishedGame(): Promise<SavedGameSummary | null> {
    const saved = await this.readSavedGame();
    if (!saved) return null;

    const snapshot = saved.state;
    const current = snapshot.history.at(-1);
    if (!current || current.phase === 'finished') return null;

    return Object.freeze({
      size: snapshot.boardSize as TorusSize,
      ruleSet: snapshot.ruleSet,
      komi: snapshot.komi,
      moveNumber: current.moveNumber,
      phase: current.phase,
      savedAt: saved.savedAt,
    });
  }

  async createNewGame(settings: NewGameSettings): Promise<TorusGameController> {
    this.assertSettings(settings);

    const persistence = this.persistenceConfig();
    const controller = new TorusGameController({
      ...settings,
      persistence,
    });

    // New Game is itself an application state change. Persist the empty session
    // immediately so size/rules/komi survive closing before the first move.
    await this.repository.save({
      id: CURRENT_GAME_ID,
      savedAt: this.now(),
      state: controller.snapshot(),
    });

    return controller;
  }

  async restoreUnfinishedGame(): Promise<TorusGameController | null> {
    const saved = await this.readSavedGame();
    if (!saved) return null;

    const snapshot = saved.state;
    if (snapshot.history.at(-1)?.phase === 'finished') return null;

    try {
      return new TorusGameController({
        size: snapshot.boardSize as TorusSize,
        ruleSet: snapshot.ruleSet,
        komi: snapshot.komi,
        persistence: this.persistenceConfig(),
        snapshot,
      });
    } catch {
      await this.removeInvalidSave();
      return null;
    }
  }

  async discardSavedGame(): Promise<void> {
    await this.repository.remove(CURRENT_GAME_ID);
  }

  private persistenceConfig() {
    return Object.freeze({
      repository: this.repository,
      gameId: CURRENT_GAME_ID,
      now: this.now,
    });
  }

  private async readSavedGame(): Promise<SavedGame<GameSessionSnapshot> | null> {
    let saved: SavedGame<GameSessionSnapshot> | null;
    try {
      saved = await this.repository.load(CURRENT_GAME_ID);
    } catch {
      return null;
    }

    if (!saved) return null;

    try {
      const state: unknown = saved.state;
      if (
        saved.id !== CURRENT_GAME_ID ||
        !isRecord(state) ||
        state.version !== GAME_SESSION_SNAPSHOT_VERSION ||
        !isTorusSize(state.boardSize) ||
        !isRuleSet(state.ruleSet) ||
        typeof state.komi !== 'number' ||
        !Number.isFinite(state.komi) ||
        !Array.isArray(state.history) ||
        state.history.length === 0
      ) {
        throw new Error('Invalid saved game envelope');
      }

      const current: unknown = state.history.at(-1);
      if (!isRecord(current) || !('phase' in current)) {
        throw new Error('Invalid saved current state');
      }
      if (current.phase !== 'finished' && !isUnfinishedPhase(current.phase)) {
        throw new Error('Invalid saved game phase');
      }

      return saved;
    } catch {
      await this.removeInvalidSave();
      return null;
    }
  }

  private assertSettings(settings: NewGameSettings): void {
    if (!isTorusSize(settings.size)) {
      throw new Error(`Unsupported torus size: ${String(settings.size)}`);
    }
    if (!isRuleSet(settings.ruleSet)) {
      throw new Error(`Unsupported rule set: ${String(settings.ruleSet)}`);
    }
    if (!Number.isFinite(settings.komi)) {
      throw new Error('Komi must be a finite number');
    }
  }

  private async removeInvalidSave(): Promise<void> {
    try {
      await this.repository.remove(CURRENT_GAME_ID);
    } catch {
      // Invalid persistence must never prevent the application from starting.
    }
  }
}
