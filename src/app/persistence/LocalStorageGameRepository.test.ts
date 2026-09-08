import { describe, expect, it } from 'vitest';
import {
  LocalStorageGameRepository,
  type LocalStorageExclusiveLock,
} from './LocalStorageGameRepository';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class BlockingFirstPerNameLock implements LocalStorageExclusiveLock {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly firstGate: Promise<void>;
  private releaseFirstGate!: () => void;
  private firstEnteredResolve!: () => void;
  readonly firstEntered: Promise<void>;
  private shouldBlockFirst = true;

  constructor() {
    this.firstGate = new Promise<void>((resolve) => {
      this.releaseFirstGate = resolve;
    });
    this.firstEntered = new Promise<void>((resolve) => {
      this.firstEnteredResolve = resolve;
    });
  }

  async runExclusive<T>(name: string, task: () => T): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(name, tail);

    await previous;
    try {
      if (this.shouldBlockFirst) {
        this.shouldBlockFirst = false;
        this.firstEnteredResolve();
        await this.firstGate;
      }
      return task();
    } finally {
      releaseCurrent();
      if (this.tails.get(name) === tail) {
        this.tails.delete(name);
      }
    }
  }

  releaseFirst(): void {
    this.releaseFirstGate();
  }
}

interface RevisionState {
  readonly sessionRevision: number;
  readonly marker: string;
}

interface IdentifiedRevisionState extends RevisionState {
  readonly sessionId: string;
}

interface WrappedRevisionState {
  readonly version: 2;
  readonly snapshot: RevisionState;
}

interface WrappedIdentifiedRevisionState {
  readonly version: 2;
  readonly sessionId: string;
  readonly snapshot: RevisionState;
}

const savedGame = (id: string, sessionRevision: number, marker: string) => ({
  id,
  savedAt: `2026-09-08T00:00:${String(sessionRevision).padStart(2, '0')}.000Z`,
  state: { sessionRevision, marker } satisfies RevisionState,
});

const identifiedSavedGame = (
  id: string,
  sessionId: string,
  sessionRevision: number,
  marker: string,
) => ({
  id,
  savedAt: `2026-09-08T00:00:${String(sessionRevision).padStart(2, '0')}.000Z`,
  state: { sessionId, sessionRevision, marker } satisfies IdentifiedRevisionState,
});

const wrappedSavedGame = (
  id: string,
  sessionRevision: number,
  marker: string,
) => ({
  id,
  savedAt: `2026-09-08T00:00:${String(sessionRevision).padStart(2, '0')}.000Z`,
  state: {
    version: 2 as const,
    snapshot: { sessionRevision, marker },
  } satisfies WrappedRevisionState,
});

const wrappedIdentifiedSavedGame = (
  id: string,
  sessionId: string,
  sessionRevision: number,
  marker: string,
) => ({
  id,
  savedAt: `2026-09-08T00:00:${String(sessionRevision).padStart(2, '0')}.000Z`,
  state: {
    version: 2 as const,
    sessionId,
    snapshot: { sessionRevision, marker },
  } satisfies WrappedIdentifiedRevisionState,
});

