import type { RuleSet } from '../core/game/types';
import type { GameRepository, SavedGame } from '../core/persistence/GameRepository';
import {
  GAME_SESSION_SNAPSHOT_VERSION,
  type GameSessionSnapshot,
} from '../core/persistence/GameSessionSnapshot';
import type { CubeSize } from '../core/topology/CubeTopology';
import { TORUS_SIZES, type TorusSize } from '../core/topology/TorusTopology';
import {
  isCubeUiSize,
  type CubeUiSize,
} from './CubeGameConfig';
import { LocalStorageGameRepository } from './persistence/LocalStorageGameRepository';
import { Cube2DGameController } from './Cube2DGameController';
import { TorusGameController } from './TorusGameController';

export const CURRENT_GAME_ID = 'current';
export const APPLICATION_SAVE_VERSION = 2 as const;

export type GameMode = 'torus-2d' | 'cube-2d';
export type GameSize = TorusSize | CubeUiSize;

export interface NewGameSettings {
  readonly gameMode: GameMode;
  readonly size: GameSize;
  readonly ruleSet: RuleSet;
  readonly komi: number;
}

export interface SavedGameSummary extends NewGameSettings {
  readonly moveNumber: number;
  readonly phase: 'playing' | 'endgame' | 'finished';
  readonly savedAt: string;
}

export type ActiveGame =
  | Readonly<{ gameMode: 'torus-2d'; controller: TorusGameController }>
  | Readonly<{ gameMode: 'cube-2d'; controller: Cube2DGameController }>;

export interface ApplicationSavedState {
  readonly version: typeof APPLICATION_SAVE_VERSION;
  readonly gameMode: GameMode;
  readonly snapshot: GameSessionSnapshot;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isGameMode = (value: unknown): value is GameMode =>
  value === 'torus-2d' || value === 'cube-2d';

const isRuleSet = (value: unknown): value is RuleSet =>
  value === 'chinese' || value === 'japanese';

const isTorusSize = (value: unknown): value is TorusSize =>
  typeof value === 'number' && TORUS_SIZES.some((size) => size === value);

const isSizeForMode = (mode: GameMode, value: unknown): value is GameSize =>
  mode === 'torus-2d' ? isTorusSize(value) : isCubeUiSize(value);

const isPhase = (value: unknown): value is SavedGameSummary['phase'] =>
  value === 'playing' || value === 'endgame' || value === 'finished';

const hasValidStateMetadata = (
  state: unknown,
  endgameClassification: unknown,
  finalScore: unknown,
): boolean => {
  if (!isRecord(state) || !isPhase(state.phase)) return false;
  if (state.phase === 'finished') return isRecord(finalScore);
  return (endgameClassification === null || endgameClassification === undefined) && finalScore === null;
};

const hasValidRedo = (redo: unknown): boolean =>
  redo === undefined ||
  (Array.isArray(redo) &&
    redo.every(
      (entry) =>
        isRecord(entry) &&
        hasValidStateMetadata(
          entry.state,
          entry.endgameClassification,
          entry.finalScore,
        ),
    ));

/**
 * Bridges the shared GameSession persistence contract to the application save envelope.
 * GameSession continues to persist only GameSessionSnapshot; the application adds gameMode.
 */
class ApplicationSessionRepository implements GameRepository<GameSessionSnapshot> {
  constructor(
    private readonly repository: GameRepository<ApplicationSavedState>,
    private readonly gameMode: GameMode,
  ) {}

  async save(game: SavedGame<GameSessionSnapshot>): Promise<void> {
    await this.repository.save({
      id: game.id,
      savedAt: game.savedAt,
      state: Object.freeze({
        version: APPLICATION_SAVE_VERSION,
        gameMode: this.gameMode,
        snapshot: game.state,
      }),
    });
  }

  async load(id: string): Promise<SavedGame<GameSessionSnapshot> | null> {
    const saved = await this.repository.load(id);
    if (!saved || saved.state.gameMode !== this.gameMode) return null;
    return Object.freeze({
      id: saved.id,
      savedAt: saved.savedAt,
      state: saved.state.snapshot,
    });
  }

