import { compareEndgamePointIds } from './EndgameGroupIdentity';
import type { EndgameGraph } from './EndgameGraphCore';
import type { BoardOccupancy, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

export const BENSON_PASS_ALIVE_ALGORITHM = 'benson-pass-alive-v2';

const REQUIRED_VITAL_REGION_COUNT = 2;

/**
 * A Benson color-region is a connected component of points not occupied by
 * the analyzed color. Opponent stones therefore participate in region
 * connectivity, while only empty points participate in the vital relation.
 */
export interface BensonColorRegion {
  readonly key: string;
  readonly color: StoneColor;
  readonly points: readonly PointId[];
  readonly boundaryGroups: readonly string[];
  readonly vitalGroups: readonly string[];
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const occupancyAt = (board: BoardOccupancy, point: PointId): StoneColor | 'empty' => {
  const occupancy = board[point];
  if (occupancy !== 'black' && occupancy !== 'white' && occupancy !== 'empty') {
    throw new Error(`Board has no valid occupancy for topology point: ${point}`);
  }
  return occupancy;
};

/**
 * Builds the color-specific non-color regions used by Benson/pass-alive.
 *
 * This follows the Moka/Benson decomposition rather than reusing ordinary
 * empty components: points occupied by the opponent remain inside the
 * non-color flood fill, and the vital-group intersection is evaluated over
 * empty points only.
 */
export const buildBensonColorRegions = (
  board: BoardOccupancy,
  topology: Topology,
  graph: EndgameGraph,
  color: StoneColor,
): readonly BensonColorRegion[] => {
  const points = [...topology.points()].sort(compareEndgamePointIds);
  const visited = new Set<PointId>();
  const regions: BensonColorRegion[] = [];

  for (const start of points) {
    if (visited.has(start) || occupancyAt(board, start) === color) continue;

    const pending: PointId[] = [start];
    const regionPoints: PointId[] = [];
    const boundaryGroups = new Set<string>();
    let vitalGroups: Set<string> | null = null;

    while (pending.length > 0) {
      const point = pending.pop()!;
      if (visited.has(point)) continue;

      const occupancy = occupancyAt(board, point);
      if (occupancy === color) continue;

      visited.add(point);
      regionPoints.push(point);
      const adjacentFriendlyGroups = new Set<string>();

      for (const neighbor of topology.neighbors(point)) {
        const neighborOccupancy = occupancyAt(board, neighbor);
        if (neighborOccupancy === color) {
          const groupKey = graph.stringByPoint.get(neighbor);
          const group = groupKey ? graph.stringsByKey.get(groupKey) : undefined;
          if (!groupKey || group?.color !== color) {
            throw new Error(`Benson graph has no matching ${color} string for point: ${neighbor}`);
          }
          adjacentFriendlyGroups.add(groupKey);
          boundaryGroups.add(groupKey);
        } else if (!visited.has(neighbor)) {
          pending.push(neighbor);
        }
      }

      if (occupancy !== 'empty') continue;

      if (vitalGroups === null) {
        vitalGroups = new Set(adjacentFriendlyGroups);
      } else {
        for (const groupKey of vitalGroups) {
          if (!adjacentFriendlyGroups.has(groupKey)) vitalGroups.delete(groupKey);
        }
      }
    }

    regionPoints.sort(compareEndgamePointIds);
    const frozenPoints = Object.freeze(regionPoints);
    regions.push(
      Object.freeze({
        key: `${color}:${JSON.stringify(frozenPoints)}`,
        color,
        points: frozenPoints,
        boundaryGroups: Object.freeze([...boundaryGroups].sort(compareStrings)),
        vitalGroups: Object.freeze([...(vitalGroups ?? new Set<string>())].sort(compareStrings)),
      }),
    );
  }

  regions.sort((left, right) => compareStrings(left.key, right.key));
  return Object.freeze(regions);
};

/**
 * Proves Benson/pass-alive strings for one color by fixed-point elimination.
 * A surviving string must retain at least two vital non-color regions; a
 * region is removed as soon as one of its bordering strings is eliminated.
 */
export const proveBensonPassAlive = (
  board: BoardOccupancy,
  topology: Topology,
  graph: EndgameGraph,
  color: StoneColor,
): ReadonlyMap<string, readonly BensonColorRegion[]> => {
  const regions = buildBensonColorRegions(board, topology, graph, color);
  const regionsByKey = new Map(regions.map((region) => [region.key, region] as const));
  const remainingGroups = new Set(
    graph.strings.filter((group) => group.color === color).map((group) => group.key),
  );
  const remainingRegions = new Set(regions.map((region) => region.key));

  while (true) {
    const groupsToRemove: string[] = [];

    for (const groupKey of remainingGroups) {
      let vitalRegionCount = 0;
      for (const regionKey of remainingRegions) {
        const region = regionsByKey.get(regionKey);
        if (!region) throw new Error(`Missing Benson region: ${regionKey}`);
        if (region.vitalGroups.includes(groupKey)) vitalRegionCount += 1;
      }
      if (vitalRegionCount < REQUIRED_VITAL_REGION_COUNT) groupsToRemove.push(groupKey);
    }

    if (groupsToRemove.length === 0) break;

    const removedGroups = new Set(groupsToRemove);
    for (const groupKey of removedGroups) remainingGroups.delete(groupKey);

    for (const regionKey of [...remainingRegions]) {
      const region = regionsByKey.get(regionKey);
      if (!region) throw new Error(`Missing Benson region: ${regionKey}`);
      if (region.boundaryGroups.some((groupKey) => removedGroups.has(groupKey))) {
        remainingRegions.delete(regionKey);
      }
    }
  }

  const proofs = new Map<string, readonly BensonColorRegion[]>();
  for (const groupKey of [...remainingGroups].sort(compareStrings)) {
    const vitalRegions = [...remainingRegions]
      .map((regionKey) => regionsByKey.get(regionKey)!)
      .filter((region) => region.vitalGroups.includes(groupKey))
      .sort((left, right) => compareStrings(left.key, right.key));

    if (vitalRegions.length >= REQUIRED_VITAL_REGION_COUNT) {
      proofs.set(groupKey, Object.freeze(vitalRegions));
    }
  }

  return proofs;
};
