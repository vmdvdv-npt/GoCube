import { TORUS_SIZES, type TorusSize } from '../../core/topology/TorusTopology';
import { isCubeUiSize, type CubeUiSize } from '../CubeGameConfig';
import {
  DEFAULT_USER_PREFERENCES,
  type PreferencesStorage,
  type UserPreferences,
} from './PreferencesStorage';

const PREFERENCES_VERSION = 1 as const;
export const PREFERENCES_STORAGE_KEY = 'gocube:preferences';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface StoredPreferences {
  readonly version: typeof PREFERENCES_VERSION;
  readonly lastCubeSize: CubeUiSize | null;
  readonly lastTorusSize: TorusSize | null;
  readonly showTorusDuplicateRegions: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isTorusSize = (value: unknown): value is TorusSize =>
  typeof value === 'number' && TORUS_SIZES.some((size) => size === value);

const parsePreferences = (value: unknown): UserPreferences | null => {
  if (!isRecord(value) || value.version !== PREFERENCES_VERSION) return null;

  const cubeSize = value.lastCubeSize;
  const torusSize = value.lastTorusSize;
  if (cubeSize !== null && !isCubeUiSize(cubeSize)) return null;
  if (torusSize !== null && !isTorusSize(torusSize)) return null;
  if (typeof value.showTorusDuplicateRegions !== 'boolean') return null;

  return Object.freeze({
    lastCubeSize: cubeSize,
    lastTorusSize: torusSize,
    showTorusDuplicateRegions: value.showTorusDuplicateRegions,
  });
};

const browserStorage = (): StorageLike | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export class LocalStoragePreferencesStorage implements PreferencesStorage {
  constructor(
    private readonly storage: StorageLike | null = browserStorage(),
    private readonly key: string = PREFERENCES_STORAGE_KEY,
  ) {}

  async loadPreferences(): Promise<UserPreferences> {
    if (!this.storage) return DEFAULT_USER_PREFERENCES;

    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return DEFAULT_USER_PREFERENCES;

      const preferences = parsePreferences(JSON.parse(raw) as unknown);
      if (preferences) return preferences;

      this.storage.removeItem(this.key);
      return DEFAULT_USER_PREFERENCES;
    } catch {
      try {
        this.storage.removeItem(this.key);
      } catch {
        // Preference storage is non-authoritative; failure must not break gameplay.
      }
      return DEFAULT_USER_PREFERENCES;
    }
  }

  async savePreferences(preferences: UserPreferences): Promise<void> {
    if (!this.storage) return;

    const stored: StoredPreferences = Object.freeze({
      version: PREFERENCES_VERSION,
      lastCubeSize: preferences.lastCubeSize,
      lastTorusSize: preferences.lastTorusSize,
      showTorusDuplicateRegions: preferences.showTorusDuplicateRegions,
    });
    this.storage.setItem(this.key, JSON.stringify(stored));
  }
}
