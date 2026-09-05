import { compareEndgamePointIds } from './EndgameGroupIdentity';
import type { EndgameStaticGraph } from './EndgameStaticGraph';
import type { BoardOccupancy, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

export const BENSON_PASS_ALIVE_ALGORITHM = 'benson-pass-alive-v1';
export const KATAGO_RULES_VERSION = 3;
export const KATAGO_REFERENCE_COMMIT = 'f6bc4b19a1686caa2d088b56251e8c11c8be6d51';

const REQUIRED_VITAL_REGION_COUNT = 2;

export interface BensonColorRegion {
  readonly key: string;
  readonly color: StoneColor;
  readonly points: readonly PointId[];
  readonly boundaryGroups: readonly string[];
  readonly vitalGroups: readonly string[];
  readonly containsOpponent: boolean;
  readonly internalSpacesMax2: 0 | 1 | 2;
}

export interface BensonPassAliveResult {
  readonly color: StoneColor;
  readonly regions: readonly BensonColorRegion[];
  readonly aliveGroups: ReadonlyMap<string, readonly BensonColorRegion[]>;
  readonly iterations: number;
}

export interface BensonPassAliveOptions {
  readonly shouldStop?: () => boolean;
}

export class BensonPassAliveInterrupted extends Error {
  constructor() {
    super('Benson/pass-alive proof interrupted');
    this.name = 'BensonPassAliveInterrupted';
  }
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

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const checkerFor = (options: BensonPassAliveOptions): (() => void) => {
  const shouldStop = options.shouldStop ?? (() => false);
  return () => {
    if (shouldStop()) throw new BensonPassAliveInterrupted();
  };
};

type BensonColorCache = Partial<Record<StoneColor, BensonPassAliveResult>>;
const bensonCache = new WeakMap<object, WeakMap<object, BensonColorCache>>();

const cachedBenson = (
  board: BoardOccupancy,
  topology: Topology,
  color: StoneColor,
): BensonPassAliveResult | null =>
  bensonCache.get(board as object)?.get(topology as object)?.[color] ?? null;

const cacheBenson = (
  board: BoardOccupancy,
  topology: Topology,
  color: StoneColor,
  result: BensonPassAliveResult,
): BensonPassAliveResult => {
  let byTopology = bensonCache.get(board as object);
  if (!byTopology) {
    byTopology = new WeakMap<object, BensonColorCache>();
    bensonCache.set(board as object, byTopology);
  }
  let byColor = byTopology.get(topology as object);
  if (!byColor) {
    byColor = {};
    byTopology.set(topology as object, byColor);
  }
  byColor[color] = result;
  return result;
};

/**
 * KataGo Rules v3 / Board::calculateAreaForPla compatible region construction
 * for GoCube's suicide-illegal rules: maximal non-color regions include empty
 * points and opponent stones, while vitality is filtered on empty points only.
 */
export const buildBensonColorRegions = (
  board: BoardOccupancy,
  topology: Topology,
  graph: EndgameStaticGraph,
  color: StoneColor,
  options: BensonPassAliveOptions = {},
): readonly BensonColorRegion[] => {
  const checkpoint = checkerFor(options);
  checkpoint();
  const points = [...topology.points()].sort(compareEndgamePointIds);
  const visited = new Set<PointId>();
  const regions: BensonColorRegion[] = [];
  const opponent = opponentOf(color);

  for (const start of points) {
    checkpoint();
    if (visited.has(start) || occupancyAt(board, start) !== 'empty') continue;

    const pending: PointId[] = [start];
    const regionPoints: PointId[] = [];
    const boundaryGroups = new Set<string>();
    let vitalGroups: Set<string> | null = null;
    let containsOpponent = false;
    let internalSpacesMax2: 0 | 1 | 2 = 0;

    while (pending.length > 0) {
      checkpoint();
      const point = pending.pop()!;
      if (visited.has(point)) continue;
      const occupancy = occupancyAt(board, point);
      if (occupancy === color) continue;

      visited.add(point);
      regionPoints.push(point);
      if (occupancy === opponent) containsOpponent = true;

      const adjacentFriendlyGroups = new Set<string>();
      let adjacentToFriendly = false;

      for (const neighbor of topology.neighbors(point)) {
        checkpoint();
        const neighborOccupancy = occupancyAt(board, neighbor);
        if (neighborOccupancy === color) {
          adjacentToFriendly = true;
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

      if (!adjacentToFriendly && internalSpacesMax2 < 2) {
        internalSpacesMax2 = (internalSpacesMax2 + 1) as 1 | 2;
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
        containsOpponent,
        internalSpacesMax2,
      }),
    );
  }

  regions.sort((left, right) => compareStrings(left.key, right.key));
  checkpoint();
  return Object.freeze(regions);
};

export const proveBensonPassAlive = (
  board: BoardOccupancy,
  topology: Topology,
  graph: EndgameStaticGraph,
  color: StoneColor,
  options: BensonPassAliveOptions = {},
): BensonPassAliveResult => {
  const checkpoint = checkerFor(options);
  checkpoint();
  const previous = cachedBenson(board, topology, color);
  if (previous) return previous;

  const regions = buildBensonColorRegions(board, topology, graph, color, options);
  const regionsByKey = new Map(regions.map((region) => [region.key, region] as const));
  const remainingGroups = new Set(
    graph.strings.filter((group) => group.color === color).map((group) => group.key),
  );
  const remainingRegions = new Set(regions.map((region) => region.key));
  let iterations = 0;

  while (true) {
    checkpoint();
    iterations += 1;
    const groupsToRemove: string[] = [];

    for (const groupKey of remainingGroups) {
      checkpoint();
      let vitalRegionCount = 0;
      for (const regionKey of remainingRegions) {
        checkpoint();
        const region = regionsByKey.get(regionKey);
        if (!region) throw new Error(`Missing Benson region: ${regionKey}`);
        if (region.vitalGroups.includes(groupKey)) vitalRegionCount += 1;
      }
      if (vitalRegionCount < REQUIRED_VITAL_REGION_COUNT) groupsToRemove.push(groupKey);
    }

    if (groupsToRemove.length === 0) break;

    const removedGroups = new Set(groupsToRemove);
    for (const groupKey of removedGroups) remainingGroups.delete(groupKey);

    for (const regionKey of remainingRegions) {
      checkpoint();
      const region = regionsByKey.get(regionKey);
      if (!region) throw new Error(`Missing Benson region: ${regionKey}`);
      if (region.boundaryGroups.some((groupKey) => removedGroups.has(groupKey))) {
        remainingRegions.delete(regionKey);
      }
    }
  }

  const aliveGroups = new Map<string, readonly BensonColorRegion[]>();
  for (const groupKey of [...remainingGroups].sort(compareStrings)) {
    checkpoint();
    const vitalRegions = [...remainingRegions]
      .map((regionKey) => regionsByKey.get(regionKey)!)
      .filter((region) => region.vitalGroups.includes(groupKey))
      .sort((left, right) => compareStrings(left.key, right.key));

    if (vitalRegions.length >= REQUIRED_VITAL_REGION_COUNT) {
      aliveGroups.set(groupKey, Object.freeze(vitalRegions));
    }
  }

  checkpoint();
  return cacheBenson(
    board,
    topology,
    color,
    Object.freeze({ color, regions, aliveGroups, iterations }),
  );
};

export const tryProveBensonPassAlive = (
  board: BoardOccupancy,
  topology: Topology,
  graph: EndgameStaticGraph,
  color: StoneColor,
  options: BensonPassAliveOptions = {},
): BensonPassAliveResult | null => {
  try {
    return proveBensonPassAlive(board, topology, graph, color, options);
  } catch (error) {
    if (error instanceof BensonPassAliveInterrupted) return null;
    throw error;
  }
};
