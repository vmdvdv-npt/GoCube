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

interface SharedSekiLiberty {
  readonly point: PointId;
  readonly groupIds: readonly string[];
}

interface CompactSekiLibertyRegion {
  readonly points: readonly PointId[];
  readonly boundaryGroupIds: readonly string[];
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

const collectSharedSekiLiberties = (
  topology: Topology,
  groupByPoint: ReadonlyMap<PointId, EndgameGroupRenderState>,
): readonly SharedSekiLiberty[] => {
  const result: SharedSekiLiberty[] = [];

  for (const point of topology.points()) {
    if (groupByPoint.has(point)) continue;

    const occupiedNeighbors = topology.neighbors(point).flatMap((neighbor) => {
      const group = groupByPoint.get(neighbor);
      return group ? [group] : [];
    });
    if (occupiedNeighbors.length === 0) continue;
    if (occupiedNeighbors.some((group) => group.status !== 'seki')) continue;

    const groupIds = [...new Set(occupiedNeighbors.map((group) => group.id))].sort(compareText);
    if (groupIds.length < 2) continue;

    const colors = new Set(occupiedNeighbors.map((group) => group.color));
    if (!colors.has('black') || !colors.has('white')) continue;

    result.push(Object.freeze({ point, groupIds: Object.freeze(groupIds) }));
  }

  return Object.freeze(result);
};

const collectCompactSekiLibertyRegions = (
  topology: Topology,
  groupByPoint: ReadonlyMap<PointId, EndgameGroupRenderState>,
): readonly CompactSekiLibertyRegion[] => {
  const visited = new Set<PointId>();
  const result: CompactSekiLibertyRegion[] = [];

  for (const start of topology.points()) {
    if (groupByPoint.has(start) || visited.has(start)) continue;

    const points: PointId[] = [];
    const boundaryGroups = new Map<string, EndgameGroupRenderState>();
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const point = queue.shift()!;
      points.push(point);

      for (const neighbor of topology.neighbors(point)) {
        const boundaryGroup = groupByPoint.get(neighbor);
        if (boundaryGroup) {
          boundaryGroups.set(boundaryGroup.id, boundaryGroup);
          continue;
        }
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }

    if (boundaryGroups.size === 0) continue;
    if ([...boundaryGroups.values()].some((group) => group.status !== 'seki')) continue;

    // A compact internal liberty/eye is an empty connected region in which every
    // point is adjacent to a Seki stone. Large outside empty regions therefore
    // stay outside the gray presentation region.
    const everyPointIsSekiLiberty = points.every((point) =>
      topology.neighbors(point).some((neighbor) => groupByPoint.get(neighbor)?.status === 'seki'),
    );
    if (!everyPointIsSekiLiberty) continue;

    result.push(Object.freeze({
      points: Object.freeze([...points].sort(compareEndgamePointIds)),
      boundaryGroupIds: Object.freeze([...boundaryGroups.keys()].sort(compareText)),
    }));
  }

  return Object.freeze(result);
};

/**
 * Builds renderer-neutral visual regions for Seki.
 *
 * Opposing groups marked Seki are merged when they touch directly, share a
 * liberty, or bound the same compact liberty region. Once a mixed-color Seki
 * component exists, its shared liberties and compact internal liberties/eyes
 * join one visual shape. That removes black/white and empty-hole boundaries
 * inside the gray region while leaving unrelated outside emptiness untouched.
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

  const sharedLiberties = collectSharedSekiLiberties(topology, groupByPoint);
  for (const liberty of sharedLiberties) {
    for (let left = 0; left < liberty.groupIds.length; left += 1) {
      for (let right = left + 1; right < liberty.groupIds.length; right += 1) {
        connect(adjacency, liberty.groupIds[left]!, liberty.groupIds[right]!);
      }
    }
  }

  const compactLibertyRegions = collectCompactSekiLibertyRegions(topology, groupByPoint);
  for (const libertyRegion of compactLibertyRegions) {
    if (libertyRegion.boundaryGroupIds.length < 2) continue;
    const colors = new Set(
      libertyRegion.boundaryGroupIds.map((groupId) => sekiById.get(groupId)?.color),
    );
    if (!colors.has('black') || !colors.has('white')) continue;

    for (let left = 0; left < libertyRegion.boundaryGroupIds.length; left += 1) {
      for (let right = left + 1; right < libertyRegion.boundaryGroupIds.length; right += 1) {
        connect(
          adjacency,
          libertyRegion.boundaryGroupIds[left]!,
          libertyRegion.boundaryGroupIds[right]!,
        );
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
    const componentColors = new Set(groupIds.map((groupId) => sekiById.get(groupId)?.color));
    const isOpposingColorSeki = componentColors.has('black') && componentColors.has('white');
    const regionPoints = new Set<PointId>();
    for (const groupId of groupIds) {
      for (const point of sekiById.get(groupId)?.points ?? []) regionPoints.add(point);
    }

    if (isOpposingColorSeki) {
      for (const liberty of sharedLiberties) {
        if (liberty.groupIds.every((groupId) => component.has(groupId))) {
          regionPoints.add(liberty.point);
        }
      }
      for (const libertyRegion of compactLibertyRegions) {
        if (
          libertyRegion.boundaryGroupIds.length > 0 &&
          libertyRegion.boundaryGroupIds.every((groupId) => component.has(groupId))
        ) {
          for (const point of libertyRegion.points) regionPoints.add(point);
        }
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
