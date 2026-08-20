import type { GameState, RuleSet } from '../game/types';
import type { FinalScore } from '../scoring/Scoring';

export const GAME_SESSION_SNAPSHOT_VERSION = 1 as const;

/** Serializable state required to resume one local game exactly. */
export interface GameSessionSnapshot {
  readonly version: typeof GAME_SESSION_SNAPSHOT_VERSION;
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly history: readonly GameState[];
  readonly finalScore: FinalScore | null;
}
