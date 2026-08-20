import type { PointId } from '../topology/Topology';

export type GroupStatus = 'alive' | 'dead' | 'seki';

export interface GroupClassification {
  points: readonly PointId[];
  status: GroupStatus;
  source: 'automatic' | 'user';
}

export interface EndgameClassifier {
  classify(groups: readonly (readonly PointId[])[]): Promise<readonly GroupClassification[]>;
}
