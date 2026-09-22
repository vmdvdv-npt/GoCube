import * as THREE from 'three';
import {
  parseCubePointId,
  type CubeFace,
  type CubeSize,
} from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO,
  cube3DGridEdgeInset,
  cube3DSurfaceSample,
} from './Cube3DSurfaceGeometry';

type GridPoint = Readonly<{ x: number; y: number }>;
type GridCell = Readonly<{ column: number; row: number }>;
type Direction = 0 | 1 | 2 | 3;

type BoundaryEdge = Readonly<{
  from: GridPoint;
  to: GridPoint;
  direction: Direction;
  key: string;
}>;

type RoundedCorner = Readonly<{
  center: GridPoint;
  entry: GridPoint;
  exit: GridPoint;
}>;

export interface Cube3DReviewContourGridLoop {
  readonly face: CubeFace;
  readonly points: readonly GridPoint[];
}

const CORNER_RADIUS_GRID_UNITS = 0.5;
const STRAIGHT_SAMPLE_STEP_GRID_UNITS = 0.2;
const ARC_SAMPLES_PER_QUARTER = 10;

const cellKey = (column: number, row: number): string => `${column},${row}`;
const pointKey = (point: GridPoint): string => `${point.x},${point.y}`;

const boundaryEdge = (
  from: GridPoint,
  to: GridPoint,
  direction: Direction,
): BoundaryEdge =>
  Object.freeze({
    from,
    to,
    direction,
    key: `${pointKey(from)}>${pointKey(to)}`,
  });

const boundaryEdges = (cells: readonly GridCell[]): readonly BoundaryEdge[] => {
  const uniqueCells = new Map<string, GridCell>();
  for (const cell of cells) uniqueCells.set(cellKey(cell.column, cell.row), cell);

  const occupied = new Set(uniqueCells.keys());
  const edges: BoundaryEdge[] = [];

  for (const cell of uniqueCells.values()) {
    const left = cell.column - 0.5;
    const right = cell.column + 0.5;
    const top = cell.row - 0.5;
    const bottom = cell.row + 0.5;

    if (!occupied.has(cellKey(cell.column, cell.row - 1))) {
      edges.push(boundaryEdge({ x: left, y: top }, { x: right, y: top }, 0));
    }
    if (!occupied.has(cellKey(cell.column + 1, cell.row))) {
      edges.push(boundaryEdge({ x: right, y: top }, { x: right, y: bottom }, 1));
    }
    if (!occupied.has(cellKey(cell.column, cell.row + 1))) {
      edges.push(boundaryEdge({ x: right, y: bottom }, { x: left, y: bottom }, 2));
    }
    if (!occupied.has(cellKey(cell.column - 1, cell.row))) {
      edges.push(boundaryEdge({ x: left, y: bottom }, { x: left, y: top }, 3));
    }
  }

  return Object.freeze(
    edges.sort(
      (left, right) =>
        left.from.y - right.from.y ||
        left.from.x - right.from.x ||
        left.direction - right.direction,
    ),
  );
};

const nextDirectionPriority = (incoming: Direction): readonly Direction[] =>
  Object.freeze([
    ((incoming + 1) % 4) as Direction,
    incoming,
    ((incoming + 3) % 4) as Direction,
    ((incoming + 2) % 4) as Direction,
  ]);

const simplifyLoop = (loop: readonly GridPoint[]): readonly GridPoint[] => {
  let current = [...loop];
  let changed = true;

  while (changed && current.length > 4) {
    changed = false;
    const next = current.filter((point, index) => {
      const previous = current[(index + current.length - 1) % current.length]!;
      const following = current[(index + 1) % current.length]!;
      const collinear =
        (previous.x === point.x && point.x === following.x) ||
        (previous.y === point.y && point.y === following.y);
      if (collinear) changed = true;
      return !collinear;
    });
    if (next.length < 4) break;
    current = next;
  }

  return Object.freeze(current.map((point) => Object.freeze({ ...point })));
};

