import { describe, expect, it } from 'vitest';
import { LocalGameRepository } from './LocalGameRepository';

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

describe('LocalGameRepository', () => {
  it('round-trips one JSON-serializable saved game through the storage adapter', async () => {
    const storage = new MemoryStorage();
    const repository = new LocalGameRepository<{ readonly moveNumber: number }>(
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
});
