import type {
  ActiveGameRepository,
  SavedGame,
} from '../../core/persistence/GameRepository';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalStorageExclusiveLock {
  runExclusive<T>(name: string, task: () => T): Promise<T>;
}

interface BrowserLockManager {
  request<T>(
    name: string,
    options: { readonly mode: 'exclusive' },
    callback: () => T,
  ): Promise<T>;
}

type RevisionInspection =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly value: number }
  | { readonly kind: 'invalid' };

type SessionIdentityInspection =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly value: string }
  | { readonly kind: 'invalid' };

const LOCK_STORE = 'mutex';
const LOCK_RECORD_KEY = 'exclusive';
const RETIRED_SLOT_MARKER = 'gocube-retired-game-slot-v1';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSavedGame = <TState>(value: unknown): value is SavedGame<TState> =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.savedAt === 'string' &&
  Object.prototype.hasOwnProperty.call(value, 'state');

const isRetiredGameSlot = (value: unknown, id: string): boolean =>
  isSavedGame<unknown>(value) &&
  value.id === id &&
  isRecord(value.state) &&
  value.state.__gocubeRetiredGameSlot === RETIRED_SLOT_MARKER;

const retiredGameSlot = (id: string): SavedGame<Record<string, unknown>> => ({
  id,
  savedAt: '',
  state: {
    __gocubeRetiredGameSlot: RETIRED_SLOT_MARKER,
    // A revision-aware client from before session identities were introduced
    // also fails closed when it encounters this retired slot.
    sessionRevision: Number.MAX_SAFE_INTEGER,
  },
});

const inspectRevisionField = (
  state: Record<string, unknown>,
): RevisionInspection => {
  if (!Object.prototype.hasOwnProperty.call(state, 'sessionRevision')) {
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

const inspectSessionRevision = (state: unknown): RevisionInspection => {
  if (!isRecord(state)) return { kind: 'missing' };

  const direct = inspectRevisionField(state);
  if (direct.kind !== 'missing') return direct;

  // Production saves wrap GameSessionSnapshot inside ApplicationSavedState.
  // Keep revision inspection at the persistence boundary without teaching
  // GameSession or the UI about browser storage details.
  if (isRecord(state.snapshot)) {
    return inspectRevisionField(state.snapshot);
  }

  return { kind: 'missing' };
};

const inspectSessionIdentityField = (
  state: Record<string, unknown>,
): SessionIdentityInspection => {
  if (!Object.prototype.hasOwnProperty.call(state, 'sessionId')) {
    return { kind: 'missing' };
  }

  const sessionId = state.sessionId;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return { kind: 'valid', value: sessionId };
  }

  return { kind: 'invalid' };
};

const inspectSessionIdentity = (state: unknown): SessionIdentityInspection => {
  if (!isRecord(state)) return { kind: 'missing' };

  const direct = inspectSessionIdentityField(state);
  if (direct.kind !== 'missing') return direct;

  if (isRecord(state.snapshot)) {
    return inspectSessionIdentityField(state.snapshot);
  }

  return { kind: 'missing' };
};

const revisionOrLegacyZero = (state: unknown, source: string): number => {
  const inspection = inspectSessionRevision(state);
  if (inspection.kind === 'valid') return inspection.value;
  if (inspection.kind === 'missing') return 0;
  throw new Error(`Invalid sessionRevision in ${source} saved game`);
};

const requireValidSessionIdentity = (state: unknown, source: string): string => {
  const inspection = inspectSessionIdentity(state);
  if (inspection.kind === 'valid') return inspection.value;
  if (inspection.kind === 'missing') {
    throw new Error(`Missing sessionId in ${source} saved game`);
  }
  throw new Error(`Invalid sessionId in ${source} saved game`);
};

const sameSessionIdentity = (
  stored: SessionIdentityInspection,
  incoming: SessionIdentityInspection,
): boolean => {
  if (stored.kind === 'invalid' || incoming.kind === 'invalid') {
    throw new Error('Cannot safely compare invalid saved-game session identity');
  }
  if (stored.kind === 'missing' || incoming.kind === 'missing') {
    // Backward compatibility: missing identity is one explicit legacy
    // generation and only compares against another legacy save. It never
    // matches a modern identified session.
    return stored.kind === 'missing' && incoming.kind === 'missing';
  }
  return stored.value === incoming.value;
};

const inProcessLockTails = new Map<string, Promise<void>>();

const inProcessExclusiveLock: LocalStorageExclusiveLock = {
  async runExclusive<T>(name: string, task: () => T): Promise<T> {
    const previous = inProcessLockTails.get(name) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    inProcessLockTails.set(name, tail);

    await previous;
    try {
      return task();
    } finally {
      releaseCurrent();
      if (inProcessLockTails.get(name) === tail) {
        inProcessLockTails.delete(name);
      }
    }
  },
};

const indexedDbLockDatabases = new Map<string, Promise<IDBDatabase>>();

const indexedDbLockDatabase = (name: string): Promise<IDBDatabase> => {
  const existing = indexedDbLockDatabases.get(name);
  if (existing) return existing;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`gocube:local-storage-lock:${name}`, 1);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LOCK_STORE)) {
        request.result.createObjectStore(LOCK_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(
        request.error ??
          new Error(`Unable to open cross-tab lock database for ${name}`),
      );
    };
    request.onblocked = () => {
      reject(new Error(`Cross-tab lock database is blocked for ${name}`));
    };
  });

  indexedDbLockDatabases.set(name, opening);
  void opening.catch(() => {
    if (indexedDbLockDatabases.get(name) === opening) {
      indexedDbLockDatabases.delete(name);
    }
  });
  return opening;
};