const traceBoundaryLoops = (edges: readonly BoundaryEdge[]): readonly (readonly GridPoint[])[] => {
  const outgoing = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(pointKey(edge.from)) ?? [];
    list.push(edge);
    outgoing.set(pointKey(edge.from), list);
  }

  const used = new Set<string>();
  const loops: Array<readonly GridPoint[]> = [];

  for (const start of edges) {
    if (used.has(start.key)) continue;

    const points: GridPoint[] = [start.from];
    let edge = start;

    while (true) {
      used.add(edge.key);
      if (pointKey(edge.to) === pointKey(start.from)) break;
      points.push(edge.to);

      const candidates = (outgoing.get(pointKey(edge.to)) ?? []).filter(
        (candidate) => !used.has(candidate.key),
      );
      if (candidates.length === 0) {
        throw new Error('Cube 3D endgame contour boundary did not form a closed loop');
      }

      const priority = nextDirectionPriority(edge.direction);
      candidates.sort(
        (left, right) =>
          priority.indexOf(left.direction) - priority.indexOf(right.direction),
      );
      edge = candidates[0]!;
    }

    loops.push(simplifyLoop(points));
  }

  return Object.freeze(loops);
};

const unitDirection = (from: GridPoint, to: GridPoint): GridPoint => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if ((dx !== 0 && dy !== 0) || (dx === 0 && dy === 0)) {
    throw new Error('Cube 3D endgame contour boundary must stay axis-aligned');
  }
  return Object.freeze({ x: Math.sign(dx), y: Math.sign(dy) });
};

const roundedCorners = (loop: readonly GridPoint[]): readonly RoundedCorner[] =>
  Object.freeze(
    loop.map((point, index) => {
      const previous = loop[(index + loop.length - 1) % loop.length]!;
      const following = loop[(index + 1) % loop.length]!;
      const incoming = unitDirection(previous, point);
      const outgoing = unitDirection(point, following);

      return Object.freeze({
        center: point,
        entry: Object.freeze({
          x: point.x - incoming.x * CORNER_RADIUS_GRID_UNITS,
          y: point.y - incoming.y * CORNER_RADIUS_GRID_UNITS,
        }),
        exit: Object.freeze({
          x: point.x + outgoing.x * CORNER_RADIUS_GRID_UNITS,
          y: point.y + outgoing.y * CORNER_RADIUS_GRID_UNITS,
        }),
      });
    }),
  );

const samePoint = (left: GridPoint, right: GridPoint): boolean =>
  Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.y - right.y) < 1e-9;

const appendPoint = (points: GridPoint[], point: GridPoint): void => {
  if (points.length > 0 && samePoint(points[points.length - 1]!, point)) return;
  points.push(Object.freeze({ x: point.x, y: point.y }));
};

const appendStraightSamples = (
  points: GridPoint[],
  from: GridPoint,
  to: GridPoint,
): void => {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / STRAIGHT_SAMPLE_STEP_GRID_UNITS));
  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    appendPoint(points, {
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount,
    });
  }
};

const appendArcSamples = (
  points: GridPoint[],
  corner: RoundedCorner,
): void => {
  const startX = corner.entry.x - corner.center.x;
  const startY = corner.entry.y - corner.center.y;
  const endX = corner.exit.x - corner.center.x;
  const endY = corner.exit.y - corner.center.y;
  const angle = Math.atan2(startX * endY - startY * endX, startX * endX + startY * endY);
  const steps = Math.max(
    2,
    Math.ceil((Math.abs(angle) / (Math.PI / 2)) * ARC_SAMPLES_PER_QUARTER),
  );

  for (let step = 1; step <= steps; step += 1) {
    const amount = step / steps;
    const theta = angle * amount;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    appendPoint(points, {
      x: corner.center.x + startX * cos - startY * sin,
      y: corner.center.y + startX * sin + startY * cos,
    });
  }
};

const roundedLoopSamples = (loop: readonly GridPoint[]): readonly GridPoint[] => {
  const corners = roundedCorners(loop);
  if (corners.length === 0) return Object.freeze([]);

  const samples: GridPoint[] = [];
  const start = corners[0]!.exit;
  appendPoint(samples, start);
  let cursor = start;

  for (let offset = 1; offset <= corners.length; offset += 1) {
    const corner = corners[offset % corners.length]!;
    appendStraightSamples(samples, cursor, corner.entry);
    appendArcSamples(samples, corner);
    cursor = corner.exit;
  }

  if (samples.length > 1 && samePoint(samples[0]!, samples[samples.length - 1]!)) {
    samples.pop();
  }
  return Object.freeze(samples);
};

/**
 * Builds rounded outer loops in logical grid coordinates. Adjacent stones share
 * one boundary, so there is no internal review stroke between stones in a group.
 */
