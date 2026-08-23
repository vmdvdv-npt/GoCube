import type { GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { endgameGroupId } from './EndgameGroupIdentity';

export interface EndgameStoneString {
  readonly key: string;
  readonly color: StoneColor;
  readonly points: readonly PointId[];
  readonly liberties: readonly PointId[];
}

export interface EndgameEmptyRegion {
  readonly key: string;
  readonly points: readonly PointId[];
  readonly boundaryGroups: readonly string[];
  readonly boundaryColors: readonly StoneColor[];
  readonly vitalGroups: readonly string[];
}

export interface EndgameSharedLiberties {
  readonly groupKeys: readonly [string, string];
  readonly liberties: readonly PointId[];
}

export interface EndgameFriendlyConnection {
  readonly point: PointId;
  readonly color: StoneColor;
  readonly groupKeys: readonly string[];
}

export interface EndgameGraph {
  readonly groups: ReadonlyMap<string, EndgameStoneString>;
  readonly pointOwner: ReadonlyMap<PointId, string>;
  readonly emptyRegions: readonly EndgameEmptyRegion[];
  readonly emptyRegionOwner: ReadonlyMap<PointId, string>;
  readonly sharedLiberties: readonly EndgameSharedLiberties[];
  readonly friendlyConnections: readonly EndgameFriendlyConnection[];
}

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);

const isStoneColor = (value: GameState['board'][PointId]): value is StoneColor =>
  value === 'black' || value === 'white';

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const assertCompleteBoard = (state: GameState, topology: Topology): void => {
  for (const point of topology.points()) {
    const occupancy = state.board[point];
    if (occupancy !== 'black' && occupancy !== 'white' && occupancy !== 'empty') {
      throw new Error(`Endgame graph is missing occupancy for point: ${point}`);
    }
  }
};

