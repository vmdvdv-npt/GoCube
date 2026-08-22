import type { GameState } from '../game/types';
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
}

export interface EndgameClassifier {
  analyze(context: EndgameAnalysisContext): Promise<EndgameProposal>;
}
