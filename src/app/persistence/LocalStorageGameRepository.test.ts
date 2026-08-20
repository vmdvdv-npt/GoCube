import { describe, expect, it } from 'vitest';
import { LocalStorageGameRepository } from './LocalStorageGameRepository';

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
