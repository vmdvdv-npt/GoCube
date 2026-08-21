import type { ReactElement } from 'react';
import type { PointId } from '../core/topology/Topology';
import type { CubeFace } from '../core/topology/CubeTopology';
import type {
  Cube2DLayout,
  Cube2DLayoutCell,
  Cube2DLayoutColumn,
  Cube2DLayoutRow,
} from '../presentation/cube/Cube2DLayout';
import type { CubeRotation } from '../presentation/cube/CubeOrientation';

const SVG_SIZE = 100;
const GRID_MARGIN = 8;

export interface Cube2DVisualPoint {
  readonly pointId: PointId;
  readonly row: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
}

export interface Cube2DVisualBoard {
  readonly row: Cube2DLayoutRow;
  readonly column: Cube2DLayoutColumn;
  readonly face: CubeFace;
  readonly rotation: CubeRotation;
  readonly isCentral: boolean;
  readonly isDuplicate: boolean;
  readonly pointRows: readonly (readonly Cube2DVisualPoint[])[];
  readonly points: readonly Cube2DVisualPoint[];
}

export interface Cube2DRenderModel {
  readonly size: Cube2DLayout['size'];
  readonly boards: readonly Cube2DVisualBoard[];
}

const visualCoordinate = (index: number, size: number): number => {
  const gridSpan = SVG_SIZE - GRID_MARGIN * 2;
  return GRID_MARGIN + (gridSpan * index) / (size - 1);
};

const createVisualBoard = (
  cell: Cube2DLayoutCell,
  size: Cube2DLayout['size'],
): Cube2DVisualBoard => {
  const pointRows = Object.freeze(
    cell.pointIds.map((pointRow, row) =>
      Object.freeze(
        pointRow.map((pointId, column) =>
          Object.freeze({
            pointId,
            row,
            column,
            x: visualCoordinate(column, size),
            y: visualCoordinate(row, size),
          }),
        ),
      ),
    ),
  );

  return Object.freeze({
    row: cell.row,
    column: cell.column,
    face: cell.face,
    rotation: cell.rotation,
    isCentral: cell.isCentral,
    isDuplicate: cell.isDuplicate,
    pointRows,
    points: Object.freeze(pointRows.flat()),
  });
};

/**
 * Converts an already-resolved Cube2DLayout into renderer-local coordinates.
 * Face selection, rotation, duplicate status and logical point mapping are copied
 * from the layout verbatim; this layer only assigns SVG positions to visual rows/columns.
 */
export const createCube2DRenderModel = (layout: Cube2DLayout): Cube2DRenderModel =>
  Object.freeze({
    size: layout.size,
    boards: Object.freeze(layout.cells.map((cell) => createVisualBoard(cell, layout.size))),
  });

export interface Cube2DRendererProps {
  readonly layout: Cube2DLayout;
  readonly diagnostics?: boolean;
}

const renderBoard = (
  board: Cube2DVisualBoard,
  size: number,
  diagnostics: boolean,
): ReactElement => {
  const coordinates = Array.from({ length: size }, (_, index) => visualCoordinate(index, size));

  return (
    <figure
      className={`cube-2d-board${board.isCentral ? ' cube-2d-board--central' : ''}${
        board.isDuplicate ? ' cube-2d-board--duplicate' : ''
      }`}
      data-layout-row={board.row}
      data-layout-column={board.column}
      data-face={board.face}
      data-rotation={board.rotation}
      data-central={board.isCentral}
      data-duplicate={board.isDuplicate}
      key={`${board.row}:${board.column}`}
    >
      {diagnostics ? (
        <figcaption className="cube-2d-board__diagnostic">
          <strong>{board.face}</strong>
          <span>{board.rotation}°</span>
          {board.isCentral ? <span>central</span> : null}
          {board.isDuplicate ? <span>duplicate</span> : null}
        </figcaption>
      ) : null}

      <svg
        className="cube-2d-board__svg"
        viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        role="img"
        aria-label={`${board.face} face, rotation ${board.rotation} degrees`}
      >
        <rect className="cube-2d-board__surface" x="0" y="0" width={SVG_SIZE} height={SVG_SIZE} />

        <g className="cube-2d-board__grid" aria-hidden="true">
          {coordinates.map((coordinate, index) => (
            <line
              key={`v:${index}`}
              x1={coordinate}
              y1={GRID_MARGIN}
              x2={coordinate}
              y2={SVG_SIZE - GRID_MARGIN}
            />
          ))}
          {coordinates.map((coordinate, index) => (
            <line
              key={`h:${index}`}
              x1={GRID_MARGIN}
              y1={coordinate}
              x2={SVG_SIZE - GRID_MARGIN}
              y2={coordinate}
            />
          ))}
        </g>

        <g className="cube-2d-board__points" aria-hidden="true">
          {board.points.map((point) => (
            <circle
              key={`${point.row}:${point.column}`}
              className="cube-2d-visual-point"
              cx={point.x}
              cy={point.y}
              r="2.2"
              data-point-id={point.pointId}
              data-visual-row={point.row}
              data-visual-column={point.column}
            />
          ))}
        </g>
      </svg>
    </figure>
  );
};

/** First technical Cube 2D renderer: layout data in, SVG/DOM out. */
export function Cube2DRenderer({ layout, diagnostics = false }: Cube2DRendererProps) {
  const model = createCube2DRenderModel(layout);

  return (
    <section
      className="cube-2d-renderer"
      data-cube-size={model.size}
      aria-label="Cube 2D 4 by 3 renderer"
    >
      {model.boards.map((board) => renderBoard(board, model.size, diagnostics))}
    </section>
  );
}
