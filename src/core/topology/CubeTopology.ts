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

type CubeEdge = 'top' | 'right' | 'bottom' | 'left';

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

interface CubePoint {
  readonly face: CubeFace;
  readonly row: number;
  readonly column: number;
}

const parsePoint = (point: PointId): CubePoint => {
  const [face, rowText, columnText] = point.split(':');
  return {
    face: face as CubeFace,
    row: Number(rowText),
    column: Number(columnText),
  };
};

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

    const { face, row, column } = parsePoint(point);
    const last = this.size - 1;

    return Object.freeze([
      row > 0
        ? cubePointId(face, row - 1, column)
        : this.crossEdge(face, 'top', column),
      column < last
        ? cubePointId(face, row, column + 1)
        : this.crossEdge(face, 'right', row),
      row < last
        ? cubePointId(face, row + 1, column)
        : this.crossEdge(face, 'bottom', column),
      column > 0
        ? cubePointId(face, row, column - 1)
        : this.crossEdge(face, 'left', row),
    ]);
  }

  private crossEdge(face: CubeFace, edge: CubeEdge, index: number): PointId {
    const transition = EDGE_TRANSITIONS[face][edge];
    const last = this.size - 1;
    const targetIndex = transition.reverse ? last - index : index;
    return pointOnEdge(transition.face, transition.edge, targetIndex, last);
  }
}
