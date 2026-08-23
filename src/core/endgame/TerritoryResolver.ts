import type { EndgameClassification, GroupStatus } from './EndgameClassifier';
import { buildEndgameGraph } from './EndgameGraphCore';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

export type TerritoryOwner = 'BLACK' | 'WHITE' | 'NEUTRAL';

export interface ResolvedRegion {
  readonly key: string;
  readonly points: readonly PointId[];
  readonly borderingColors: readonly StoneColor[];
  readonly borderingGroups: readonly string[];
  /** True when at least one point in this empty region is adjacent to a classified seki stone. */
  readonly touchesSeki: boolean;
  readonly owner: TerritoryOwner;
}

export interface TerritoryResolution {
  readonly regions: readonly ResolvedRegion[];
  readonly regionByPoint: ReadonlyMap<PointId, string>;
}

interface VirtualScoringView {
  readonly board: BoardOccupancy;
  readonly statuses: ReadonlyMap<PointId, GroupStatus>;
}

const occupancyAt = (
  board: BoardOccupancy,
  point: PointId,
): StoneColor | 'empty' => {
  const occupancy = board[point];
  if (occupancy !== 'black' && occupancy !== 'white' && occupancy !== 'empty') {
    throw new Error(`GameState board is missing or invalid at point: ${point}`);
  }
  return occupancy;
};

const buildVirtualScoringView = (
  state: GameState,
  classification: EndgameClassification,
  topology: Topology,
): VirtualScoringView => {
  const statuses = new Map<PointId, GroupStatus>();

  for (const group of classification) {
    for (const point of group.points) {
      if (!topology.has(point)) {
        throw new Error(`Classification contains unknown point: ${point}`);
      }

      const occupancy = occupancyAt(state.board, point);
      if (occupancy === 'empty') {
        throw new Error(`Classification point is not occupied by a stone: ${point}`);
      }

      const existing = statuses.get(point);
      if (existing && existing !== group.status) {
        throw new Error(`Conflicting classification for point: ${point}`);
      }
      statuses.set(point, group.status);
    }
  }

  const virtualBoard: Record<PointId, StoneColor | 'empty'> = { ...state.board };

  for (const point of topology.points()) {
    occupancyAt(state.board, point);
    if (statuses.get(point) === 'dead') virtualBoard[point] = 'empty';
  }

  return Object.freeze({
    board: Object.freeze(virtualBoard),
    statuses,
  });
};

const ownerFromColors = (colors: readonly StoneColor[]): TerritoryOwner => {
  if (colors.length !== 1) return 'NEUTRAL';
  return colors[0] === 'black' ? 'BLACK' : 'WHITE';
};

const regionTouchesSeki = (
  points: readonly PointId[],
  statuses: ReadonlyMap<PointId, GroupStatus>,
  topology: Topology,
): boolean =>
  points.some((point) =>
    topology.neighbors(point).some((neighbor) => statuses.get(neighbor) === 'seki'),
  );

/**
 * Builds topology-neutral territory facts from a final endgame classification.
 *
 * Only dead stones are virtually removed. A region touching classified seki is
 * always neutral; other mixed/no-boundary neutral regions are ordinary dame.
 */
export const resolveTerritory = (
  state: GameState,
  classification: EndgameClassification,
  topology: Topology,
): TerritoryResolution => {
  const { board: virtualBoard, statuses } = buildVirtualScoringView(
    state,
    classification,
    topology,
  );
  const graph = buildEndgameGraph(virtualBoard, topology);
  const regionByPoint = new Map<PointId, string>();

  const regions = graph.emptyRegions.map((region): ResolvedRegion => {
    const touchesSeki = regionTouchesSeki(region.points, statuses, topology);
    const resolved = Object.freeze({
      key: region.key,
      points: Object.freeze([...region.points]),
      borderingColors: Object.freeze([...region.boundaryColors]),
      borderingGroups: Object.freeze([...region.boundaryGroups]),
      touchesSeki,
      owner: touchesSeki ? ('NEUTRAL' as const) : ownerFromColors(region.boundaryColors),
    });

    for (const point of resolved.points) regionByPoint.set(point, resolved.key);
    return resolved;
  });

  return Object.freeze({
    regions: Object.freeze(regions),
    regionByPoint,
  });
};
