import type {
  GameRepository,
  SavedGame,
} from '../../core/persistence/GameRepository';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSavedGame = <TState>(value: unknown): value is SavedGame<TState> =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.savedAt === 'string' &&
  Object.prototype.hasOwnProperty.call(value, 'state');

/** Browser persistence adapter. Core/session code only depends on GameRepository. */
export class LocalStorageGameRepository<TState = unknown>
  implements GameRepository<TState>
{
  constructor(
    private readonly prefix = 'gocube:game:',
    private readonly storage: KeyValueStorage = localStorage,
  ) {}

  async save(game: SavedGame<TState>): Promise<void> {
    this.storage.setItem(this.key(game.id), JSON.stringify(game));
  }

  async load(id: string): Promise<SavedGame<TState> | null> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key(id));
    } catch {
      return null;
    }

    if (!raw) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isSavedGame<TState>(parsed) || parsed.id !== id) {
        this.removeCorrupted(id);
        return null;
      }
      return parsed;
    } catch {
      this.removeCorrupted(id);
      return null;
    }
  }

  async remove(id: string): Promise<void> {
    this.storage.removeItem(this.key(id));
  }

  private key(id: string): string {
    return this.prefix + id;
  }

  private removeCorrupted(id: string): void {
    try {
      this.storage.removeItem(this.key(id));
    } catch {
      // Corrupted or inaccessible browser storage must not prevent application boot.
    }
  }
}
