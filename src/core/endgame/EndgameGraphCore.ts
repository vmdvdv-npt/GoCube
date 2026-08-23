import {
  canonicalizeEndgameGroup,
  compareEndgamePointIds,
  endgameGroupId,
} from './EndgameGroupIdentity';
import type { BoardOccupancy, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

export interface EndgameStoneString {
  readonly key: string;
  readonly points: readonly PointId[];
  readonly color: StoneColor;
  readonly liberties: readonly PointId[];
}

export interface EndgameEmptyRegion {
  readonly key: string;
  readonly points: readonly PointId[];
  readonly boundaryGroups: readonly string[];
  readonly boundaryColors: readonly StoneColor[];
  /** Groups adjacent to every point in this region; structural input for Benson. */
  readonly vitalGroups: readonly string[];
}

export interface EndgameOpponentAdjacency {
  readonly groups: readonly [string, string];
}

export interface EndgameSharedLiberty {
  readonly groups: readonly [string, string];
  readonly liberties: readonly PointId[];
}

export interface EndgameFriendlyConnectionCandidate {
  readonly groups: readonly [string, string];
  readonly viaRegions: readonly string[];
  readonly sharedLiberties: readonly PointId[];
}

export interface EndgameConflictComponent {
  readonly key: string;
  readonly blackStrings: readonly string[];
  readonly whiteStrings: readonly string[];
  readonly emptyRegions: readonly string[];
  readonly sharedLiberties: readonly EndgameSharedLiberty[];
  readonly possibleConnections: readonly EndgameFriendlyConnectionCandidate[];
}

export interface EndgameGraph {
  readonly strings: readonly EndgameStoneString[];
  readonly emptyRegions: readonly EndgameEmptyRegion[];
  readonly stringsByKey: ReadonlyMap<string, EndgameStoneString>;
  readonly regionsByKey: ReadonlyMap<string, EndgameEmptyRegion>;
  readonly stringByPoint: ReadonlyMap<PointId, string>;
  readonly regionByPoint: ReadonlyMap<PointId, string>;
  readonly opponentAdjacencies: readonly EndgameOpponentAdjacency[];
  readonly sharedLiberties: readonly EndgameSharedLiberty[];
  readonly possibleConnections: readonly EndgameFriendlyConnectionCandidate[];
  readonly conflictComponents: readonly EndgameConflictComponent[];
}

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);

type PairAccumulator = {
  readonly groups: readonly [string, string];
  readonly points: Set<PointId>;
};

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalPair = (left: string, right: string): readonly [string, string] =>
  Object.freeze(
    (compareStrings(left, right) <= 0 ? [left, right] : [right, left]) as [string, string],
  );

const pairKey = (groups: readonly [string, string]): string => JSON.stringify(groups);

const occupancyAt = (board: BoardOccupancy, point: PointId): StoneColor | 'empty' => {
  const occupancy = board[point];
  if (occupancy !== 'black' && occupancy !== 'white' && occupancy !== 'empty') {
    throw new Error(`Board has no valid occupancy for topology point: ${point}`);
  }
  return occupancy;
};

/**
 * Builds the topology-neutral structural snapshot consumed by endgame proofs.
 * Correctness depends only on logical board occupancy and Topology.neighbors().
 */
export const buildEndgameGraph = (
  board: BoardOccupancy,
  topology: Topology,
): EndgameGraph => {
  const points = Object.freeze([...topology.points()].sort(compareEndgamePointIds));
  for (const point of points) occupancyAt(board, point);

  const { strings, stringsByKey, stringByPoint } = collectStoneStrings(board, topology, points);
  const { regions, regionsByKey, regionByPoint } = collectEmptyRegions(
    board,
    topology,
    points,
    stringsByKey,
    stringByPoint,
  );
  const opponentAdjacencies = collectOpponentAdjacencies(
    board,
    topology,
    stringsByKey,
    stringByPoint,
  );
  const sharedLiberties = collectSharedLiberties(
    regions,
    stringsByKey,
    topology,
    stringByPoint,
  );
  const possibleConnections = collectFriendlyConnectionCandidates(
    stringsByKey,
    sharedLiberties,
    regionByPoint,
  );
  const conflictComponents = collectConflictComponents(
    strings,
    regions,
    opponentAdjacencies,
    sharedLiberties,
    possibleConnections,
  );

  return Object.freeze({
    strings,
    emptyRegions: regions,
    stringsByKey,
    regionsByKey,
    stringByPoint,
    regionByPoint,
    opponentAdjacencies,
    sharedLiberties,
    possibleConnections,
    conflictComponents,
  });
};

