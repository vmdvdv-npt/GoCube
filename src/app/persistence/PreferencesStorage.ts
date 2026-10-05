import type { RuleSet } from '../../core/game/types';
import type { TorusSize } from '../../core/topology/TorusTopology';
import type { CubeUiSize } from '../CubeGameConfig';

export interface UserPreferences {
  readonly lastGameMode: 'torus-2d' | 'cube-2d' | null;
  readonly lastCubeSize: CubeUiSize | null;
  readonly lastTorusSize: TorusSize | null;
  readonly lastRuleSet: RuleSet | null;
  readonly lastKomi: number | null;
  readonly lastBotCheckpointId: string | null;
  readonly lastBotMctsSimulations: number | null;
  readonly showTorusDuplicateRegions: boolean;
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = Object.freeze({
  lastGameMode: null,
  lastCubeSize: null,
  lastTorusSize: null,
  lastRuleSet: null,
  lastKomi: null,
  lastBotCheckpointId: null,
  lastBotMctsSimulations: null,
  showTorusDuplicateRegions: false,
});

export interface PreferencesStorage {
  loadPreferences(): Promise<UserPreferences>;
  savePreferences(preferences: UserPreferences): Promise<void>;
}
