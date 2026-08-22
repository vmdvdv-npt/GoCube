import type { PointId } from '../topology/Topology';

export const compareEndgamePointIds = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const canonicalizeEndgameGroup = (
  points: readonly PointId[],
): readonly PointId[] => Object.freeze([...points].sort(compareEndgamePointIds));

export const endgameGroupId = (points: readonly PointId[]): string =>
  JSON.stringify(canonicalizeEndgameGroup(points));
