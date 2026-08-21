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
  readonly isDuplicate: boolean;
  readonly pointIds: readonly (readonly PointId[])[];
}

export interface Cube2DLayout {
  readonly orientation: CubeOrientation;
  readonly size: CubeSize;
  readonly cells: readonly Cube2DLayoutCell[];
  readonly rows: readonly (readonly Cube2DLayoutCell[])[];
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
    isDuplicate: row !== 1 && column !== CUBE_2D_CENTER.column,
    pointIds: pointMatrix(orientation.centerFace, orientation.rotation, size),
  });

/**
 * Builds a renderer-agnostic 4x3 gallery. The middle row is the four-face side ring;
 * the upper and lower rows show the corresponding top/bottom face in four rotations.
 * Only the extra top/bottom copies are marked as visual duplicates.
 */
export const createCube2DLayout = (
  orientation: CubeOrientation,
  size: CubeSize,
): Cube2DLayout => {
  const middleOrientations = Object.freeze([
    orientation.moveLeft(),
    orientation,
    orientation.moveRight(),
    orientation.moveRight().moveRight(),
  ] as const);

  const orientationRows = Object.freeze([
    Object.freeze(middleOrientations.map((entry) => entry.moveUp())),
    middleOrientations,
    Object.freeze(middleOrientations.map((entry) => entry.moveDown())),
  ] as const);

  const rows = Object.freeze(
    orientationRows.map((orientationRow, row) =>
      Object.freeze(
        orientationRow.map((entry, column) =>
          makeCell(row as Cube2DLayoutRow, column as Cube2DLayoutColumn, entry, size),
        ),
      ),
    ),
  );

  return Object.freeze({
    orientation,
    size,
    rows,
    cells: Object.freeze(rows.flat()),
  });
};
