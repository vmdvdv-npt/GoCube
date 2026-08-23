import type { GameState, PointOccupancy } from '../../game/types';
import type { PointId, Topology } from '../../topology/Topology';

export interface PlanarLocalAnalyzerOptions {
  readonly radius?: number;
  readonly boardSize?: number;
  readonly margin?: number;
}

export interface PlanarProjectedPoint {
  readonly point: PointId;
  readonly row: number;
  readonly column: number;
  readonly occupancy: PointOccupancy;
}

export interface PlanarLocalProjection {
  readonly boardSize: number;
  readonly radius: number;
  readonly margin: number;
  readonly targetPoints: readonly PointId[];
  readonly points: readonly PlanarProjectedPoint[];
}

export type PlanarLocalAnalysisResult =
  | Readonly<{ status: 'applicable'; projection: PlanarLocalProjection }>
  | Readonly<{
      status: 'not-applicable';
      reason:
        | 'invalid-target'
        | 'non-square-grid-neighborhood'
        | 'context-too-large';
      detail: string;
    }>;

interface Coordinate {
  readonly x: number;
  readonly y: number;
}

const DEFAULT_RADIUS = 3;
const DEFAULT_BOARD_SIZE = 19;
const DEFAULT_MARGIN = 3;
const GRID_STEPS: readonly Coordinate[] = Object.freeze([
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 1, y: 0 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: -1, y: 0 }),
]);

const coordinateKey = ({ x, y }: Coordinate): string => `${x},${y}`;
const manhattanDistance = (left: Coordinate, right: Coordinate): number =>
  Math.abs(left.x - right.x) + Math.abs(left.y - right.y);

const collectNeighborhood = (
  topology: Topology,
  targets: readonly PointId[],
  radius: number,
): readonly PointId[] => {
  const distance = new Map<PointId, number>();
  const queue: PointId[] = [];

  for (const target of targets) {
    if (!distance.has(target)) {
      distance.set(target, 0);
      queue.push(target);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index];
    if (point === undefined) continue;
    const pointDistance = distance.get(point);
    if (pointDistance === undefined || pointDistance >= radius) continue;

    for (const neighbor of topology.neighbors(point)) {
      if (!distance.has(neighbor)) {
        distance.set(neighbor, pointDistance + 1);
        queue.push(neighbor);
      }
    }
  }

  return Object.freeze([...distance.keys()].sort());
};

const makeAdjacency = (
  topology: Topology,
  points: readonly PointId[],
): ReadonlyMap<PointId, ReadonlySet<PointId>> => {
  const included = new Set(points);
  const adjacency = new Map<PointId, ReadonlySet<PointId>>();
  for (const point of points) {
    adjacency.set(
      point,
      new Set(topology.neighbors(point).filter((neighbor) => included.has(neighbor))),
    );
  }
  return adjacency;
};

const candidateCoordinates = (
  point: PointId,
  points: readonly PointId[],
  adjacency: ReadonlyMap<PointId, ReadonlySet<PointId>>,
  assigned: ReadonlyMap<PointId, Coordinate>,
  occupiedCoordinates: ReadonlyMap<string, PointId>,
): readonly Coordinate[] => {
  const assignedNeighbors = [...(adjacency.get(point) ?? [])]
    .map((neighbor) => assigned.get(neighbor))
    .filter((coordinate): coordinate is Coordinate => coordinate !== undefined);
  if (assignedNeighbors.length === 0) return Object.freeze([]);

  const anchor = assignedNeighbors[0];
  if (anchor === undefined) return Object.freeze([]);

  const candidates: Coordinate[] = [];
  for (const step of GRID_STEPS) {
    const candidate = Object.freeze({ x: anchor.x + step.x, y: anchor.y + step.y });
    if (occupiedCoordinates.has(coordinateKey(candidate))) continue;

    let valid = true;
    for (const otherPoint of points) {
      const otherCoordinate = assigned.get(otherPoint);
      if (!otherCoordinate) continue;
      const graphAdjacent = adjacency.get(point)?.has(otherPoint) ?? false;
      const gridAdjacent = manhattanDistance(candidate, otherCoordinate) === 1;
      if (graphAdjacent !== gridAdjacent) {
        valid = false;
        break;
      }
    }
    if (valid) candidates.push(candidate);
  }

  return Object.freeze(candidates);
};