const collectStoneStrings = (
  state: GameState,
  topology: Topology,
): Readonly<{
  groups: ReadonlyMap<string, EndgameStoneString>;
  pointOwner: ReadonlyMap<PointId, string>;
}> => {
  const visited = new Set<PointId>();
  const groups = new Map<string, EndgameStoneString>();
  const pointOwner = new Map<PointId, string>();

  for (const start of [...topology.points()].sort(compareStrings)) {
    if (visited.has(start)) continue;
    const color = state.board[start];
    if (!isStoneColor(color)) continue;

    const pending: PointId[] = [start];
    const points: PointId[] = [];
    const liberties = new Set<PointId>();
    visited.add(start);

    while (pending.length > 0) {
      const point = pending.pop()!;
      points.push(point);

      for (const neighbor of topology.neighbors(point)) {
        const occupancy = state.board[neighbor];
        if (occupancy === 'empty') {
          liberties.add(neighbor);
          continue;
        }
        if (occupancy === color && !visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }

    points.sort(compareStrings);
    const key = endgameGroupId(points);
    const group = Object.freeze({
      key,
      color,
      points: Object.freeze(points),
      liberties: Object.freeze([...liberties].sort(compareStrings)),
    });

    groups.set(key, group);
    for (const point of points) pointOwner.set(point, key);
  }

  return Object.freeze({ groups, pointOwner });
};

const collectEmptyRegions = (
  state: GameState,
  topology: Topology,
  groups: ReadonlyMap<string, EndgameStoneString>,
  pointOwner: ReadonlyMap<PointId, string>,
): Readonly<{
  regions: readonly EndgameEmptyRegion[];
  regionOwner: ReadonlyMap<PointId, string>;
}> => {
  const visited = new Set<PointId>();
  const regions: EndgameEmptyRegion[] = [];
  const regionOwner = new Map<PointId, string>();

  for (const start of [...topology.points()].sort(compareStrings)) {
    if (visited.has(start) || state.board[start] !== 'empty') continue;

    const pending: PointId[] = [start];
    const points: PointId[] = [];
    visited.add(start);

    while (pending.length > 0) {
      const point = pending.pop()!;
      points.push(point);
      for (const neighbor of topology.neighbors(point)) {
        if (state.board[neighbor] !== 'empty' || visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }

    points.sort(compareStrings);
    const boundaryGroups = new Set<string>();
    for (const point of points) {
      for (const neighbor of topology.neighbors(point)) {
        const owner = pointOwner.get(neighbor);
        if (owner) boundaryGroups.add(owner);
      }
    }

    const vitalGroups = new Set(boundaryGroups);
    for (const point of points) {
      const adjacentGroups = new Set<string>();
      for (const neighbor of topology.neighbors(point)) {
        const owner = pointOwner.get(neighbor);
        if (owner) adjacentGroups.add(owner);
      }
      for (const groupKey of vitalGroups) {
        if (!adjacentGroups.has(groupKey)) vitalGroups.delete(groupKey);
      }
    }

    const orderedBoundaryGroups = [...boundaryGroups].sort(compareStrings);
    const boundaryColors = COLORS.filter((color) =>
      orderedBoundaryGroups.some((groupKey) => groups.get(groupKey)?.color === color),
    );
    const key = JSON.stringify(points);
    const region = Object.freeze({
      key,
      points: Object.freeze(points),
      boundaryGroups: Object.freeze(orderedBoundaryGroups),
      boundaryColors: Object.freeze(boundaryColors),
      vitalGroups: Object.freeze([...vitalGroups].sort(compareStrings)),
    });

    regions.push(region);
    for (const point of points) regionOwner.set(point, key);
  }

  regions.sort((left, right) => compareStrings(left.key, right.key));
  return Object.freeze({ regions: Object.freeze(regions), regionOwner });
};

const collectSharedLiberties = (
  groups: ReadonlyMap<string, EndgameStoneString>,
): readonly EndgameSharedLiberties[] => {
  const orderedGroups = [...groups.values()].sort((left, right) => compareStrings(left.key, right.key));
  const relations: EndgameSharedLiberties[] = [];

  for (let leftIndex = 0; leftIndex < orderedGroups.length; leftIndex += 1) {
    const left = orderedGroups[leftIndex]!;
    const leftLiberties = new Set(left.liberties);

    for (let rightIndex = leftIndex + 1; rightIndex < orderedGroups.length; rightIndex += 1) {
      const right = orderedGroups[rightIndex]!;
      if (left.color === right.color) continue;

      const shared = right.liberties.filter((point) => leftLiberties.has(point));
      if (shared.length === 0) continue;

      relations.push(
        Object.freeze({
          groupKeys: Object.freeze([left.key, right.key]) as readonly [string, string],
          liberties: Object.freeze([...shared].sort(compareStrings)),
        }),
      );
    }
  }

  return Object.freeze(relations);
};

const collectFriendlyConnections = (
  state: GameState,
  topology: Topology,
  groups: ReadonlyMap<string, EndgameStoneString>,
  pointOwner: ReadonlyMap<PointId, string>,
): readonly EndgameFriendlyConnection[] => {
  const candidates: EndgameFriendlyConnection[] = [];

  for (const point of [...topology.points()].sort(compareStrings)) {
    if (state.board[point] !== 'empty') continue;

    for (const color of COLORS) {
      const groupKeys = new Set<string>();
      for (const neighbor of topology.neighbors(point)) {
        const owner = pointOwner.get(neighbor);
        if (owner && groups.get(owner)?.color === color) groupKeys.add(owner);
      }

      if (groupKeys.size < 2) continue;
      candidates.push(
        Object.freeze({
          point,
          color,
          groupKeys: Object.freeze([...groupKeys].sort(compareStrings)),
        }),
      );
    }
  }

  return Object.freeze(candidates);
};

/**
 * Builds the topology-neutral structural graph used by the alternative
 * GNU-Go-inspired endgame reader. It deliberately performs no life/death
 * classification: this layer exposes facts for later proof algorithms.
 */
export const buildEndgameGraph = (state: GameState, topology: Topology): EndgameGraph => {
  assertCompleteBoard(state, topology);

  const stoneStrings = collectStoneStrings(state, topology);
  const emptyRegions = collectEmptyRegions(
    state,
    topology,
    stoneStrings.groups,
    stoneStrings.pointOwner,
  );

  return Object.freeze({
    groups: stoneStrings.groups,
    pointOwner: stoneStrings.pointOwner,
    emptyRegions: emptyRegions.regions,
    emptyRegionOwner: emptyRegions.regionOwner,
    sharedLiberties: collectSharedLiberties(stoneStrings.groups),
    friendlyConnections: collectFriendlyConnections(
      state,
      topology,
      stoneStrings.groups,
      stoneStrings.pointOwner,
    ),
  });
};
