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
  readonly lastGameMode: UserPreferences['lastGameMode'];
  readonly lastCubeSize: CubeUiSize | null;
  readonly lastTorusSize: TorusSize | null;
  readonly lastKomi: number | null;
  readonly showTorusDuplicateRegions: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isGameMode = (value: unknown): value is NonNullable<UserPreferences['lastGameMode']> =>
  value === 'torus-2d' || value === 'cube-2d';

const isTorusSize = (value: unknown): value is TorusSize =>
  typeof value === 'number' && TORUS_SIZES.some((size) => size === value);

const isNormalizedKomi = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value === Math.floor(value) + 0.5;

const parsePreferences = (value: unknown): UserPreferences | null => {
  if (!isRecord(value) || value.version !== PREFERENCES_VERSION) return null;

  const gameMode = value.lastGameMode ?? null;
  const cubeSize = value.lastCubeSize;
  const torusSize = value.lastTorusSize;
  const komi = value.lastKomi ?? null;
  if (gameMode !== null && !isGameMode(gameMode)) return null;
  if (cubeSize !== null && !isCubeUiSize(cubeSize)) return null;
  if (torusSize !== null && !isTorusSize(torusSize)) return null;
  if (komi !== null && !isNormalizedKomi(komi)) return null;
  if (typeof value.showTorusDuplicateRegions !== 'boolean') return null;

  return Object.freeze({
    lastGameMode: gameMode,
    lastCubeSize: cubeSize,
    lastTorusSize: torusSize,
    lastKomi: komi,
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
      lastGameMode: preferences.lastGameMode,
      lastCubeSize: preferences.lastCubeSize,
      lastTorusSize: preferences.lastTorusSize,
      lastKomi: preferences.lastKomi,
      showTorusDuplicateRegions: preferences.showTorusDuplicateRegions,
    });
    this.storage.setItem(this.key, JSON.stringify(stored));
  }
}