const embedSquareGrid = (
  points: readonly PointId[],
  adjacency: ReadonlyMap<PointId, ReadonlySet<PointId>>,
): ReadonlyMap<PointId, Coordinate> | null => {
  const root = points[0];
  if (root === undefined) return new Map();

  const assigned = new Map<PointId, Coordinate>([[root, Object.freeze({ x: 0, y: 0 })]]);
  const occupiedCoordinates = new Map<string, PointId>([['0,0', root]]);

  const search = (): boolean => {
    if (assigned.size === points.length) return true;

    let selectedPoint: PointId | undefined;
    let selectedCandidates: readonly Coordinate[] = Object.freeze([]);
    let selectedAssignedNeighborCount = -1;

    for (const point of points) {
      if (assigned.has(point)) continue;
      const assignedNeighborCount = [...(adjacency.get(point) ?? [])].filter((neighbor) =>
        assigned.has(neighbor),
      ).length;
      if (assignedNeighborCount === 0) continue;

      const candidates = candidateCoordinates(
        point,
        points,
        adjacency,
        assigned,
        occupiedCoordinates,
      );
      if (candidates.length === 0) return false;

      if (
        selectedPoint === undefined ||
        assignedNeighborCount > selectedAssignedNeighborCount ||
        (assignedNeighborCount === selectedAssignedNeighborCount &&
          candidates.length < selectedCandidates.length) ||
        (assignedNeighborCount === selectedAssignedNeighborCount &&
          candidates.length === selectedCandidates.length &&
          point < selectedPoint)
      ) {
        selectedPoint = point;
        selectedCandidates = candidates;
        selectedAssignedNeighborCount = assignedNeighborCount;
      }
    }

    if (selectedPoint === undefined) return false;

    for (const candidate of selectedCandidates) {
      const key = coordinateKey(candidate);
      assigned.set(selectedPoint, candidate);
      occupiedCoordinates.set(key, selectedPoint);
      if (search()) return true;
      occupiedCoordinates.delete(key);
      assigned.delete(selectedPoint);
    }
    return false;
  };

  return search() ? new Map(assigned) : null;
};

export const analyzePlanarLocalNeighborhood = (
  topology: Topology,
  state: GameState,
  targetPoints: readonly PointId[],
  options: PlanarLocalAnalyzerOptions = {},
): PlanarLocalAnalysisResult => {
  const radius = options.radius ?? DEFAULT_RADIUS;
  const boardSize = options.boardSize ?? DEFAULT_BOARD_SIZE;
  const margin = options.margin ?? DEFAULT_MARGIN;

  if (!Number.isSafeInteger(radius) || radius < 0) {
    throw new Error(`Planar analyzer radius must be a non-negative integer, got ${String(radius)}`);
  }
  if (!Number.isSafeInteger(boardSize) || boardSize < 2) {
    throw new Error(`Planar analyzer boardSize must be an integer >= 2, got ${String(boardSize)}`);
  }
  if (!Number.isSafeInteger(margin) || margin < 0) {
    throw new Error(`Planar analyzer margin must be a non-negative integer, got ${String(margin)}`);
  }

  const targets = Object.freeze([...new Set(targetPoints)].sort());
  if (targets.length === 0 || targets.some((point) => !topology.has(point))) {
    return Object.freeze({
      status: 'not-applicable',
      reason: 'invalid-target',
      detail: 'Target points must be non-empty and belong to the source topology.',
    });
  }

  const points = collectNeighborhood(topology, targets, radius);
  const adjacency = makeAdjacency(topology, points);
  const embedding = embedSquareGrid(points, adjacency);
  if (!embedding) {
    return Object.freeze({
      status: 'not-applicable',
      reason: 'non-square-grid-neighborhood',
      detail: `The radius-${radius} induced neighborhood cannot be embedded in an orthogonal square grid.`,
    });
  }

  const coordinates = [...embedding.values()];
  const minX = Math.min(...coordinates.map(({ x }) => x));
  const maxX = Math.max(...coordinates.map(({ x }) => x));
  const minY = Math.min(...coordinates.map(({ y }) => y));
  const maxY = Math.max(...coordinates.map(({ y }) => y));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  if (width + margin * 2 > boardSize || height + margin * 2 > boardSize) {
    return Object.freeze({
      status: 'not-applicable',
      reason: 'context-too-large',
      detail: `Embedded ${width}x${height} context plus margin ${margin} does not fit ${boardSize}x${boardSize}.`,
    });
  }

  const offsetColumn = Math.floor((boardSize - width) / 2) - minX;
  const offsetRow = Math.floor((boardSize - height) / 2) - minY;
  const projected = points.map((point) => {
    const coordinate = embedding.get(point);
    if (!coordinate) throw new Error(`Missing embedded coordinate for ${point}`);
    return Object.freeze({
      point,
      row: coordinate.y + offsetRow,
      column: coordinate.x + offsetColumn,
      occupancy: state.board[point] ?? 'empty',
    });
  });

  return Object.freeze({
    status: 'applicable',
    projection: Object.freeze({
      boardSize,
      radius,
      margin,
      targetPoints: targets,
      points: Object.freeze(projected),
    }),
  });
};
