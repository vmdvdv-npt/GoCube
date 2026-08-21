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
  readonly verticalAnchorColumn: Cube2DLayoutColumn;
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

const makeVerticalRow = (
  row: 0 | 2,
  column: Cube2DLayoutColumn,
  orientation: CubeOrientation,
  size: CubeSize,
): readonly Cube2DLayoutSlot[] => {
  const slots: Cube2DLayoutSlot[] = [null, null, null, null];
  slots[column] = makeCell(row, column, orientation, size);
  return Object.freeze(slots);
};

/**
 * Builds the renderer-agnostic Cube 2D cross inside a fixed 4x3 placement field.
 * Exactly six positions are occupied: the four-face side ring across the middle row plus
 * the physical top/bottom faces in the selected vertical anchor column. Every physical
 * cube face occurs exactly once and the remaining six slots are empty.
 *
 * TOP/BOTTOM orientation is resolved from the side face in the selected column. This is
 * essential: moving the vertical pair changes only its visual placement/rotation, while
 * every visible seam continues to connect actual CubeTopology neighbors.
 */
export const createCube2DLayout = (
  orientation: CubeOrientation,
  size: CubeSize,
  verticalAnchorColumn: Cube2DLayoutColumn = CUBE_2D_CENTER.column,
): Cube2DLayout => {
  const left = orientation.moveLeft();
  const right = orientation.moveRight();
  const back = right.moveRight();
  const sideRing = [left, orientation, right, back] as const;
  const anchorOrientation = sideRing[verticalAnchorColumn];
  const top = anchorOrientation.moveUp();
  const bottom = anchorOrientation.moveDown();

  const rows: readonly (readonly Cube2DLayoutSlot[])[] = Object.freeze([
    makeVerticalRow(0, verticalAnchorColumn, top, size),
    Object.freeze([
      makeCell(1, 0, left, size),
      makeCell(1, 1, orientation, size),
      makeCell(1, 2, right, size),
      makeCell(1, 3, back, size),
    ]),
    makeVerticalRow(2, verticalAnchorColumn, bottom, size),
  ]);

  const cells = Object.freeze(
    rows.flat().filter((cell): cell is Cube2DLayoutCell => cell !== null),
  );

  return Object.freeze({
    orientation,
    size,
    verticalAnchorColumn,
    rows,
    cells,
  });
};
