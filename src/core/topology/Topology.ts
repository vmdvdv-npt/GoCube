export type PointId = string;

export interface Topology {
  readonly id: string;
  points(): readonly PointId[];
  neighbors(point: PointId): readonly PointId[];
  has(point: PointId): boolean;
}
