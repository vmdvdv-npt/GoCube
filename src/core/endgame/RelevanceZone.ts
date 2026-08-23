import type { BoardOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { proveBensonPassAlive } from './BensonPassAlive';
import { buildEndgameGraph, type EndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { compareEndgamePointIds } from './EndgameGroupIdentity';

export const RELEVANCE_ZONE_ALGORITHM = 'relevance-zone-v1';

export type RelevanceZoneOutcome = 'bounded' | 'unknown-boundary';
export type RelevanceZoneReason =
  | 'bounded-closure'
  | 'target-mismatch'
  | 'max-points-exceeded'
  | 'localisation-covers-whole-board';

export interface RelevanceZoneOptions {
  /** Deterministic safety limit. Larger regions fail closed instead of becoming global search. */
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
  /** Benson/pass-alive strings that terminate dependency expansion. */
  readonly boundarySafeGroupKeys: readonly string[];
  /**
   * Canonical local state identity. Outside occupancy is intentionally excluded;
   * the certificate is meaningful only when outcome === 'bounded'.
   */
  readonly localPositionKey: string | null;
}

const DEFAULT_MAX_POINTS = 96;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const freezeSortedPoints = (points: Iterable<PointId>): readonly PointId[] =>
  Object.freeze([...points].sort(compareEndgamePointIds));

const freezeSortedStrings = (values: Iterable<string>): readonly string[] =>
  Object.freeze([...values].sort(compareStrings));

const collectBensonSafeGroupKeys = (
  board: BoardOccupancy,
  topology: Topology,
  graph: EndgameGraph,
): ReadonlySet<string> => {
  const safe = new Set<string>();
  for (const color of ['black', 'white'] as const) {
    for (const groupKey of proveBensonPassAlive(board, topology, graph, color).keys()) {
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
): string =>
  JSON.stringify({
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
    localPositionKey:
      outcome === 'bounded'
        ? makeLocalPositionKey(board, topology, targetGroupKey, frozenPoints, frozenBoundary)
        : null,
  });
};

/**
 * Builds a conservative dependency closure for one target string.
 *
 * Expansion alternates between complete unresolved strings and complete ordinary
 * empty regions. A Benson/pass-alive string is a certified separator: its stones
 * are retained in the zone, but dependencies are not expanded through its
 * outside liberties. If that closure cannot stay local, the result fails closed
 * as unknown-boundary.
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

  const graph = buildEndgameGraph(board, topology);
  const currentTarget = graph.stringsByKey.get(target.key);
  const emptyPoints = new Set<PointId>();
  const stringKeys = new Set<string>();
  const regionKeys = new Set<string>();
  const boundarySafeGroupKeys = new Set<string>();

  if (!currentTarget || currentTarget.color !== target.color) {
    return makeResult(
      board,
      topology,
      target.key,
      'unknown-boundary',
      'target-mismatch',
      emptyPoints,
      stringKeys,
      regionKeys,
      boundarySafeGroupKeys,
    );
  }

  const safeGroupKeys = collectBensonSafeGroupKeys(board, topology, graph);
  const pendingGroups: string[] = [currentTarget.key];
  const pendingRegions: string[] = [];
  const processedGroups = new Set<string>();
  const processedRegions = new Set<string>();

  const addPoint = (point: PointId): boolean => {
    emptyPoints.add(point);
    return emptyPoints.size <= maxPoints;
  };

  while (pendingGroups.length > 0 || pendingRegions.length > 0) {
    while (pendingGroups.length > 0) {
      const groupKey = pendingGroups.pop()!;
      if (processedGroups.has(groupKey)) continue;
      processedGroups.add(groupKey);

      const group = graph.stringsByKey.get(groupKey);
      if (!group) {
        return makeResult(
          board,
          topology,
          target.key,
          'unknown-boundary',
          'target-mismatch',
          emptyPoints,
          stringKeys,
          regionKeys,
          boundarySafeGroupKeys,
        );
      }

      stringKeys.add(groupKey);
      for (const point of group.points) {
        if (!addPoint(point)) {
          return makeResult(
            board,
            topology,
            target.key,
            'unknown-boundary',
            'max-points-exceeded',
            emptyPoints,
            stringKeys,
            regionKeys,
            boundarySafeGroupKeys,
          );
        }
      }

      if (safeGroupKeys.has(groupKey)) {
        boundarySafeGroupKeys.add(groupKey);
        continue;
      }

      for (const liberty of group.liberties) {
        const regionKey = graph.regionByPoint.get(liberty);
        if (regionKey && !processedRegions.has(regionKey)) pendingRegions.push(regionKey);
      }
    }

    while (pendingRegions.length > 0) {
      const regionKey = pendingRegions.pop()!;
      if (processedRegions.has(regionKey)) continue;
      processedRegions.add(regionKey);

      const region = graph.regionsByKey.get(regionKey);
      if (!region) continue;
      regionKeys.add(regionKey);
      for (const point of region.points) {
        if (!addPoint(point)) {
          return makeResult(
            board,
            topology,
            target.key,
            'unknown-boundary',
            'max-points-exceeded',
            emptyPoints,
            stringKeys,
            regionKeys,
            boundarySafeGroupKeys,
          );
        }
      }
      for (const groupKey of region.boundaryGroups) {
        if (!processedGroups.has(groupKey)) pendingGroups.push(groupKey);
      }
    }
  }

  const topologyPointCount = topology.points().length;
  if (emptyPoints.size >= topologyPointCount) {
    return makeResult(
      board,
      topology,
      target.key,
      'unknown-boundary',
      'localisation-covers-whole-board',
      emptyPoints,
      stringKeys,
      regionKeys,
      boundarySafeGroupKeys,
    );
  }

  return makeResult(
    board,
    topology,
    target.key,
    'bounded',
    'bounded-closure',
    emptyPoints,
    stringKeys,
    regionKeys,
    boundarySafeGroupKeys,
  );
};
