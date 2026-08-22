import { describe, expect, it } from 'vitest';
import { LocalStoragePreferencesStorage } from './LocalStoragePreferencesStorage';
import { DEFAULT_USER_PREFERENCES } from './PreferencesStorage';

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

describe('LocalStoragePreferencesStorage', () => {
  it('defaults to no remembered size or komi and duplicate regions off', async () => {
    const storage = new MemoryStorage();
    const preferences = new LocalStoragePreferencesStorage(storage, 'test:preferences');

    await expect(preferences.loadPreferences()).resolves.toEqual(DEFAULT_USER_PREFERENCES);
  });

  it('round-trips product-approved cross-game preferences', async () => {
    const storage = new MemoryStorage();
    const preferences = new LocalStoragePreferencesStorage(storage, 'test:preferences');
    const expected = Object.freeze({
      lastCubeSize: 6 as const,
      lastTorusSize: 13 as const,
      lastKomi: 6.5,
      showTorusDuplicateRegions: true,
    });

    await preferences.savePreferences(expected);

    await expect(preferences.loadPreferences()).resolves.toEqual(expected);
  });

  it('loads older preference payloads without komi as no remembered komi', async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'test:preferences',
      JSON.stringify({
        version: 1,
        lastCubeSize: 5,
        lastTorusSize: 19,
        showTorusDuplicateRegions: true,
      }),
    );
    const preferences = new LocalStoragePreferencesStorage(storage, 'test:preferences');

    await expect(preferences.loadPreferences()).resolves.toEqual({
      lastCubeSize: 5,
      lastTorusSize: 19,
      lastKomi: null,
      showTorusDuplicateRegions: true,
    });
  });

  it('drops malformed or unsupported preference payloads instead of leaking them into runtime', async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'test:preferences',
      JSON.stringify({
        version: 1,
        lastCubeSize: 99,
        lastTorusSize: 13,
        lastKomi: 6.5,
        showTorusDuplicateRegions: true,
      }),
    );
    const preferences = new LocalStoragePreferencesStorage(storage, 'test:preferences');

    await expect(preferences.loadPreferences()).resolves.toEqual(DEFAULT_USER_PREFERENCES);
    expect(storage.values.has('test:preferences')).toBe(false);
  });

  it('rejects a remembered komi that is not normalized to a half point', async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'test:preferences',
      JSON.stringify({
        version: 1,
        lastCubeSize: 6,
        lastTorusSize: 13,
        lastKomi: 6.9,
        showTorusDuplicateRegions: false,
      }),
    );
    const preferences = new LocalStoragePreferencesStorage(storage, 'test:preferences');

    await expect(preferences.loadPreferences()).resolves.toEqual(DEFAULT_USER_PREFERENCES);
    expect(storage.values.has('test:preferences')).toBe(false);
  });
});
