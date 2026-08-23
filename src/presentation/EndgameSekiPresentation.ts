import { compareEndgamePointIds } from '../core/endgame/EndgameGroupIdentity';
import type { PointId, Topology } from '../core/topology/Topology';
import {
  buildEndgameGroupEdges,
  type EndgameGroupEdge,
  type EndgameGroupRenderState,
} from './EndgameGroupPresentation';

export interface EndgameSekiRegionPresentation {
  readonly id: string;
  readonly groupIds: readonly string[];
  readonly points: readonly PointId[];
  readonly edges: readonly EndgameGroupEdge[];
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const connect = (
  adjacency: Map<string, Set<string>>,
  left: string,
  right: string,
): void => {
  if (left === right) return;
  adjacency.get(left)?.add(right);
  adjacency.get(right)?.add(left);
};

/**
 * Builds renderer-neutral visual regions for Seki.
 *
 * Opposing groups marked Seki are merged when they touch directly or share an
 * empty liberty. A shared liberty is painted only when every occupied neighbor
 * around that point is also a Seki group and both colors are represented. This
 * keeps ordinary outside liberties out of the gray mask while making the mutual
 * life area read as one continuous region with no black/white internal border.
 */
export const buildEndgameSekiRegions = (
  groups: readonly EndgameGroupRenderState[],
  topology: Topology,
): readonly EndgameSekiRegionPresentation[] => {
  const sekiGroups = groups.filter((group) => group.status === 'seki');
  if (sekiGroups.length === 0) return Object.freeze([]);

  const groupByPoint = new Map<PointId, EndgameGroupRenderState>();
  for (const group of groups) {
    for (const point of group.points) {
      if (!topology.has(point)) continue;
      groupByPoint.set(point, group);
    }
  }

  const sekiById = new Map(sekiGroups.map((group) => [group.id, group] as const));
  const adjacency = new Map<string, Set<string>>(
    sekiGroups.map((group) => [group.id, new Set<string>()]),
  );

  for (const group of sekiGroups) {
    for (const point of group.points) {
      for (const neighbor of topology.neighbors(point)) {
        const neighborGroup = groupByPoint.get(neighbor);
        if (neighborGroup?.status !== 'seki') continue;
        connect(adjacency, group.id, neighborGroup.id);
      }
    }
  }

  const sharedLiberties: Array<Readonly<{ point: PointId; groupIds: readonly string[] }>> = [];
  for (const point of topology.points()) {
    if (groupByPoint.has(point)) continue;

    const occupiedNeighbors = topology
      .neighbors(point)
      .flatMap((neighbor) => {
        const group = groupByPoint.get(neighbor);
        return group ? [group] : [];
      });
    if (occupiedNeighbors.length === 0) continue;
    if (occupiedNeighbors.some((group) => group.status !== 'seki')) continue;

    const groupIds = [...new Set(occupiedNeighbors.map((group) => group.id))].sort(compareText);
    if (groupIds.length < 2) continue;

    const colors = new Set(groupIds.map((groupId) => sekiById.get(groupId)?.color));
    if (!colors.has('black') || !colors.has('white')) continue;

    sharedLiberties.push(Object.freeze({ point, groupIds: Object.freeze(groupIds) }));
    for (let left = 0; left < groupIds.length; left += 1) {
      for (let right = left + 1; right < groupIds.length; right += 1) {
        connect(adjacency, groupIds[left]!, groupIds[right]!);
      }
    }
  }

  const pending = new Set(sekiGroups.map((group) => group.id));
  const regions: EndgameSekiRegionPresentation[] = [];

  while (pending.size > 0) {
    const start = [...pending].sort(compareText)[0]!;
    const component = new Set<string>([start]);
    const queue = [start];
    pending.delete(start);

    while (queue.length > 0) {
      const groupId = queue.shift()!;
      for (const neighborId of adjacency.get(groupId) ?? []) {
        if (component.has(neighborId)) continue;
        component.add(neighborId);
        pending.delete(neighborId);
        queue.push(neighborId);
      }
    }

    const groupIds = [...component].sort(compareText);
    const regionPoints = new Set<PointId>();
    for (const groupId of groupIds) {
      for (const point of sekiById.get(groupId)?.points ?? []) regionPoints.add(point);
    }
    for (const liberty of sharedLiberties) {
      if (liberty.groupIds.every((groupId) => component.has(groupId))) {
        regionPoints.add(liberty.point);
      }
    }

    const points = [...regionPoints].sort(compareEndgamePointIds);
    regions.push(
      Object.freeze({
        id: `seki:${groupIds.join('|')}`,
        groupIds: Object.freeze(groupIds),
        points: Object.freeze(points),
        edges: buildEndgameGroupEdges(points, topology),
      }),
    );
  }

  regions.sort((left, right) => compareText(left.id, right.id));
  return Object.freeze(regions);
};
