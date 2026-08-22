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
  it('defaults to no remembered size and duplicate regions off', async () => {
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
      showTorusDuplicateRegions: true,
    });

    await preferences.savePreferences(expected);

    await expect(preferences.loadPreferences()).resolves.toEqual(expected);
  });

  it('drops malformed or unsupported preference payloads instead of leaking them into runtime', async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      'test:preferences',
      JSON.stringify({
        version: 1,
        lastCubeSize: 99,
        lastTorusSize: 13,
        showTorusDuplicateRegions: true,
      }),
    );
    const preferences = new LocalStoragePreferencesStorage(storage, 'test:preferences');

    await expect(preferences.loadPreferences()).resolves.toEqual(DEFAULT_USER_PREFERENCES);
    expect(storage.values.has('test:preferences')).toBe(false);
  });
});
