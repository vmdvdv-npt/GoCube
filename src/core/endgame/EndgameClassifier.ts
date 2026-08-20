import type { PointId } from '../topology/Topology';

export type GroupStatus = 'alive' | 'dead' | 'seki';

export interface GroupClassification {
  readonly points: readonly PointId[];
  readonly status: GroupStatus;
  readonly source: 'automatic' | 'user';
}

/** Serializable final group classification consumed by scoring strategies. */
export type EndgameClassification = readonly GroupClassification[];

export interface EndgameClassifier {
  classify(groups: readonly (readonly PointId[])[]): Promise<EndgameClassification>;
}
