import type { BoardOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { tryProveBensonPassAlive } from './BensonPassAlive';
import {
  buildEndgameStaticGraph,
  tryBuildEndgameStaticGraph,
  type EndgameStaticGraph,
  type EndgameStoneString,
} from './EndgameStaticGraph';
import { compareEndgamePointIds } from './EndgameGroupIdentity';

export const RELEVANCE_ZONE_ALGORITHM = 'relevance-zone-v3';

export type RelevanceZoneOutcome = 'bounded' | 'unknown-boundary';
export type RelevanceZoneReason =
  | 'bounded-closure'
  | 'target-mismatch'
  | 'max-points-exceeded'
  | 'localisation-covers-whole-board'
  | 'interrupted';

export interface RelevanceZoneOptions {
  readonly maxPoints?: number;
  readonly graph?: EndgameStaticGraph;
  readonly safeGroupKeys?: ReadonlySet<string>;
  readonly shouldStop?: () => boolean;
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

/** Compute the pass-alive separator set once and reuse it across candidate zones. */
export const collectBensonSafeGroupKeys = (
  board: BoardOccupancy,
  topology: Topology,
  graph: EndgameStaticGraph = buildEndgameStaticGraph(board, topology),
  shouldStop: () => boolean = () => false,
): ReadonlySet<string> | null => {
  const safe = new Set<string>();
  for (const color of ['black', 'white'] as const) {
    if (shouldStop()) return null;
    const proof = tryProveBensonPassAlive(board, topology, graph, color, { shouldStop });
    if (!proof) return null;
    for (const groupKey of proof.aliveGroups.keys()) safe.add(groupKey);
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
 * Topology-neutral dependency closure. Benson/pass-alive strings are certified
 * separators and are recorded as boundary facts rather than copied wholesale
 * into the local zone. This is a strict improvement over v2: a large proven-
 * alive wall no longer consumes the local point budget, while no artificial
 * radius or inaccessible outside area is introduced.
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
  const shouldStop = options.shouldStop ?? (() => false);

  const emptyPoints = new Set<PointId>();
  const emptyStrings = new Set<string>();
  const emptyRegions = new Set<string>();
  const emptyBoundary = new Set<string>();
  const interrupted = (): RelevanceZoneResult =>
    makeResult(board, topology, target.key, 'unknown-boundary', 'interrupted', emptyPoints, emptyStrings, emptyRegions, emptyBoundary);

  if (shouldStop()) return interrupted();
  const graph = options.graph ?? tryBuildEndgameStaticGraph(board, topology, { shouldStop });
  if (!graph) return interrupted();
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
  for (const region of graph.emptyRegions) {
    if (shouldStop()) return interrupted();
    for (const point of region.points) regionByPoint.set(point, region.key);
  }
  const safeGroupKeys = options.safeGroupKeys
    ?? collectBensonSafeGroupKeys(board, topology, graph, shouldStop);
  if (!safeGroupKeys) return interrupted();

  const pendingGroups: string[] = [currentTarget.key];
  const pendingRegions: string[] = [];
  const processedGroups = new Set<string>();
  const processedRegions = new Set<string>();

  const addPoint = (point: PointId): boolean => {
    zonePoints.add(point);
    return zonePoints.size <= maxPoints;
  };

  while (pendingGroups.length > 0 || pendingRegions.length > 0) {
    if (shouldStop()) {
      return makeResult(board, topology, target.key, 'unknown-boundary', 'interrupted', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
    }

    while (pendingGroups.length > 0) {
      if (shouldStop()) return interrupted();
      const groupKey = pendingGroups.pop()!;
      if (processedGroups.has(groupKey)) continue;
      processedGroups.add(groupKey);
      const group = graph.stringsByKey.get(groupKey);
      if (!group) {
        return makeResult(board, topology, target.key, 'unknown-boundary', 'target-mismatch', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
      }

      // A Benson/pass-alive group is an unconditional separator. Do not charge
      // its potentially large body against the local zone; record the certified
      // boundary and stop dependency expansion through it.
      if (safeGroupKeys.has(groupKey) && groupKey !== currentTarget.key) {
        boundarySafeGroupKeys.add(groupKey);
        continue;
      }

      stringKeys.add(groupKey);
      for (const point of group.points) {
        if (shouldStop()) return interrupted();
        if (!addPoint(point)) {
          return makeResult(board, topology, target.key, 'unknown-boundary', 'max-points-exceeded', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
        }
      }

      if (safeGroupKeys.has(groupKey)) {
        boundarySafeGroupKeys.add(groupKey);
        continue;
      }

      for (const point of group.points) {
        if (shouldStop()) return interrupted();
        for (const neighbor of topology.neighbors(point)) {
          const adjacentGroupKey = graph.stringByPoint.get(neighbor);
          if (!adjacentGroupKey || adjacentGroupKey === groupKey || processedGroups.has(adjacentGroupKey)) continue;
          if (safeGroupKeys.has(adjacentGroupKey)) boundarySafeGroupKeys.add(adjacentGroupKey);
          else pendingGroups.push(adjacentGroupKey);
        }
      }
      for (const liberty of group.liberties) {
        const regionKey = regionByPoint.get(liberty);
        if (regionKey && !processedRegions.has(regionKey)) pendingRegions.push(regionKey);
      }
    }

    while (pendingRegions.length > 0) {
      if (shouldStop()) return interrupted();
      const regionKey = pendingRegions.pop()!;
      if (processedRegions.has(regionKey)) continue;
      processedRegions.add(regionKey);
      const region = regionsByKey.get(regionKey);
      if (!region) continue;
      regionKeys.add(regionKey);
      for (const point of region.points) {
        if (shouldStop()) return interrupted();
        if (!addPoint(point)) {
          return makeResult(board, topology, target.key, 'unknown-boundary', 'max-points-exceeded', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
        }
      }
      for (const groupKey of region.boundaryGroups) {
        if (safeGroupKeys.has(groupKey)) {
          boundarySafeGroupKeys.add(groupKey);
          processedGroups.add(groupKey);
        } else if (!processedGroups.has(groupKey)) {
          pendingGroups.push(groupKey);
        }
      }
    }
  }

  if (shouldStop()) return interrupted();
  if (zonePoints.size >= topology.points().length) {
    return makeResult(board, topology, target.key, 'unknown-boundary', 'localisation-covers-whole-board', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
  }

  return makeResult(board, topology, target.key, 'bounded', 'bounded-closure', zonePoints, stringKeys, regionKeys, boundarySafeGroupKeys);
};
