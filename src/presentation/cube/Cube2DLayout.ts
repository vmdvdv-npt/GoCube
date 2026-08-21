import {
  cubePointId,
  type CubeFace,
  type CubeSize,
} from '../../core/topology/CubeTopology';
import type { PointId } from '../../core/topology/Topology';
import { CubeOrientation, type CubeRotation } from './CubeOrientation';

export const CUBE_2D_LAYOUT_ROWS = 3 as const;
export const CUBE_2D_LAYOUT_COLUMNS = 4 as const;
export const CUBE_2D_CENTER = Object.freeze({ row: 1, column: 1 } as const);

export type Cube2DLayoutRow = 0 | 1 | 2;
export type Cube2DLayoutColumn = 0 | 1 | 2 | 3;

export interface Cube2DLayoutCell {
  readonly row: Cube2DLayoutRow;
  readonly column: Cube2DLayoutColumn;
  readonly face: CubeFace;
  readonly rotation: CubeRotation;
  readonly isCentral: boolean;
  readonly pointIds: readonly (readonly PointId[])[];
}

export type Cube2DLayoutSlot = Cube2DLayoutCell | null;

export interface Cube2DLayout {
  readonly orientation: CubeOrientation;
  readonly size: CubeSize;
  readonly cells: readonly Cube2DLayoutCell[];
  readonly rows: readonly (readonly Cube2DLayoutSlot[])[];
}

const logicalCoordinatesAt = (
  rotation: CubeRotation,
  size: CubeSize,
  row: number,
  column: number,
): readonly [row: number, column: number] => {
  const last = size - 1;

  switch (rotation) {
    case 0:
      return [row, column];
    case 90:
      return [last - column, row];
    case 180:
      return [last - row, last - column];
    case 270:
      return [column, last - row];
  }
};

const pointMatrix = (
  face: CubeFace,
  rotation: CubeRotation,
  size: CubeSize,
): readonly (readonly PointId[])[] =>
  Object.freeze(
    Array.from({ length: size }, (_, row) =>
      Object.freeze(
        Array.from({ length: size }, (_, column) => {
          const [logicalRow, logicalColumn] = logicalCoordinatesAt(rotation, size, row, column);
          return cubePointId(face, logicalRow, logicalColumn);
        }),
      ),
    ),
  );

const makeCell = (
  row: Cube2DLayoutRow,
  column: Cube2DLayoutColumn,
  orientation: CubeOrientation,
  size: CubeSize,
): Cube2DLayoutCell =>
  Object.freeze({
    row,
    column,
    face: orientation.centerFace,
    rotation: orientation.rotation,
    isCentral: row === CUBE_2D_CENTER.row && column === CUBE_2D_CENTER.column,
    pointIds: pointMatrix(orientation.centerFace, orientation.rotation, size),
  });

/**
 * Builds the renderer-agnostic Cube 2D cross inside a fixed 4x3 placement field.
 * Exactly six positions are occupied: top above the center, the four-face side ring
 * across the middle row, and bottom below the center. Every physical cube face occurs
 * exactly once; the remaining six slots are empty and there are no visual duplicates.
 */
export const createCube2DLayout = (
  orientation: CubeOrientation,
  size: CubeSize,
): Cube2DLayout => {
  const left = orientation.moveLeft();
  const right = orientation.moveRight();
  const back = right.moveRight();
  const top = orientation.moveUp();
  const bottom = orientation.moveDown();

  const rows: readonly (readonly Cube2DLayoutSlot[])[] = Object.freeze([
    Object.freeze([
      null,
      makeCell(0, 1, top, size),
      null,
      null,
    ]),
    Object.freeze([
      makeCell(1, 0, left, size),
      makeCell(1, 1, orientation, size),
      makeCell(1, 2, right, size),
      makeCell(1, 3, back, size),
    ]),
    Object.freeze([
      null,
      makeCell(2, 1, bottom, size),
      null,
      null,
    ]),
  ]);

  const cells = Object.freeze(
    rows.flat().filter((cell): cell is Cube2DLayoutCell => cell !== null),
  );

  return Object.freeze({
    orientation,
    size,
    rows,
    cells,
  });
};
