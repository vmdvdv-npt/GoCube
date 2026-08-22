import type { TorusSize } from '../../core/topology/TorusTopology';
import type { CubeUiSize } from '../CubeGameConfig';

export interface UserPreferences {
  readonly lastCubeSize: CubeUiSize | null;
  readonly lastTorusSize: TorusSize | null;
  readonly showTorusDuplicateRegions: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = Object.freeze({
  lastCubeSize: null,
  lastTorusSize: null,
  showTorusDuplicateRegions: false,
});

export interface PreferencesStorage {
  loadPreferences(): Promise<UserPreferences>;
  savePreferences(preferences: UserPreferences): Promise<void>;
}
