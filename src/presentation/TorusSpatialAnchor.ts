import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';

export interface TorusSpatialAnchor {
  readonly row: number;
  readonly column: number;
}

export type TorusSpatialDirection = 'left' | 'right' | 'up' | 'down';

export interface Torus2DLogicalOffset {
  readonly offsetX: number;
  readonly offsetY: number;
}

const wrap = (value: number, size: number): number => ((value % size) + size) % size;

const assertCoordinate = (value: number, label: string): void => {
  if (!Number.isInteger(value)) {
    throw new Error(`Torus spatial ${label} must be an integer`);
  }
};

export const createTorusSpatialAnchor = (
  size: TorusSize,
  row: number,
  column: number,
): TorusSpatialAnchor => {
  assertCoordinate(row, 'row');
  assertCoordinate(column, 'column');
  return Object.freeze({
    row: wrap(row, size),
    column: wrap(column, size),
  });
};

export const torusSpatialAnchorPointId = (anchor: TorusSpatialAnchor): PointId =>
  `${anchor.column},${anchor.row}`;

export const torusSpatialAnchorFromPointId = (
  size: TorusSize,
  pointId: PointId,
): TorusSpatialAnchor => {
  const [columnText, rowText, extra] = pointId.split(',');
  const column = Number(columnText);
  const row = Number(rowText);
  if (
    extra !== undefined ||
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    column < 0 ||
    row >= size ||
    column >= size
  ) {
    throw new Error(`Unknown Torus ${size}x${size} PointId: ${pointId}`);
  }
  return Object.freeze({ row, column });
};

export const moveTorusSpatialAnchor = (
  size: TorusSize,
  anchor: TorusSpatialAnchor,
  direction: TorusSpatialDirection,
): TorusSpatialAnchor => {
  switch (direction) {
    case 'left':
      return createTorusSpatialAnchor(size, anchor.row, anchor.column - 1);
    case 'right':
      return createTorusSpatialAnchor(size, anchor.row, anchor.column + 1);
    case 'up':
      return createTorusSpatialAnchor(size, anchor.row - 1, anchor.column);
    case 'down':
      return createTorusSpatialAnchor(size, anchor.row + 1, anchor.column);
  }
};

export const torusSpatialAnchorFrom2DOffset = (
  size: TorusSize,
  offset: Torus2DLogicalOffset,
): TorusSpatialAnchor => {
  assertCoordinate(offset.offsetX, '2D offsetX');
  assertCoordinate(offset.offsetY, '2D offsetY');
  const center = (size - 1) / 2;
  return createTorusSpatialAnchor(
    size,
    center + offset.offsetY,
    center + offset.offsetX,
  );
};

export const torus2DOffsetForSpatialAnchor = (
  size: TorusSize,
  anchor: TorusSpatialAnchor,
): Torus2DLogicalOffset => {
  const normalized = createTorusSpatialAnchor(size, anchor.row, anchor.column);
  const center = (size - 1) / 2;
  return Object.freeze({
    offsetX: wrap(normalized.column - center, size),
    offsetY: wrap(normalized.row - center, size),
  });
};
