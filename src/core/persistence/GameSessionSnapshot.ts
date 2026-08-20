import type { EndgameClassification } from '../endgame/EndgameClassifier';
import type { GameState, RuleSet } from '../game/types';
import type { FinalScore } from '../scoring/Scoring';

export const GAME_SESSION_SNAPSHOT_VERSION = 1 as const;

/** Serializable state required to resume one local game exactly. */
export interface GameSessionSnapshot {
  readonly version: typeof GAME_SESSION_SNAPSHOT_VERSION;
  /** Present for application-created saves; optional only for v1 backward compatibility. */
  readonly boardSize?: number;
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly history: readonly GameState[];
  /** Final classification used for scoring. Optional only for v1 backward compatibility. */
  readonly endgameClassification?: EndgameClassification | null;
  readonly finalScore: FinalScore | null;
}