describe('LocalStorageGameRepository', () => {
  it('round-trips one JSON-serializable saved game', async () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageGameRepository<{ readonly moveNumber: number }>(
      'test:game:',
      storage,
    );
    const game = {
      id: 'current',
      savedAt: '2026-08-20T18:00:00.000Z',
      state: { moveNumber: 12 },
    };

    await repository.save(game);

    expect(storage.values.has('test:game:current')).toBe(true);
    await expect(repository.load('current')).resolves.toEqual(game);

    await repository.remove('current');
    await expect(repository.load('current')).resolves.toBeNull();
  });

  it('does not overwrite stored revision 12 with stale revision 11', async () => {
    const storage = new MemoryStorage();
    const stored = savedGame('current', 12, 'newer');
    storage.values.set('test:game:current', JSON.stringify(stored));
    const repository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
    );

    await repository.save(savedGame('current', 11, 'stale'));

    expect(JSON.parse(storage.values.get('test:game:current') ?? 'null')).toEqual(
      stored,
    );
  });

  it('persists revision 13 over stored revision 12', async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'test:game:current',
      JSON.stringify(savedGame('current', 12, 'older')),
    );
    const repository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
    );
    const newer = savedGame('current', 13, 'newer');

    await repository.save(newer);

    expect(JSON.parse(storage.values.get('test:game:current') ?? 'null')).toEqual(
      newer,
    );
  });

  it('allows an equal incoming revision to replace the stored value', async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'test:game:current',
      JSON.stringify(savedGame('current', 12, 'older-payload')),
    );
    const repository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
    );
    const equalRevision = savedGame('current', 12, 'replacement-payload');

    await repository.save(equalRevision);

    expect(JSON.parse(storage.values.get('test:game:current') ?? 'null')).toEqual(
      equalRevision,
    );
  });

  it('compares the session revision inside the production application save envelope', async () => {
    const storage = new MemoryStorage();
    const stored = wrappedSavedGame('current', 12, 'newer');
    storage.values.set('test:game:current', JSON.stringify(stored));
    const repository = new LocalStorageGameRepository<WrappedRevisionState>(
      'test:game:',
      storage,
    );

    await repository.save(wrappedSavedGame('current', 11, 'stale'));

    expect(JSON.parse(storage.values.get('test:game:current') ?? 'null')).toEqual(
      stored,
    );
  });

  it('does not let an old revision 21 session overwrite a newly activated revision 0 session', async () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageGameRepository<IdentifiedRevisionState>(
      'test:game:',
      storage,
    );

    await repository.activate(identifiedSavedGame('current', 'old-session', 20, 'old-20'));
    const newGame = identifiedSavedGame('current', 'new-session', 0, 'new-0');
    await repository.activate(newGame);
    await repository.save(identifiedSavedGame('current', 'old-session', 21, 'old-21'));

    await expect(repository.load('current')).resolves.toEqual(newGame);
  });

  it('continues comparing revisions for two tabs of the same session identity', async () => {
    const storage = new MemoryStorage();
    const lock = new BlockingFirstPerNameLock();
    const freshRepository = new LocalStorageGameRepository<IdentifiedRevisionState>(
      'test:game:',
      storage,
      lock,
    );
    const staleRepository = new LocalStorageGameRepository<IdentifiedRevisionState>(
      'test:game:',
      storage,
      lock,
    );
    storage.values.set(
      'test:game:current',
      JSON.stringify(identifiedSavedGame('current', 'shared-session', 11, 'baseline')),
    );

    const freshSave = freshRepository.save(
      identifiedSavedGame('current', 'shared-session', 13, 'fresh'),
    );
    await lock.firstEntered;
    const staleSave = staleRepository.save(
      identifiedSavedGame('current', 'shared-session', 12, 'stale'),
    );

    lock.releaseFirst();
    await Promise.all([freshSave, staleSave]);

    await expect(freshRepository.load('current')).resolves.toEqual(
      identifiedSavedGame('current', 'shared-session', 13, 'fresh'),
    );
  });

  it('serializes two repository instances so a later stale save cannot erase a newer revision', async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'test:game:current',
      JSON.stringify(savedGame('current', 11, 'baseline')),
    );
    const lock = new BlockingFirstPerNameLock();
    const freshRepository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
      lock,
    );
    const staleRepository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
      lock,
    );
    const completionOrder: string[] = [];

    const freshSave = freshRepository
      .save(savedGame('current', 13, 'fresh'))
      .then(() => completionOrder.push('fresh'));
    await lock.firstEntered;

    const staleSave = staleRepository
      .save(savedGame('current', 12, 'stale'))
      .then(() => completionOrder.push('stale'));

    lock.releaseFirst();
    await Promise.all([freshSave, staleSave]);

    expect(completionOrder).toEqual(['fresh', 'stale']);
    expect(JSON.parse(storage.values.get('test:game:current') ?? 'null')).toEqual(
      savedGame('current', 13, 'fresh'),
    );
  });

  it('keeps the slot fenced from stale saves between remove and New Game activation', async () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageGameRepository<IdentifiedRevisionState>(
      'test:game:',
      storage,
    );
    await repository.activate(identifiedSavedGame('current', 'old-session', 20, 'old-20'));

    await repository.remove('current');
    await repository.save(identifiedSavedGame('current', 'old-session', 21, 'old-21'));
    await expect(repository.load('current')).resolves.toBeNull();

    const newGame = identifiedSavedGame('current', 'new-session', 0, 'new-0');
    await repository.activate(newGame);
    await repository.save(identifiedSavedGame('current', 'old-session', 22, 'old-22'));
    await expect(repository.load('current')).resolves.toEqual(newGame);
  });

  it('does not let a stale tab remove a newer active session generation', async () => {
    const storage = new MemoryStorage();
    const oldTab = new LocalStorageGameRepository<IdentifiedRevisionState>(
      'test:game:',
      storage,
    );
    const newTab = new LocalStorageGameRepository<IdentifiedRevisionState>(
      'test:game:',
      storage,
    );

    await oldTab.activate(
      identifiedSavedGame('current', 'old-session', 20, 'old-20'),
    );
    const newGame = identifiedSavedGame('current', 'new-session', 0, 'new-0');
    await newTab.activate(newGame);

    await oldTab.remove('current');

    await expect(newTab.load('current')).resolves.toEqual(newGame);
  });

  it('keeps legacy saves in a separate compatibility generation from identified sessions', async () => {
    const storage = new MemoryStorage();
    const modernRepository = new LocalStorageGameRepository<IdentifiedRevisionState>(
      'test:game:',
      storage,
    );
    const legacyRepository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
    );
    const modern = identifiedSavedGame('current', 'modern-session', 0, 'modern');

    await modernRepository.activate(modern);
    await legacyRepository.save(savedGame('current', 99, 'legacy-stale'));
    await expect(modernRepository.load('current')).resolves.toEqual(modern);

    storage.values.set(
      'test:game:current',
      JSON.stringify(savedGame('current', 20, 'legacy-current')),
    );
    await modernRepository.save(
      identifiedSavedGame('current', 'modern-session', 21, 'not-an-activation'),
    );
    expect(JSON.parse(storage.values.get('test:game:current') ?? 'null')).toEqual(
      savedGame('current', 20, 'legacy-current'),
    );

    await legacyRepository.save(savedGame('current', 21, 'legacy-newer'));
    expect(JSON.parse(storage.values.get('test:game:current') ?? 'null')).toEqual(
      savedGame('current', 21, 'legacy-newer'),
    );
  });

  it('reads session identity from the production envelope and revision from its snapshot', async () => {
    const storage = new MemoryStorage();
    const repository = new LocalStorageGameRepository<WrappedIdentifiedRevisionState>(
      'test:game:',
      storage,
    );
    const active = wrappedIdentifiedSavedGame('current', 'new-session', 0, 'new');

    await repository.activate(active);
    await repository.save(
      wrappedIdentifiedSavedGame('current', 'old-session', 999, 'stale-high-revision'),
    );

    await expect(repository.load('current')).resolves.toEqual(active);
  });

  it('uses independent exclusive locks for different game ids', async () => {
    const storage = new MemoryStorage();
    const lock = new BlockingFirstPerNameLock();
    const repositoryA = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
      lock,
    );
    const repositoryB = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
      lock,
    );

    const saveA = repositoryA.save(savedGame('game-a', 1, 'a'));
    await lock.firstEntered;

    const saveB = repositoryB.save(savedGame('game-b', 1, 'b'));
    const bOutcome = await Promise.race([
      saveB.then(() => 'completed' as const),
      new Promise<'blocked'>((resolve) => {
        setTimeout(() => resolve('blocked'), 50);
      }),
    ]);

    lock.releaseFirst();
    await Promise.all([saveA, saveB]);

    expect(bOutcome).toBe('completed');
    expect(JSON.parse(storage.values.get('test:game:game-a') ?? 'null')).toEqual(
      savedGame('game-a', 1, 'a'),
    );
    expect(JSON.parse(storage.values.get('test:game:game-b') ?? 'null')).toEqual(
      savedGame('game-b', 1, 'b'),
    );
  });

  it('does not let a corrupted envelope with recoverable newer revision be replaced by a stale save', async () => {
    const storage = new MemoryStorage();
    const corrupted = JSON.stringify({
      id: 'current',
      savedAt: 42,
      state: { sessionRevision: 12 },
    });
    storage.values.set('test:game:current', corrupted);
    const repository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
    );

    await expect(
      repository.save(savedGame('current', 11, 'stale')),
    ).rejects.toThrow('Cannot safely replace corrupted saved game');

    expect(storage.values.get('test:game:current')).toBe(corrupted);
  });

  it('fails closed on malformed existing JSON instead of overwriting it during save', async () => {
    const storage = new MemoryStorage();
    const corrupted = '{ definitely not json';
    storage.values.set('test:game:current', corrupted);
    const repository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
    );

    await expect(
      repository.save(savedGame('current', 13, 'incoming')),
    ).rejects.toThrow('Cannot safely compare revision');
    expect(storage.values.get('test:game:current')).toBe(corrupted);
  });

  it('treats malformed JSON as no save and keeps a fail-closed retired fence', async () => {
    const storage = new MemoryStorage();
    storage.values.set('test:game:current', '{ definitely not json');
    const repository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
    );

    await expect(repository.load('current')).resolves.toBeNull();
    await repository.save(savedGame('current', 99, 'stale-after-corruption'));
    await expect(repository.load('current')).resolves.toBeNull();
  });

  it('rejects a malformed saved-game envelope and fences the slot', async () => {
    const storage = new MemoryStorage();
    storage.values.set('test:game:current', JSON.stringify({ id: 42, state: {} }));
    const repository = new LocalStorageGameRepository<RevisionState>(
      'test:game:',
      storage,
    );

    await expect(repository.load('current')).resolves.toBeNull();
    await repository.save(savedGame('current', 99, 'stale-after-corruption'));
    await expect(repository.load('current')).resolves.toBeNull();
  });
});