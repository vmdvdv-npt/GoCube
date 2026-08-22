import type { EndgameClassification, GroupStatus } from '../endgame/EndgameClassifier';
import type { GameState, RuleSet } from '../game/types';
import type { FinalScore } from '../scoring/Scoring';
import type { PointId } from '../topology/Topology';

export const GAME_SESSION_SNAPSHOT_VERSION = 1 as const;

export interface EndgameReviewGroupSnapshot {
  readonly points: readonly PointId[];
  readonly status: GroupStatus | null;
}

export interface EndgameReviewStateSnapshot {
  readonly groups: readonly EndgameReviewGroupSnapshot[];
}

export interface GameSessionRedoEntrySnapshot {
  readonly state: GameState;
  readonly endgameReview?: EndgameReviewStateSnapshot | null;
  readonly endgameClassification: EndgameClassification | null;
  readonly finalScore: FinalScore | null;
}

/** Serializable state required to resume one local game exactly. */
export interface GameSessionSnapshot {
  readonly version: typeof GAME_SESSION_SNAPSHOT_VERSION;
  /** Present for application-created saves; optional only for v1 backward compatibility. */
  readonly boardSize?: number;
  /** Monotonic session autosave revision. Optional only for existing v1 saves. */
  readonly sessionRevision?: number;
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly history: readonly GameState[];
  /** Last entry is the next Redo target. Optional for existing v1 saves. */
  readonly redo?: readonly GameSessionRedoEntrySnapshot[];
  /** Partial manual review for an ENDGAME_REVIEW state. Optional for existing v1 saves. */
  readonly endgameReview?: EndgameReviewStateSnapshot | null;
  /** Final classification used for scoring. Optional only for v1 backward compatibility. */
  readonly endgameClassification?: EndgameClassification | null;
  readonly finalScore: FinalScore | null;
}
