import type { GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import type { EndgameConfidencePolicy } from './EndgameConfidencePolicy';

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const roundMetric = (value: number): number => Math.round(value * 1000) / 1000;

export interface EndgameConfidenceAnalysisContext {
  readonly state: GameState;
  readonly topology: Topology;
  readonly graph: EndgameGraph;
  readonly orderedPoints: readonly PointId[];
  readonly distanceToBlack: ReadonlyMap<PointId, number>;
  readonly distanceToWhite: ReadonlyMap<PointId, number>;
}

export interface EndgameGroupStructuralFeatures {
  readonly groupKey: string;
  readonly color: StoneColor;
  readonly stoneCount: number;
  readonly libertyCount: number;
  readonly immediateAtari: boolean;
  readonly adjacentEmptyRegionCount: number;
  readonly adjacentOpenSpaceSize: number;
  readonly largestAdjacentRegionSize: number;
  readonly largestAdjacentRegionFraction: number;
  readonly largestRegionFrontierWidth: number;
  readonly expansionLibertyCount: number;
  readonly broadEscapeCount: number;
  readonly contestedLibertyCount: number;
  readonly contestedLibertyRatio: number;
  readonly directEnemyEdgeCount: number;
  readonly outwardEdgeCount: number;
  readonly directEnemyEdgeRatio: number;
  readonly nearestEnemyDistance: number | null;
  readonly enemyStoneCountWithinRadius: number;
  readonly enemyGroupCountWithinRadius: number;
  readonly localReachablePointCount: number;
  readonly localEnemyDensity: number;
  readonly friendlyConnectionCount: number;
  readonly sharedLibertyCount: number;
  readonly strictEyeRegionCount: number;
  readonly friendlyEyeRegionCount: number;
  readonly smallEyeEligible: boolean;
}

const buildDistanceMap = (
  state: GameState,
  topology: Topology,
  color: StoneColor,
): ReadonlyMap<PointId, number> => {
  const distance = new Map<PointId, number>();
  const queue: PointId[] = [];
  for (const point of [...topology.points()].sort(compareStrings)) {
    if (state.board[point] !== color) continue;
    distance.set(point, 0);
    queue.push(point);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index]!;
    const nextDistance = distance.get(point)! + 1;
    for (const neighbor of topology.neighbors(point)) {
      if (distance.has(neighbor)) continue;
      distance.set(neighbor, nextDistance);
      queue.push(neighbor);
    }
  }
  return distance;
};

export const createEndgameConfidenceAnalysisContext = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph = buildEndgameGraph(state, topology),
): EndgameConfidenceAnalysisContext =>
  Object.freeze({
    state,
    topology,
    graph,
    orderedPoints: Object.freeze([...topology.points()].sort(compareStrings)),
    distanceToBlack: buildDistanceMap(state, topology, 'black'),
    distanceToWhite: buildDistanceMap(state, topology, 'white'),
  });

const localPressure = (
  context: EndgameConfidenceAnalysisContext,
  group: EndgameStoneString,
  radius: number,
): Readonly<{
  enemyStoneCount: number;
  enemyGroupCount: number;
  reachablePointCount: number;
}> => {
  const opponent = opponentOf(group.color);
  const visited = new Set<PointId>();
  const queue: { point: PointId; distance: number }[] = [];
  for (const point of group.points) {
    visited.add(point);
    queue.push({ point, distance: 0 });
  }

  const enemyPoints = new Set<PointId>();
  const enemyGroups = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    const entry = queue[index]!;
    if (entry.distance >= radius) continue;
    for (const neighbor of context.topology.neighbors(entry.point)) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      const nextDistance = entry.distance + 1;
      queue.push({ point: neighbor, distance: nextDistance });
      if (context.state.board[neighbor] !== opponent) continue;
      enemyPoints.add(neighbor);
      const owner = context.graph.pointOwner.get(neighbor);
      if (owner) enemyGroups.add(owner);
    }
  }

  return Object.freeze({
    enemyStoneCount: enemyPoints.size,
    enemyGroupCount: enemyGroups.size,
    reachablePointCount: Math.max(0, visited.size - group.points.length),
  });
};

const adjacentRegionsForGroup = (
  context: EndgameConfidenceAnalysisContext,
  group: EndgameStoneString,
) => {
  const regionKeys = new Set<string>();
  for (const liberty of group.liberties) {
    const regionKey = context.graph.emptyRegionOwner.get(liberty);
    if (regionKey) regionKeys.add(regionKey);
  }
  const byKey = new Map(context.graph.emptyRegions.map((region) => [region.key, region] as const));
  return [...regionKeys]
    .map((key) => byKey.get(key))
    .filter((region): region is NonNullable<typeof region> => region !== undefined)
    .sort((left, right) => compareStrings(left.key, right.key));
};