export const cube3DReviewContourGridLoops = (
  size: CubeSize,
  pointIds: readonly PointId[],
): readonly Cube3DReviewContourGridLoop[] => {
  const cellsByFace = new Map<CubeFace, GridCell[]>();
  for (const pointId of pointIds) {
    const point = parseCubePointId(size, pointId);
    const cells = cellsByFace.get(point.face) ?? [];
    cells.push(Object.freeze({ column: point.column, row: point.row }));
    cellsByFace.set(point.face, cells);
  }

  const loops: Cube3DReviewContourGridLoop[] = [];
  for (const [face, cells] of cellsByFace) {
    for (const loop of traceBoundaryLoops(boundaryEdges(cells))) {
      loops.push(Object.freeze({ face, points: roundedLoopSamples(loop) }));
    }
  }
  return Object.freeze(loops);
};

const gridCoordinateToLocal = (size: CubeSize, coordinate: number): number => {
  const inset = cube3DGridEdgeInset(size);
  const pitchUnits = inset / CUBE_3D_GRID_EDGE_MARGIN_PITCH_RATIO;
  return inset + coordinate * pitchUnits;
};

interface SurfacePoint {
  readonly center: THREE.Vector3;
  readonly normal: THREE.Vector3;
}

const toSurfacePoint = (
  size: CubeSize,
  face: CubeFace,
  point: GridPoint,
  lift: number,
): SurfacePoint => {
  const sample = cube3DSurfaceSample(
    face,
    gridCoordinateToLocal(size, point.x),
    gridCoordinateToLocal(size, point.y),
  );
  const normal = new THREE.Vector3(...sample.normal).normalize();
  return Object.freeze({
    center: new THREE.Vector3(...sample.position).addScaledVector(normal, lift),
    normal,
  });
};

const tangentOnSurface = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  normal: THREE.Vector3,
): THREE.Vector3 => {
  const tangent = to.clone().sub(from);
  tangent.addScaledVector(normal, -tangent.dot(normal));
  if (tangent.lengthSq() <= 1e-12) return new THREE.Vector3(1, 0, 0);
  return tangent.normalize();
};

/**
 * Creates an actual surface-hugging ribbon mesh instead of billboard lines or a
 * chain of circular stamps. The mesh stays below stones, so depth testing hides
 * the inward overlap and only the outer contour remains visible.
 */
export const createCube3DReviewContourGeometry = (
  size: CubeSize,
  pointIds: readonly PointId[],
  strokeWidth: number,
  lift: number,
): THREE.BufferGeometry => {
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) {
    throw new Error('Cube 3D review contour stroke width must be positive');
  }
  if (!Number.isFinite(lift) || lift < 0) {
    throw new Error('Cube 3D review contour lift must be non-negative');
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = strokeWidth / 2;
  let loopCount = 0;

  for (const loop of cube3DReviewContourGridLoops(size, pointIds)) {
    if (loop.points.length < 3) continue;
    const surface = loop.points.map((point) => toSurfacePoint(size, loop.face, point, lift));
    const baseIndex = positions.length / 3;

    for (let index = 0; index < surface.length; index += 1) {
      const current = surface[index]!;
      const previous = surface[(index + surface.length - 1) % surface.length]!;
      const following = surface[(index + 1) % surface.length]!;
      const previousTangent = tangentOnSurface(previous.center, current.center, current.normal);
      const followingTangent = tangentOnSurface(current.center, following.center, current.normal);
      const previousSide = new THREE.Vector3()
        .crossVectors(current.normal, previousTangent)
        .normalize();
      const followingSide = new THREE.Vector3()
        .crossVectors(current.normal, followingTangent)
        .normalize();
      const miter = previousSide.clone().add(followingSide);
      if (miter.lengthSq() <= 1e-12) miter.copy(followingSide);
      miter.normalize();
      const alignment = Math.max(0.5, Math.abs(miter.dot(followingSide)));
      const miterLength = Math.min(halfWidth / alignment, halfWidth * 1.6);

      const left = current.center.clone().addScaledVector(miter, miterLength);
      const right = current.center.clone().addScaledVector(miter, -miterLength);
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    }

    for (let index = 0; index < surface.length; index += 1) {
      const next = (index + 1) % surface.length;
      const left = baseIndex + index * 2;
      const right = left + 1;
      const nextLeft = baseIndex + next * 2;
      const nextRight = nextLeft + 1;
      indices.push(left, right, nextLeft, right, nextRight, nextLeft);
    }
    loopCount += 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.userData.reviewContourLoopCount = loopCount;
  if (positions.length > 0) geometry.computeBoundingSphere();
  return geometry;
};
