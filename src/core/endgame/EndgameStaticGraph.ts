import { compareEndgamePointIds, endgameGroupId } from './EndgameGroupIdentity';
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
}

export interface EndgameStaticGraph {
  readonly strings: readonly EndgameStoneString[];
  readonly stringsByKey: ReadonlyMap<string, EndgameStoneString>;
  readonly stringByPoint: ReadonlyMap<PointId, string>;
  readonly emptyRegions: readonly EndgameEmptyRegion[];
}

export interface EndgameStaticGraphBuildOptions {
  readonly shouldStop?: () => boolean;
}

export class EndgameStaticGraphInterrupted extends Error {
  constructor() {
    super('Endgame static graph preparation interrupted');
    this.name = 'EndgameStaticGraphInterrupted';
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

export const buildEndgameStaticGraph = (
  board: BoardOccupancy,
  topology: Topology,
  options: EndgameStaticGraphBuildOptions = {},
): EndgameStaticGraph => {
  const shouldStop = options.shouldStop ?? (() => false);
  const checkpoint = (): void => {
    if (shouldStop()) throw new EndgameStaticGraphInterrupted();
  };

  checkpoint();
  const points = [...topology.points()].sort(compareEndgamePointIds);
  const visitedStones = new Set<PointId>();
  const strings: EndgameStoneString[] = [];
  const stringsByKey = new Map<string, EndgameStoneString>();
  const stringByPoint = new Map<PointId, string>();

  for (const start of points) {
    checkpoint();
    if (visitedStones.has(start)) continue;
    const color = occupancyAt(board, start);
    if (color === 'empty') continue;

    const pending: PointId[] = [start];
    const groupPoints: PointId[] = [];
    const liberties = new Set<PointId>();
    visitedStones.add(start);

    while (pending.length > 0) {
      checkpoint();
      const point = pending.pop()!;
      groupPoints.push(point);

      for (const neighbor of topology.neighbors(point)) {
        checkpoint();
        const occupancy = occupancyAt(board, neighbor);
        if (occupancy === 'empty') {
          liberties.add(neighbor);
          continue;
        }
        if (occupancy === color && !visitedStones.has(neighbor)) {
          visitedStones.add(neighbor);
          pending.push(neighbor);
        }
      }
    }

    groupPoints.sort(compareEndgamePointIds);
    const frozenPoints = Object.freeze(groupPoints);
    const group = Object.freeze({
      key: endgameGroupId(frozenPoints),
      points: frozenPoints,
      color,
      liberties: Object.freeze([...liberties].sort(compareEndgamePointIds)),
    });
    strings.push(group);
    stringsByKey.set(group.key, group);
    for (const point of frozenPoints) stringByPoint.set(point, group.key);
  }

  strings.sort((left, right) => compareStrings(left.key, right.key));

  const visitedEmpty = new Set<PointId>();
  const emptyRegions: EndgameEmptyRegion[] = [];
  for (const start of points) {
    checkpoint();
    if (visitedEmpty.has(start) || occupancyAt(board, start) !== 'empty') continue;

    const pending: PointId[] = [start];
    const regionPoints: PointId[] = [];
    const boundaryGroups = new Set<string>();
    const boundaryColors = new Set<StoneColor>();
    visitedEmpty.add(start);

    while (pending.length > 0) {
      checkpoint();
      const point = pending.pop()!;
      regionPoints.push(point);

      for (const neighbor of topology.neighbors(point)) {
        checkpoint();
        const occupancy = occupancyAt(board, neighbor);
        if (occupancy === 'empty') {
          if (!visitedEmpty.has(neighbor)) {
            visitedEmpty.add(neighbor);
            pending.push(neighbor);
          }
          continue;
        }

        const groupKey = stringByPoint.get(neighbor);
        const group = groupKey ? stringsByKey.get(groupKey) : undefined;
        if (!groupKey || !group || group.color !== occupancy) {
          throw new Error(`Endgame graph has no matching string for stone: ${neighbor}`);
        }
        boundaryGroups.add(groupKey);
        boundaryColors.add(group.color);
      }
    }

    regionPoints.sort(compareEndgamePointIds);
    const frozenPoints = Object.freeze(regionPoints);
    emptyRegions.push(
      Object.freeze({
        key: JSON.stringify(frozenPoints),
        points: frozenPoints,
        boundaryGroups: Object.freeze([...boundaryGroups].sort(compareStrings)),
        boundaryColors: Object.freeze([...boundaryColors].sort(compareStrings)),
      }),
    );
  }

  emptyRegions.sort((left, right) => compareStrings(left.key, right.key));
  checkpoint();

  return Object.freeze({
    strings: Object.freeze(strings),
    stringsByKey,
    stringByPoint,
    emptyRegions: Object.freeze(emptyRegions),
  });
};

export const tryBuildEndgameStaticGraph = (
  board: BoardOccupancy,
  topology: Topology,
  options: EndgameStaticGraphBuildOptions = {},
): EndgameStaticGraph | null => {
  try {
    return buildEndgameStaticGraph(board, topology, options);
  } catch (error) {
    if (error instanceof EndgameStaticGraphInterrupted) return null;
    throw error;
  }
};