export const extractEndgameGroupStructuralFeatures = (
  context: EndgameConfidenceAnalysisContext,
  groupKey: string,
  policy: EndgameConfidencePolicy,
): EndgameGroupStructuralFeatures | null => {
  const group = context.graph.groups.get(groupKey);
  if (!group) return null;

  const opponent = opponentOf(group.color);
  const adjacentRegions = adjacentRegionsForGroup(context, group);
  const largestRegion = [...adjacentRegions].sort((left, right) => {
    if (left.points.length !== right.points.length) return right.points.length - left.points.length;
    return compareStrings(left.key, right.key);
  })[0];
  const adjacentOpenSpaceSize = adjacentRegions.reduce((sum, region) => sum + region.points.length, 0);
  const largestAdjacentRegionSize = largestRegion?.points.length ?? 0;
  const largestAdjacentRegionFraction =
    context.orderedPoints.length === 0 ? 0 : largestAdjacentRegionSize / context.orderedPoints.length;
  const largestRegionFrontierWidth = largestRegion
    ? group.liberties.filter(
        (liberty) => context.graph.emptyRegionOwner.get(liberty) === largestRegion.key,
      ).length
    : 0;

  let expansionLibertyCount = 0;
  let broadEscapeCount = 0;
  let contestedLibertyCount = 0;
  for (const liberty of group.liberties) {
    let onwardEmptyNeighbors = 0;
    let enemyAdjacent = false;
    for (const neighbor of context.topology.neighbors(liberty)) {
      const occupancy = context.state.board[neighbor];
      if (occupancy === 'empty') onwardEmptyNeighbors += 1;
      if (occupancy === opponent) enemyAdjacent = true;
    }
    if (onwardEmptyNeighbors > 0) expansionLibertyCount += 1;
    if (enemyAdjacent) contestedLibertyCount += 1;
    if (
      !enemyAdjacent &&
      onwardEmptyNeighbors >= policy.minimumOnwardEmptyNeighbors
    ) {
      broadEscapeCount += 1;
    }
  }

  const groupPointSet = new Set(group.points);
  let directEnemyEdgeCount = 0;
  let outwardEdgeCount = 0;
  for (const point of group.points) {
    for (const neighbor of context.topology.neighbors(point)) {
      if (groupPointSet.has(neighbor)) continue;
      outwardEdgeCount += 1;
      if (context.state.board[neighbor] === opponent) directEnemyEdgeCount += 1;
    }
  }

  const distanceMap = opponent === 'black' ? context.distanceToBlack : context.distanceToWhite;
  let nearestEnemyDistance = Number.POSITIVE_INFINITY;
  for (const point of group.points) {
    const distance = distanceMap.get(point);
    if (distance !== undefined) nearestEnemyDistance = Math.min(nearestEnemyDistance, distance);
  }

  const pressure = localPressure(context, group, policy.localPressureRadius);
  const localEnemyDensity =
    pressure.reachablePointCount === 0
      ? 0
      : pressure.enemyStoneCount / pressure.reachablePointCount;

  const friendlyConnectionCount = context.graph.friendlyConnections.filter((connection) =>
    connection.groupKeys.includes(group.key),
  ).length;
  const sharedLibertyCount = new Set(
    context.graph.sharedLiberties
      .filter((relation) => relation.groupKeys.includes(group.key))
      .flatMap((relation) => relation.liberties),
  ).size;

  const strictEyeRegions = adjacentRegions.filter(
    (region) =>
      region.boundaryGroups.length === 1 &&
      region.boundaryGroups[0] === group.key &&
      region.vitalGroups.includes(group.key),
  );
  const friendlyEyeRegions = adjacentRegions.filter(
    (region) =>
      region.boundaryGroups.length > 0 &&
      region.boundaryGroups.every((boundaryKey) =>
        context.graph.groups.get(boundaryKey)?.color === group.color,
      ) &&
      region.vitalGroups.includes(group.key),
  );
  const smallEyeEligible =
    strictEyeRegions.length > 0 &&
    strictEyeRegions.every((region) => region.points.length <= policy.smallEyeMaxRegionPoints);

  return Object.freeze({
    groupKey: group.key,
    color: group.color,
    stoneCount: group.points.length,
    libertyCount: group.liberties.length,
    immediateAtari: group.liberties.length <= 1,
    adjacentEmptyRegionCount: adjacentRegions.length,
    adjacentOpenSpaceSize,
    largestAdjacentRegionSize,
    largestAdjacentRegionFraction: roundMetric(largestAdjacentRegionFraction),
    largestRegionFrontierWidth,
    expansionLibertyCount,
    broadEscapeCount,
    contestedLibertyCount,
    contestedLibertyRatio: roundMetric(
      group.liberties.length === 0 ? 1 : contestedLibertyCount / group.liberties.length,
    ),
    directEnemyEdgeCount,
    outwardEdgeCount,
    directEnemyEdgeRatio: roundMetric(
      outwardEdgeCount === 0 ? 0 : directEnemyEdgeCount / outwardEdgeCount,
    ),
    nearestEnemyDistance: Number.isFinite(nearestEnemyDistance) ? nearestEnemyDistance : null,
    enemyStoneCountWithinRadius: pressure.enemyStoneCount,
    enemyGroupCountWithinRadius: pressure.enemyGroupCount,
    localReachablePointCount: pressure.reachablePointCount,
    localEnemyDensity: roundMetric(localEnemyDensity),
    friendlyConnectionCount,
    sharedLibertyCount,
    strictEyeRegionCount: strictEyeRegions.length,
    friendlyEyeRegionCount: friendlyEyeRegions.length,
    smallEyeEligible,
  });
};
