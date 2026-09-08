import type {
  GameRepository,
  SavedGame,
} from '../../core/persistence/GameRepository';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalStorageExclusiveLock {
  runExclusive<T>(name: string, task: () => T | Promise<T>): Promise<T>;
}

interface BrowserLockManager {
  request<T>(
    name: string,
    options: { readonly mode: 'exclusive' },
    callback: () => T | Promise<T>,
  ): Promise<T>;
}

type RevisionInspection =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly value: number }
  | { readonly kind: 'invalid' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSavedGame = <TState>(value: unknown): value is SavedGame<TState> =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.savedAt === 'string' &&
  Object.prototype.hasOwnProperty.call(value, 'state');

const inspectSessionRevision = (state: unknown): RevisionInspection => {
  if (
    !isRecord(state) ||
    !Object.prototype.hasOwnProperty.call(state, 'sessionRevision')
  ) {
    return { kind: 'missing' };
  }

  const revision = state.sessionRevision;
  if (
    typeof revision === 'number' &&
    Number.isSafeInteger(revision) &&
    revision >= 0
  ) {
    return { kind: 'valid', value: revision };
  }

  return { kind: 'invalid' };
};

const revisionOrLegacyZero = (state: unknown, source: string): number => {
  const inspection = inspectSessionRevision(state);
  if (inspection.kind === 'valid') return inspection.value;
  if (inspection.kind === 'missing') return 0;
  throw new Error(`Invalid sessionRevision in ${source} saved game`);
};

const inProcessLockTails = new Map<string, Promise<void>>();

const inProcessExclusiveLock: LocalStorageExclusiveLock = {
  async runExclusive<T>(name: string, task: () => T | Promise<T>): Promise<T> {
    const previous = inProcessLockTails.get(name) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    inProcessLockTails.set(name, tail);

    await previous;
    try {
      return await task();
    } finally {
      releaseCurrent();
      if (inProcessLockTails.get(name) === tail) {
        inProcessLockTails.delete(name);
      }
    }
  },
};

const browserExclusiveLock: LocalStorageExclusiveLock = {
  async runExclusive<T>(name: string, task: () => T | Promise<T>): Promise<T> {
    if (typeof window === 'undefined') {
      // Headless/unit-test environments have no tabs. Keep repository instances
      // serialized in-process without introducing browser APIs into core code.
      return inProcessExclusiveLock.runExclusive(name, task);
    }

    const locks = (
      navigator as unknown as { readonly locks?: BrowserLockManager }
    ).locks;
    if (!locks) {
      // A browser without a cross-context lock primitive cannot safely perform
      // read -> compare -> write against localStorage. Fail closed instead of
      // silently allowing a stale tab to overwrite a newer revision.
      throw new Error(
        'Web Locks API is required for revision-safe localStorage game saves',
      );
    }

    return locks.request(name, { mode: 'exclusive' }, task);
  },
};

/** Browser persistence adapter. Core/session code only depends on GameRepository. */
export class LocalStorageGameRepository<TState = unknown>
  implements GameRepository<TState>
{
  constructor(
    private readonly prefix = 'gocube:game:',
    private readonly storage: KeyValueStorage = localStorage,
    private readonly exclusiveLock: LocalStorageExclusiveLock = browserExclusiveLock,
  ) {}

  async save(game: SavedGame<TState>): Promise<void> {
    const incomingRevision = revisionOrLegacyZero(game.state, 'incoming');

    await this.exclusiveLock.runExclusive(this.lockName(game.id), () => {
      const key = this.key(game.id);
      const raw = this.storage.getItem(key);

      if (raw !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new Error(
            `Cannot safely compare revision of corrupted saved game ${game.id}`,
          );
        }

        if (!isSavedGame<TState>(parsed) || parsed.id !== game.id) {
          throw new Error(
            `Cannot safely replace corrupted saved game ${game.id}`,
          );
        }

        const storedRevision = revisionOrLegacyZero(parsed.state, 'stored');
        if (storedRevision > incomingRevision) {
          return;
        }
      }

      this.storage.setItem(key, JSON.stringify(game));
    });
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

  private lockName(id: string): string {
    return `gocube:local-storage-game-save:${this.key(id)}`;
  }

  private removeCorrupted(id: string): void {
    try {
      this.storage.removeItem(this.key(id));
    } catch {
      // Corrupted or inaccessible browser storage must not prevent application boot.
    }
  }
}
