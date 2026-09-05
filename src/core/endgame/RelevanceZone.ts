import type { BoardOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { proveBensonPassAlive } from './BensonPassAlive';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { compareEndgamePointIds } from './EndgameGroupIdentity';

export const RELEVANCE_ZONE_ALGORITHM = 'relevance-zone-v2';

export type RelevanceZoneOutcome = 'bounded' | 'unknown-boundary';
export type RelevanceZoneReason =
  | 'bounded-closure'
  | 'target-mismatch'
  | 'max-points-exceeded'
  | 'localisation-covers-whole-board';

export interface RelevanceZoneOptions {
  readonly maxPoints?: number;
}

export interface RelevanceZoneResult {
  readonly algorithm: typeof RELEVANCE_ZONE_ALGORITHM;
  readonly outcome: RelevanceZoneOutcome;
  readonly reason: RelevanceZoneReason;
  readonly targetGroupKey: string;
  readonly points: readonly PointId[];
  readonly stringKeys: readonly string[];
  readonly emptyRegionKeys: readonly string[];
  readonly boundarySafeGroupKeys: readonly string[];
  readonly localPositionKey: string | null;
}

const DEFAULT_MAX_POINTS = 96;
const compareStrings = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const freezeSortedPoints = (points: Iterable<PointId>): readonly PointId[] => Object.freeze([...points].sort(compareEndgamePointIds));
const freezeSortedStrings = (values: Iterable<string>): readonly string[] => Object.freeze([...values].sort(compareStrings));

const collectBensonSafeGroupKeys = (
  board: BoardOccupancy,
  topology: Topology,
): ReadonlySet<string> => {
  const graph = buildEndgameStaticGraph(board, topology);
  const safe = new Set<string>();
  for (const color of ['black', 'white'] as const) {
    for (const groupKey of proveBensonPassAlive(board, topology, graph, color).aliveGroups.keys()) {
      safe.add(groupKey);
    }
  }
  return safe;
};

const makeLocalPositionKey = (
  board: BoardOccupancy,
  topology: Topology,
  targetGroupKey: string,
  points: readonly PointId[],
  boundarySafeGroupKeys: readonly string[],
): string => JSON.stringify({
  topology: topology.id,
  targetGroupKey,
  occupancy: points.map((point) => [point, board[point]] as const),
  boundarySafeGroupKeys,
});

const makeResult = (
  board: BoardOccupancy,
  topology: Topology,
  targetGroupKey: string,
  outcome: RelevanceZoneOutcome,
  reason: RelevanceZoneReason,
  points: ReadonlySet<PointId>,
  stringKeys: ReadonlySet<string>,
  emptyRegionKeys: ReadonlySet<string>,
  boundarySafeGroupKeys: ReadonlySet<string>,
): RelevanceZoneResult => {
  const frozenPoints = freezeSortedPoints(points);
  const frozenStrings = freezeSortedStrings(stringKeys);
  const frozenRegions = freezeSortedStrings(emptyRegionKeys);
  const frozenBoundary = freezeSortedStrings(boundarySafeGroupKeys);
  return Object.freeze({
    algorithm: RELEVANCE_ZONE_ALGORITHM,
    outcome,
    reason,
    targetGroupKey,
    points: frozenPoints,
    stringKeys: frozenStrings,
    emptyRegionKeys: frozenRegions,
    boundarySafeGroupKeys: frozenBoundary,
    localPositionKey: outcome === 'bounded'
      ? makeLocalPositionKey(board, topology, targetGroupKey, frozenPoints, frozenBoundary)
      : null,
  });
};

/**
 * Conservative topology-neutral dependency closure ported from the frozen
 * Endgame Engine. Benson/pass-alive strings are certified separators. If the
 * dependency closure becomes global or exceeds the cap, locality is not proved
 * and the caller must fail closed.
 */
export const buildRelevanceZone = (
  target: EndgameStoneString,
  board: BoardOccupancy,
  topology: Topology,
  options: RelevanceZoneOptions = {},
): RelevanceZoneResult => {
  const maxPoints = options.maxPoints ?? DEFAULT_MAX_POINTS;
  if (!Number.isInteger(maxPoints) || maxPoints < 1) {
    throw new Error(`Relevance zone maxPoints must be a positive integer: ${maxPoints}`);
  }

  const graph = buildEndgameStaticGraph(board, topology);
  const currentTarget = graph.stringsByKey.get(target.key);
  const zonePoints = new Set<PointId>();
  const stringKeys = new Set<string>();
  const regionKeys = new Set<string>();
  const boundarySafeGroupKeys = new Set<string>();

  if (!currentTarget || currentTarget.color !== target.color) {
    return makeResult(board, topology, target.key, 'unknown-boundary', 'target-mismatch', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
  }

  const regionsByKey = new Map(graph.emptyRegions.map((region) => [region.key, region] as const));
  const regionByPoint = new Map<PointId, string>();
  for (const region of graph.emptyRegions) for (const point of region.points) regionByPoint.set(point, region.key);
  const safeGroupKeys = collectBensonSafeGroupKeys(board, topology);
  const pendingGroups: string[] = [currentTarget.key];
  const pendingRegions: string[] = [];
  const processedGroups = new Set<string>();
  const processedRegions = new Set<string>();

  const addPoint = (point: PointId): boolean => {
    zonePoints.add(point);
    return zonePoints.size <= maxPoints;
  };

  while (pendingGroups.length > 0 || pendingRegions.length > 0) {
    while (pendingGroups.length > 0) {
      const groupKey = pendingGroups.pop()!;
      if (processedGroups.has(groupKey)) continue;
      processedGroups.add(groupKey);
      const group = graph.stringsByKey.get(groupKey);
      if (!group) {
        return makeResult(board, topology, target.key, 'unknown-boundary', 'target-mismatch', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
      }

      stringKeys.add(groupKey);
      for (const point of group.points) {
        if (!addPoint(point)) {
          return makeResult(board, topology, target.key, 'unknown-boundary', 'max-points-exceeded', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
        }
      }

      if (safeGroupKeys.has(groupKey)) {
        boundarySafeGroupKeys.add(groupKey);
        continue;
      }

      for (const point of group.points) {
        for (const neighbor of topology.neighbors(point)) {
          const adjacentGroupKey = graph.stringByPoint.get(neighbor);
          if (adjacentGroupKey && adjacentGroupKey !== groupKey && !processedGroups.has(adjacentGroupKey)) {
            pendingGroups.push(adjacentGroupKey);
          }
        }
      }
      for (const liberty of group.liberties) {
        const regionKey = regionByPoint.get(liberty);
        if (regionKey && !processedRegions.has(regionKey)) pendingRegions.push(regionKey);
      }
    }

    while (pendingRegions.length > 0) {
      const regionKey = pendingRegions.pop()!;
      if (processedRegions.has(regionKey)) continue;
      processedRegions.add(regionKey);
      const region = regionsByKey.get(regionKey);
      if (!region) continue;
      regionKeys.add(regionKey);
      for (const point of region.points) {
        if (!addPoint(point)) {
          return makeResult(board, topology, target.key, 'unknown-boundary', 'max-points-exceeded', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
        }
      }
      for (const groupKey of region.boundaryGroups) {
        if (!processedGroups.has(groupKey)) pendingGroups.push(groupKey);
      }
    }
  }

  if (zonePoints.size >= topology.points().length) {
    return makeResult(board, topology, target.key, 'unknown-boundary', 'localisation-covers-whole-board', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
  }

  return makeResult(board, topology, target.key, 'bounded', 'bounded-closure', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
};
