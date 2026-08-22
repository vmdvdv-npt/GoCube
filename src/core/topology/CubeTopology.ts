import type { PointId, Topology } from './Topology';

/**
 * CubeTopology is parameterized by board size and intentionally does not know
 * which sizes the current UI chooses to expose. Application/UI configuration
 * owns that list.
 */
export type CubeSize = number;

export const isValidCubeSize = (size: number): size is CubeSize =>
  Number.isSafeInteger(size) && size >= 2;

export const CUBE_FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type CubeFace = (typeof CUBE_FACES)[number];
export type CubeDirection = 'top' | 'right' | 'bottom' | 'left';

type CubeEdge = CubeDirection;

interface EdgeTransition {
  readonly face: CubeFace;
  readonly edge: CubeEdge;
  readonly reverse: boolean;
}

const EDGE_TRANSITIONS: Readonly<Record<CubeFace, Readonly<Record<CubeEdge, EdgeTransition>>>> =
  Object.freeze({
    front: Object.freeze({
      top: Object.freeze({ face: 'top', edge: 'bottom', reverse: false }),
      right: Object.freeze({ face: 'right', edge: 'left', reverse: false }),
      bottom: Object.freeze({ face: 'bottom', edge: 'top', reverse: false }),
      left: Object.freeze({ face: 'left', edge: 'right', reverse: false }),
    }),
    back: Object.freeze({
      top: Object.freeze({ face: 'top', edge: 'top', reverse: true }),
      right: Object.freeze({ face: 'left', edge: 'left', reverse: false }),
      bottom: Object.freeze({ face: 'bottom', edge: 'bottom', reverse: true }),
      left: Object.freeze({ face: 'right', edge: 'right', reverse: false }),
    }),
    left: Object.freeze({
      top: Object.freeze({ face: 'top', edge: 'left', reverse: false }),
      right: Object.freeze({ face: 'front', edge: 'left', reverse: false }),
      bottom: Object.freeze({ face: 'bottom', edge: 'left', reverse: true }),
      left: Object.freeze({ face: 'back', edge: 'right', reverse: false }),
    }),
    right: Object.freeze({
      top: Object.freeze({ face: 'top', edge: 'right', reverse: true }),
      right: Object.freeze({ face: 'back', edge: 'left', reverse: false }),
      bottom: Object.freeze({ face: 'bottom', edge: 'right', reverse: false }),
      left: Object.freeze({ face: 'front', edge: 'right', reverse: false }),
    }),
    top: Object.freeze({
      top: Object.freeze({ face: 'back', edge: 'top', reverse: true }),
      right: Object.freeze({ face: 'right', edge: 'top', reverse: true }),
      bottom: Object.freeze({ face: 'front', edge: 'top', reverse: false }),
      left: Object.freeze({ face: 'left', edge: 'top', reverse: false }),
    }),
    bottom: Object.freeze({
      top: Object.freeze({ face: 'front', edge: 'bottom', reverse: false }),
      right: Object.freeze({ face: 'right', edge: 'bottom', reverse: false }),
      bottom: Object.freeze({ face: 'back', edge: 'bottom', reverse: true }),
      left: Object.freeze({ face: 'left', edge: 'bottom', reverse: true }),
    }),
  });

export const cubePointId = (face: CubeFace, row: number, column: number): PointId =>
  `${face}:${row}:${column}`;

const pointOnEdge = (
  face: CubeFace,
  edge: CubeEdge,
  index: number,
  last: number,
): PointId => {
  switch (edge) {
    case 'top':
      return cubePointId(face, 0, index);
    case 'right':
      return cubePointId(face, index, last);
    case 'bottom':
      return cubePointId(face, last, index);
    case 'left':
      return cubePointId(face, index, 0);
  }
};

const crossCubeEdge = (
  size: CubeSize,
  face: CubeFace,
  edge: CubeEdge,
  index: number,
): PointId => {
  const transition = EDGE_TRANSITIONS[face][edge];
  const last = size - 1;
  const targetIndex = transition.reverse ? last - index : index;
  return pointOnEdge(transition.face, transition.edge, targetIndex, last);
};

const isCubeFace = (value: string): value is CubeFace =>
  CUBE_FACES.includes(value as CubeFace);

/**
 * Renderer-neutral one-step surface traversal used by topology-stress test tooling.
 * The returned PointId follows the same edge transitions as CubeTopology.neighbors().
 */
export const cubeStepPoint = (
  size: CubeSize,
  point: PointId,
  direction: CubeDirection,
): PointId => {
  if (!isValidCubeSize(size)) {
    throw new Error(`Cube size must be a safe integer >= 2, got ${String(size)}`);
  }

  const [faceText, rowText, columnText, ...extra] = point.split(':');
  if (extra.length > 0 || !faceText || !isCubeFace(faceText)) {
    throw new Error(`Unknown cube point: ${point}`);
  }

  const face = faceText;
  const row = Number(rowText);
  const column = Number(columnText);
  const last = size - 1;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    column < 0 ||
    row > last ||
    column > last
  ) {
    throw new Error(`Unknown cube point: ${point}`);
  }

  switch (direction) {
    case 'top':
      return row > 0
        ? cubePointId(face, row - 1, column)
        : crossCubeEdge(size, face, 'top', column);
    case 'right':
      return column < last
        ? cubePointId(face, row, column + 1)
        : crossCubeEdge(size, face, 'right', row);
    case 'bottom':
      return row < last
        ? cubePointId(face, row + 1, column)
        : crossCubeEdge(size, face, 'bottom', column);
    case 'left':
      return column > 0
        ? cubePointId(face, row, column - 1)
        : crossCubeEdge(size, face, 'left', row);
  }
};

export class CubeTopology implements Topology {
  readonly id: string;
  private readonly pointSet: ReadonlySet<PointId>;
  private readonly allPoints: readonly PointId[];

  constructor(readonly size: CubeSize) {
    if (!isValidCubeSize(size)) {
      throw new Error(`Cube size must be a safe integer >= 2, got ${String(size)}`);
    }

    this.id = `cube-${size}x${size}`;
    this.allPoints = Object.freeze(
      CUBE_FACES.flatMap((face) =>
        Array.from({ length: size * size }, (_, index) =>
          cubePointId(face, Math.floor(index / size), index % size),
        ),
      ),
    );
    this.pointSet = new Set(this.allPoints);
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    if (!this.has(point)) {
      throw new Error(`Unknown point: ${point}`);
    }

    return Object.freeze([
      cubeStepPoint(this.size, point, 'top'),
      cubeStepPoint(this.size, point, 'right'),
      cubeStepPoint(this.size, point, 'bottom'),
      cubeStepPoint(this.size, point, 'left'),
    ]);
  }
}