const collectStoneStrings = (
  board: BoardOccupancy,
  topology: Topology,
  points: readonly PointId[],
): Readonly<{
  strings: readonly EndgameStoneString[];
  stringsByKey: ReadonlyMap<string, EndgameStoneString>;
  stringByPoint: ReadonlyMap<PointId, string>;
}> => {
  const visited = new Set<PointId>();
  const strings: EndgameStoneString[] = [];
  const stringByPoint = new Map<PointId, string>();

  for (const start of points) {
    if (visited.has(start)) continue;
    const color = occupancyAt(board, start);
    if (color === 'empty') continue;

    const pending: PointId[] = [start];
    const groupPoints: PointId[] = [];
    const liberties = new Set<PointId>();
    visited.add(start);

    while (pending.length > 0) {
      const point = pending.pop()!;
      groupPoints.push(point);

      for (const neighbor of topology.neighbors(point)) {
        const occupancy = occupancyAt(board, neighbor);
        if (occupancy === 'empty') {
          liberties.add(neighbor);
          continue;
        }
        if (occupancy !== color || visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }

    const canonicalPoints = canonicalizeEndgameGroup(groupPoints);
    const key = endgameGroupId(canonicalPoints);
    const group: EndgameStoneString = Object.freeze({
      key,
      points: canonicalPoints,
      color,
      liberties: Object.freeze([...liberties].sort(compareEndgamePointIds)),
    });
    strings.push(group);
    for (const point of canonicalPoints) stringByPoint.set(point, key);
  }

  strings.sort((left, right) => compareStrings(left.key, right.key));
  const stringsByKey = new Map(strings.map((group) => [group.key, group] as const));

  return Object.freeze({
    strings: Object.freeze(strings),
    stringsByKey,
    stringByPoint,
  });
};

const collectEmptyRegions = (
  board: BoardOccupancy,
  topology: Topology,
  points: readonly PointId[],
  stringsByKey: ReadonlyMap<string, EndgameStoneString>,
  stringByPoint: ReadonlyMap<PointId, string>,
): Readonly<{
  regions: readonly EndgameEmptyRegion[];
  regionsByKey: ReadonlyMap<string, EndgameEmptyRegion>;
  regionByPoint: ReadonlyMap<PointId, string>;
}> => {
  const visited = new Set<PointId>();
  const regions: EndgameEmptyRegion[] = [];
  const regionByPoint = new Map<PointId, string>();

  for (const start of points) {
    if (visited.has(start) || occupancyAt(board, start) !== 'empty') continue;

    const pending: PointId[] = [start];
    const regionPoints: PointId[] = [];
    visited.add(start);

    while (pending.length > 0) {
      const point = pending.pop()!;
      regionPoints.push(point);
      for (const neighbor of topology.neighbors(point)) {
        if (visited.has(neighbor) || occupancyAt(board, neighbor) !== 'empty') continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }

    regionPoints.sort(compareEndgamePointIds);
    const boundaryGroups = new Set<string>();
    for (const point of regionPoints) {
      for (const neighbor of topology.neighbors(point)) {
        const owner = stringByPoint.get(neighbor);
        if (owner) boundaryGroups.add(owner);
      }
    }

    const vitalGroups = new Set(boundaryGroups);
    for (const point of regionPoints) {
      const adjacentGroups = new Set<string>();
      for (const neighbor of topology.neighbors(point)) {
        const owner = stringByPoint.get(neighbor);
        if (owner) adjacentGroups.add(owner);
      }
      for (const groupKey of [...vitalGroups]) {
        if (!adjacentGroups.has(groupKey)) vitalGroups.delete(groupKey);
      }
    }

    const frozenPoints = Object.freeze(regionPoints);
    const key = JSON.stringify(frozenPoints);
    const sortedBoundaryGroups = Object.freeze([...boundaryGroups].sort(compareStrings));
    const boundaryColors = Object.freeze(
      COLORS.filter((color) =>
        sortedBoundaryGroups.some((groupKey) => stringsByKey.get(groupKey)?.color === color),
      ),
    );
    const region: EndgameEmptyRegion = Object.freeze({
      key,
      points: frozenPoints,
      boundaryGroups: sortedBoundaryGroups,
      boundaryColors,
      vitalGroups: Object.freeze([...vitalGroups].sort(compareStrings)),
    });
    regions.push(region);
    for (const point of frozenPoints) regionByPoint.set(point, key);
  }

  regions.sort((left, right) => compareStrings(left.key, right.key));
  const regionsByKey = new Map(regions.map((region) => [region.key, region] as const));

  return Object.freeze({
    regions: Object.freeze(regions),
    regionsByKey,
    regionByPoint,
  });
};

const collectOpponentAdjacencies = (
  board: BoardOccupancy,
  topology: Topology,
  stringsByKey: ReadonlyMap<string, EndgameStoneString>,
  stringByPoint: ReadonlyMap<PointId, string>,
): readonly EndgameOpponentAdjacency[] => {
  const pairs = new Map<string, readonly [string, string]>();

  for (const [point, owner] of stringByPoint) {
    const ownerGroup = stringsByKey.get(owner)!;
    for (const neighbor of topology.neighbors(point)) {
      if (occupancyAt(board, neighbor) === 'empty') continue;
      const neighborOwner = stringByPoint.get(neighbor);
      if (!neighborOwner || neighborOwner === owner) continue;
      const neighborGroup = stringsByKey.get(neighborOwner)!;
      if (neighborGroup.color === ownerGroup.color) continue;
      const groups = canonicalPair(owner, neighborOwner);
      pairs.set(pairKey(groups), groups);
    }
  }

  return Object.freeze(
    [...pairs.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([, groups]) => Object.freeze({ groups })),
  );
};

const collectSharedLiberties = (
  regions: readonly EndgameEmptyRegion[],
  stringsByKey: ReadonlyMap<string, EndgameStoneString>,
  topology: Topology,
  stringByPoint: ReadonlyMap<PointId, string>,
): readonly EndgameSharedLiberty[] => {
  const pairs = new Map<string, PairAccumulator>();

  for (const region of regions) {
    for (const point of region.points) {
      const owners = new Set<string>();
      for (const neighbor of topology.neighbors(point)) {
        const owner = stringByPoint.get(neighbor);
        if (owner && stringsByKey.has(owner)) owners.add(owner);
      }
      const sortedOwners = [...owners].sort(compareStrings);
      for (let leftIndex = 0; leftIndex < sortedOwners.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < sortedOwners.length; rightIndex += 1) {
          const groups = canonicalPair(sortedOwners[leftIndex]!, sortedOwners[rightIndex]!);
          const key = pairKey(groups);
          const existing = pairs.get(key);
          if (existing) existing.points.add(point);
          else pairs.set(key, { groups, points: new Set([point]) });
        }
      }
    }
  }

  return Object.freeze(
    [...pairs.entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([, accumulator]) =>
        Object.freeze({
          groups: accumulator.groups,
          liberties: Object.freeze([...accumulator.points].sort(compareEndgamePointIds)),
        }),
      ),
  );
};

const collectFriendlyConnectionCandidates = (
  stringsByKey: ReadonlyMap<string, EndgameStoneString>,
  sharedLiberties: readonly EndgameSharedLiberty[],
  regionByPoint: ReadonlyMap<PointId, string>,
): readonly EndgameFriendlyConnectionCandidate[] =>
  Object.freeze(
    sharedLiberties
      .filter((entry) => {
        const left = stringsByKey.get(entry.groups[0]);
        const right = stringsByKey.get(entry.groups[1]);
        return left !== undefined && right !== undefined && left.color === right.color;
      })
      .map((entry) => {
        const viaRegions = new Set<string>();
        for (const liberty of entry.liberties) {
          const regionKey = regionByPoint.get(liberty);
          if (regionKey) viaRegions.add(regionKey);
        }
        return Object.freeze({
          groups: entry.groups,
          viaRegions: Object.freeze([...viaRegions].sort(compareStrings)),
          sharedLiberties: entry.liberties,
        });
      }),
  );

const collectConflictComponents = (
  strings: readonly EndgameStoneString[],
  regions: readonly EndgameEmptyRegion[],
  opponentAdjacencies: readonly EndgameOpponentAdjacency[],
  sharedLiberties: readonly EndgameSharedLiberty[],
  possibleConnections: readonly EndgameFriendlyConnectionCandidate[],
): readonly EndgameConflictComponent[] => {
  const adjacency = new Map<string, Set<string>>();
  const groupNode = (key: string): string => `group:${key}`;
  const regionNode = (key: string): string => `region:${key}`;
  const connect = (left: string, right: string): void => {
    let leftNeighbors = adjacency.get(left);
    if (!leftNeighbors) {
      leftNeighbors = new Set();
      adjacency.set(left, leftNeighbors);
    }
    let rightNeighbors = adjacency.get(right);
    if (!rightNeighbors) {
      rightNeighbors = new Set();
      adjacency.set(right, rightNeighbors);
    }
    leftNeighbors.add(right);
    rightNeighbors.add(left);
  };

  for (const group of strings) adjacency.set(groupNode(group.key), new Set());
  for (const region of regions) {
    const node = regionNode(region.key);
    adjacency.set(node, new Set());
    for (const groupKey of region.boundaryGroups) connect(node, groupNode(groupKey));
  }
  for (const relation of opponentAdjacencies) {
    connect(groupNode(relation.groups[0]), groupNode(relation.groups[1]));
  }

  const stringsByKey = new Map(strings.map((group) => [group.key, group] as const));
  const visited = new Set<string>();
  const components: EndgameConflictComponent[] = [];

  for (const startGroup of strings) {
    const start = groupNode(startGroup.key);
    if (visited.has(start)) continue;

    const pending = [start];
    const componentGroups = new Set<string>();
    const componentRegions = new Set<string>();
    visited.add(start);

    while (pending.length > 0) {
      const node = pending.pop()!;
      if (node.startsWith('group:')) componentGroups.add(node.slice('group:'.length));
      else if (node.startsWith('region:')) componentRegions.add(node.slice('region:'.length));

      for (const neighbor of adjacency.get(node) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }

    const blackStrings = [...componentGroups]
      .filter((key) => stringsByKey.get(key)?.color === 'black')
      .sort(compareStrings);
    const whiteStrings = [...componentGroups]
      .filter((key) => stringsByKey.get(key)?.color === 'white')
      .sort(compareStrings);
    if (blackStrings.length === 0 || whiteStrings.length === 0) continue;

    const groupSet = new Set(componentGroups);
    const componentSharedLiberties = sharedLiberties.filter(
      (entry) => groupSet.has(entry.groups[0]) && groupSet.has(entry.groups[1]),
    );
    const componentConnections = possibleConnections.filter(
      (entry) => groupSet.has(entry.groups[0]) && groupSet.has(entry.groups[1]),
    );
    const groupKeys = [...componentGroups].sort(compareStrings);

    components.push(
      Object.freeze({
        key: JSON.stringify(groupKeys),
        blackStrings: Object.freeze(blackStrings),
        whiteStrings: Object.freeze(whiteStrings),
        emptyRegions: Object.freeze([...componentRegions].sort(compareStrings)),
        sharedLiberties: Object.freeze(componentSharedLiberties),
        possibleConnections: Object.freeze(componentConnections),
      }),
    );
  }

  return Object.freeze(
    components.sort((left, right) => compareStrings(left.key, right.key)),
  );
};