  async remove(id: string): Promise<void> {
    await this.repository.remove(id);
  }
}

/** Owns the single application lifecycle for Torus 2D and Cube 2D. */
export class GameApplication {
  constructor(
    private readonly repository: GameRepository<ApplicationSavedState> =
      new LocalStorageGameRepository<ApplicationSavedState>(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async findSavedGame(): Promise<SavedGameSummary | null> {
    const saved = await this.readSavedGame();
    if (!saved) return null;

    const { gameMode, snapshot } = saved.state;
    const current = snapshot.history.at(-1);
    if (!current) return null;

    return Object.freeze({
      gameMode,
      size: snapshot.boardSize as GameSize,
      ruleSet: snapshot.ruleSet,
      komi: snapshot.komi,
      moveNumber: current.moveNumber,
      phase: current.phase,
      savedAt: saved.savedAt,
    });
  }

  async createNewGame(settings: NewGameSettings): Promise<ActiveGame> {
    this.assertSettings(settings);
    const persistence = this.persistenceConfig(settings.gameMode);

    const active: ActiveGame = settings.gameMode === 'cube-2d'
      ? Object.freeze({
          gameMode: 'cube-2d',
          controller: new Cube2DGameController({
            size: settings.size as CubeSize,
            ruleSet: settings.ruleSet,
            komi: settings.komi,
            persistence,
          }),
        })
      : Object.freeze({
          gameMode: 'torus-2d',
          controller: new TorusGameController({
            size: settings.size as TorusSize,
            ruleSet: settings.ruleSet,
            komi: settings.komi,
            persistence,
          }),
        });

    await persistence.repository.save({
      id: CURRENT_GAME_ID,
      savedAt: this.now(),
      state: active.controller.snapshot(),
    });

    return active;
  }

  async restoreSavedGame(): Promise<ActiveGame | null> {
    const saved = await this.readSavedGame();
    if (!saved) return null;

    const { gameMode, snapshot } = saved.state;
    const persistence = this.persistenceConfig(gameMode);

    try {
      if (gameMode === 'cube-2d') {
        return Object.freeze({
          gameMode,
          controller: new Cube2DGameController({
            size: snapshot.boardSize as CubeSize,
            ruleSet: snapshot.ruleSet,
            komi: snapshot.komi,
            persistence,
            snapshot,
          }),
        });
      }

      return Object.freeze({
        gameMode,
        controller: new TorusGameController({
          size: snapshot.boardSize as TorusSize,
          ruleSet: snapshot.ruleSet,
          komi: snapshot.komi,
          persistence,
          snapshot,
        }),
      });
    } catch {
      await this.removeInvalidSave();
      return null;
    }
  }

  async discardSavedGame(): Promise<void> {
    await this.repository.remove(CURRENT_GAME_ID);
  }

  private persistenceConfig(gameMode: GameMode) {
    return Object.freeze({
      repository: new ApplicationSessionRepository(this.repository, gameMode),
      gameId: CURRENT_GAME_ID,
      now: this.now,
    });
  }

  private async readSavedGame(): Promise<SavedGame<ApplicationSavedState> | null> {
    let saved: SavedGame<ApplicationSavedState> | null;
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
        state.version !== APPLICATION_SAVE_VERSION ||
        !isGameMode(state.gameMode) ||
        !isRecord(state.snapshot)
      ) {
        throw new Error('Invalid application save envelope');
      }

      const snapshot = state.snapshot as unknown as GameSessionSnapshot;
      if (
        snapshot.version !== GAME_SESSION_SNAPSHOT_VERSION ||
        !isSizeForMode(state.gameMode, snapshot.boardSize) ||
        !isRuleSet(snapshot.ruleSet) ||
        typeof snapshot.komi !== 'number' ||
        !Number.isFinite(snapshot.komi) ||
        !Array.isArray(snapshot.history) ||
        snapshot.history.length === 0 ||
        !hasValidRedo(snapshot.redo)
      ) {
        throw new Error('Invalid saved session snapshot');
      }

      const current: unknown = snapshot.history.at(-1);
      if (!hasValidStateMetadata(current, snapshot.endgameClassification, snapshot.finalScore)) {
        throw new Error('Invalid saved current state');
      }

      return saved;
    } catch {
      await this.removeInvalidSave();
      return null;
    }
  }

  private assertSettings(settings: NewGameSettings): void {
    if (!isGameMode(settings.gameMode)) {
      throw new Error(`Unsupported game mode: ${String(settings.gameMode)}`);
    }
    if (!isSizeForMode(settings.gameMode, settings.size)) {
      throw new Error(
        `Unsupported ${settings.gameMode} size: ${String(settings.size)}`,
      );
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
      // Corrupted persistence must never prevent the application from starting.
    }
  }
}
