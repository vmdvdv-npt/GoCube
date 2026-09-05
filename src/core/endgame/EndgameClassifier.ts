import type { GameState } from '../game/types';
import type { SimpleKoContext } from '../rules/SimpleKoPolicy';
import type { PointId, Topology } from '../topology/Topology';

export type GroupStatus = 'alive' | 'dead' | 'seki';
export type EndgameProposalStatus = GroupStatus | 'unresolved';

export type EndgameEvidence = Readonly<Record<string, unknown>>;

export interface EndgameGroupProposal {
  readonly points: readonly PointId[];
  readonly status: EndgameProposalStatus;
  readonly source?: 'automatic';
  readonly evidence?: EndgameEvidence;
}

/** Classifier output. It may intentionally leave any number of groups unresolved. */
export type EndgameProposal = readonly EndgameGroupProposal[];

export interface GroupClassification {
  readonly points: readonly PointId[];
  readonly status: GroupStatus;
  readonly source: 'automatic' | 'user';
}

/** Serializable final group classification consumed by scoring strategies. */
export type EndgameClassification = readonly GroupClassification[];

export interface EndgameAnalysisContext {
  readonly state: GameState;
  readonly topology: Topology;
  readonly groups: readonly (readonly PointId[])[];
  /** Exact immediate-ko context when analysis continues from a real game history. */
  readonly simpleKoContext?: SimpleKoContext;
}

export type FinalProofSearchProgressPhase = 'searching' | 'complete';

export interface FinalProofSearchProgress {
  readonly phase: FinalProofSearchProgressPhase;
  readonly totalRegions: number;
  readonly completedRegions: number;
  readonly currentGroupId: string | null;
  readonly tier: number;
  readonly resolvedAutomatically: number;
  readonly remainingUnresolved: number;
  readonly nodesExplored: number;
  readonly elapsedMilliseconds: number;
}

export type FinalProofSearchProgressListener = (
  progress: FinalProofSearchProgress,
) => void;

export interface FinalEndgameAnalysisContext extends EndgameAnalysisContext {
  /** Cheap/static proposal already visible in Endgame Review. */
  readonly proposal: EndgameProposal;
}

export interface EndgameClassifier {
  /** Cheap analysis used when Endgame Review first opens. */
  analyze(context: EndgameAnalysisContext): Promise<EndgameProposal>;

  /**
   * Optional expensive proof pass, invoked only when the user asks to finish
   * scoring. Implementations must leave incomplete proofs unresolved.
   */
  analyzeFinal?(
    context: FinalEndgameAnalysisContext,
    onProgress?: FinalProofSearchProgressListener,
  ): Promise<EndgameProposal>;
}
