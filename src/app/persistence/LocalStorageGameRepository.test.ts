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

  async runExclusive<T>(
    name: string,
    task: () => T | Promise<T>,
  ): Promise<T> {
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
      return await task();
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

const savedGame = (id: string, sessionRevision: number, marker: string) => ({
  id,
  savedAt: `2026-09-08T00:00:${String(sessionRevision).padStart(2, '0')}.000Z`,
  state: { sessionRevision, marker } satisfies RevisionState,
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

  it('treats malformed JSON as no save and removes the corrupted value', async () => {
    const storage = new MemoryStorage();
    storage.values.set('test:game:current', '{ definitely not json');
    const repository = new LocalStorageGameRepository('test:game:', storage);

    await expect(repository.load('current')).resolves.toBeNull();
    expect(storage.values.has('test:game:current')).toBe(false);
  });

  it('rejects a malformed saved-game envelope without throwing', async () => {
    const storage = new MemoryStorage();
    storage.values.set('test:game:current', JSON.stringify({ id: 42, state: {} }));
    const repository = new LocalStorageGameRepository('test:game:', storage);

    await expect(repository.load('current')).resolves.toBeNull();
    expect(storage.values.has('test:game:current')).toBe(false);
  });
});
