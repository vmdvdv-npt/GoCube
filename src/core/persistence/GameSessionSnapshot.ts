import type {
  EndgameClassification,
  EndgameEvidence,
  EndgameProposalStatus,
  GroupStatus,
} from '../endgame/EndgameClassifier';
import type { GameState, RuleSet } from '../game/types';
import type { FinalScore } from '../scoring/Scoring';
import type { PointId } from '../topology/Topology';

/**
 * Snapshot v1 remains readable through an additive compatibility policy.
 * New writers persist proposal + userDecision while also emitting deprecated
 * effective `status` so existing v1 saves and callers continue to round-trip.
 */
export const GAME_SESSION_SNAPSHOT_VERSION = 1 as const;

export interface EndgameReviewProposalSnapshot {
  readonly status: EndgameProposalStatus;
  readonly evidence?: EndgameEvidence;
}

export interface EndgameReviewGroupSnapshot {
  readonly points: readonly PointId[];
  /** New 0.3 proposal data. Missing in legacy v1 snapshots. */
  readonly proposal?: EndgameReviewProposalSnapshot;
  /** New 0.3 authoritative manual override. Missing in legacy v1 snapshots. */
  readonly userDecision?: GroupStatus | null;
  /** @deprecated v1 compatibility field; interpreted as a user decision when proposal is absent. */
  readonly status?: GroupStatus | null;
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
  /** Partial endgame review. Legacy v1 snapshots may contain only points + status. */
  readonly endgameReview?: EndgameReviewStateSnapshot | null;
  /** Final classification used for scoring. Optional only for v1 backward compatibility. */
  readonly endgameClassification?: EndgameClassification | null;
  readonly finalScore: FinalScore | null;
}
