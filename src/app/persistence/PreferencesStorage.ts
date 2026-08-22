import type { TorusSize } from '../../core/topology/TorusTopology';
import type { CubeUiSize } from '../CubeGameConfig';

export interface UserPreferences {
  readonly lastGameMode: 'torus-2d' | 'cube-2d' | null;
  readonly lastCubeSize: CubeUiSize | null;
  readonly lastTorusSize: TorusSize | null;
  readonly lastKomi: number | null;
  readonly showTorusDuplicateRegions: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = Object.freeze({
  lastGameMode: null,
  lastCubeSize: null,
  lastTorusSize: null,
  lastKomi: null,
  showTorusDuplicateRegions: false,
});

export interface PreferencesStorage {
  loadPreferences(): Promise<UserPreferences>;
  savePreferences(preferences: UserPreferences): Promise<void>;
}