const indexedDbExclusiveLock: LocalStorageExclusiveLock = {
  async runExclusive<T>(name: string, task: () => T): Promise<T> {
    const database = await indexedDbLockDatabase(name);

    return new Promise<T>((resolve, reject) => {
      let taskCompleted = false;
      let taskResult!: T;
      let taskError: unknown = null;
      const transaction = database.transaction(LOCK_STORE, 'readwrite');

      transaction.oncomplete = () => {
        if (!taskCompleted) {
          reject(
            taskError ??
              new Error(`Cross-tab lock transaction completed without task for ${name}`),
          );
          return;
        }
        resolve(taskResult);
      };
      transaction.onabort = () => {
        reject(
          taskError ??
            transaction.error ??
            new Error(`Cross-tab lock transaction aborted for ${name}`),
        );
      };

      const claim = transaction
        .objectStore(LOCK_STORE)
        .put(Date.now(), LOCK_RECORD_KEY);
      claim.onsuccess = () => {
        try {
          // This callback runs while the readwrite transaction owns the object
          // store. localStorage read/compare/write is synchronous, so the whole
          // critical section completes before the transaction can commit.
          taskResult = task();
          taskCompleted = true;
        } catch (error) {
          taskError = error;
          transaction.abort();
        }
      };
    });
  },
};

const browserExclusiveLock: LocalStorageExclusiveLock = {
  async runExclusive<T>(name: string, task: () => T): Promise<T> {
    if (typeof window === 'undefined') {
      // Unit/headless JS environments have no competing browser tabs.
      return inProcessExclusiveLock.runExclusive(name, task);
    }

    const locks = (
      navigator as unknown as { readonly locks?: BrowserLockManager }
    ).locks;
    if (locks) {
      return locks.request(name, { mode: 'exclusive' }, task);
    }

    // Some browser/headless contexts do not expose Web Locks. IndexedDB
    // readwrite transactions still provide a browser-owned cross-context
    // serialization primitive. One database per lock name keeps different game
    // ids independent instead of serializing unrelated saves through one store.
    if (typeof indexedDB !== 'undefined') {
      return indexedDbExclusiveLock.runExclusive(name, task);
    }

    throw new Error(
      'No browser cross-tab lock primitive is available for revision-safe localStorage game saves',
    );
  },
};

/** Browser persistence adapter. Core/session code only depends on GameRepository. */
export class LocalStorageGameRepository<TState = unknown>
  implements ActiveGameRepository<TState>
{
  constructor(
    private readonly prefix = 'gocube:game:',
    private readonly storage: KeyValueStorage = localStorage,
    private readonly exclusiveLock: LocalStorageExclusiveLock = browserExclusiveLock,
  ) {}

  async save(game: SavedGame<TState>): Promise<void> {
    const incomingIdentity = inspectSessionIdentity(game.state);
    if (incomingIdentity.kind === 'invalid') {
      throw new Error('Invalid sessionId in incoming saved game');
    }

    await this.exclusiveLock.runExclusive(this.lockName(game.id), () => {
      const key = this.key(game.id);
      const raw = this.storage.getItem(key);

      if (raw === null) {
        revisionOrLegacyZero(game.state, 'incoming');
        this.storage.setItem(key, JSON.stringify(game));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(
          `Cannot safely compare revision of corrupted saved game ${game.id}`,
        );
      }

      if (isRetiredGameSlot(parsed, game.id)) {
        return;
      }

      if (!isSavedGame<TState>(parsed) || parsed.id !== game.id) {
        throw new Error(
          `Cannot safely replace corrupted saved game ${game.id}`,
        );
      }

      const storedIdentity = inspectSessionIdentity(parsed.state);
      if (storedIdentity.kind === 'invalid') {
        throw new Error(
          `Cannot safely compare session identity of corrupted saved game ${game.id}`,
        );
      }

      if (!sameSessionIdentity(storedIdentity, incomingIdentity)) {
        return;
      }

      const incomingRevision = revisionOrLegacyZero(game.state, 'incoming');
      const storedRevision = revisionOrLegacyZero(parsed.state, 'stored');
      if (storedRevision > incomingRevision) {
        return;
      }

      this.storage.setItem(key, JSON.stringify(game));
    });
  }

  async activate(game: SavedGame<TState>): Promise<void> {
    requireValidSessionIdentity(game.state, 'activated');
    revisionOrLegacyZero(game.state, 'activated');

    await this.exclusiveLock.runExclusive(this.lockName(game.id), () => {
      // Activation is the only operation allowed to replace the active session
      // identity. It intentionally ignores the previous generation/revision.
      this.storage.setItem(this.key(game.id), JSON.stringify(game));
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
      if (isRetiredGameSlot(parsed, id)) return null;
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
    await this.exclusiveLock.runExclusive(this.lockName(id), () => {
      // Keep a fail-closed sentinel instead of exposing an empty interval where
      // an old tab could recreate the retired session before New Game activates
      // its new identity.
      this.storage.setItem(this.key(id), JSON.stringify(retiredGameSlot(id)));
    });
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
