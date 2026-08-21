import type { CSSProperties, ReactElement } from 'react';
import type { PointId } from '../core/topology/Topology';
import type { CubeFace } from '../core/topology/CubeTopology';
import {
  CUBE_2D_LAYOUT_COLUMNS,
  CUBE_2D_LAYOUT_ROWS,
  type Cube2DLayout,
  type Cube2DLayoutCell,
  type Cube2DLayoutColumn,
  type Cube2DLayoutRow,
} from '../presentation/cube/Cube2DLayout';
import type { CubeRotation } from '../presentation/cube/CubeOrientation';

export const CUBE_2D_SVG_SIZE = 100;
export const CUBE_2D_TRANSITION_MS = 260;

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
  readonly pointRows: readonly (readonly Cube2DVisualPoint[])[];
  readonly points: readonly Cube2DVisualPoint[];
}

export interface Cube2DRenderModel {
  readonly size: Cube2DLayout['size'];
  readonly rows: typeof CUBE_2D_LAYOUT_ROWS;
  readonly columns: typeof CUBE_2D_LAYOUT_COLUMNS;
  readonly boards: readonly Cube2DVisualBoard[];
}

export type Cube2DRendererTransitionDirection = 'left' | 'right' | 'up' | 'down' | 'anchor';

export interface Cube2DRendererTransition {
  readonly fromLayout: Cube2DLayout;
  readonly direction: Cube2DRendererTransitionDirection;
  readonly id: number;
}

const visualCoordinate = (index: number, size: number): number => {
  const step = CUBE_2D_SVG_SIZE / size;
  return step * (index + 0.5);
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
    pointRows,
    points: Object.freeze(pointRows.flat()),
  });
};

/**
 * Converts an already-resolved six-face Cube2DLayout into renderer-local SVG coordinates.
 * Face selection, rotation, occupied placement slots and logical point mapping are owned by
 * Cube2DLayout. This layer only assigns SVG positions inside each occupied visual board.
 */
export const createCube2DRenderModel = (layout: Cube2DLayout): Cube2DRenderModel =>
  Object.freeze({
    size: layout.size,
    rows: CUBE_2D_LAYOUT_ROWS,
    columns: CUBE_2D_LAYOUT_COLUMNS,
    boards: Object.freeze(layout.cells.map((cell) => createVisualBoard(cell, layout.size))),
  });

export interface Cube2DRendererProps {
  readonly layout: Cube2DLayout;
  readonly diagnostics?: boolean;
  readonly transition?: Cube2DRendererTransition;
  readonly onVerticalAnchorColumnChange?: (column: Cube2DLayoutColumn) => void;
}

type MotionClass = 'normal' | 'wrap-right-to-left' | 'wrap-left-to-right';

interface BoardMotion {
  readonly className: MotionClass;
  readonly fromColumns: number;
  readonly fromRows: number;
  readonly fromRotation: number;
}

type MotionStyle = CSSProperties & {
  '--cube-from-x'?: string;
  '--cube-from-y'?: string;
  '--cube-from-rotation'?: string;
  '--cube-transition-ms'?: string;
};

const shortestRotationDelta = (from: CubeRotation, to: CubeRotation): number => {
  let delta = from - to;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
};

const resolveBoardMotion = (
  board: Cube2DVisualBoard,
  transition: Cube2DRendererTransition | undefined,
): BoardMotion | null => {
  if (!transition) return null;
  const previous = transition.fromLayout.cells.find((cell) => cell.face === board.face);
  if (!previous) return null;

  const fromColumns = previous.column - board.column;
  const fromRows = previous.row - board.row;
  const fromRotation = shortestRotationDelta(previous.rotation, board.rotation);
  const changed = fromColumns !== 0 || fromRows !== 0 || fromRotation !== 0;
  if (!changed) return null;

  if (
    transition.direction === 'left' &&
    previous.row === 1 &&
    board.row === 1 &&
    previous.column === 3 &&
    board.column === 0
  ) {
    return { className: 'wrap-right-to-left', fromColumns, fromRows, fromRotation };
  }

  if (
    transition.direction === 'right' &&
    previous.row === 1 &&
    board.row === 1 &&
    previous.column === 0 &&
    board.column === 3
  ) {
    return { className: 'wrap-left-to-right', fromColumns, fromRows, fromRotation };
  }

  return { className: 'normal', fromColumns, fromRows, fromRotation };
};

const renderBoard = (
  board: Cube2DVisualBoard,
  size: number,
  diagnostics: boolean,
  transition: Cube2DRendererTransition | undefined,
): ReactElement => {
  const coordinates = Array.from({ length: size }, (_, index) => visualCoordinate(index, size));
  const motion = resolveBoardMotion(board, transition);
  const placementStyle: MotionStyle = {
    gridRow: board.row + 1,
    gridColumn: board.column + 1,
  };

  if (motion) {
    placementStyle['--cube-from-x'] = `${motion.fromColumns * 100}%`;
    placementStyle['--cube-from-y'] = `${motion.fromRows * 100}%`;
    placementStyle['--cube-from-rotation'] = `${motion.fromRotation}deg`;
    placementStyle['--cube-transition-ms'] = `${CUBE_2D_TRANSITION_MS}ms`;
  }

  const motionClass = motion
    ? ` cube-2d-board--moving cube-2d-board--${motion.className}`
    : '';

  return (
    <figure
      className={`cube-2d-board${board.isCentral ? ' cube-2d-board--central' : ''}${motionClass}`}
      data-layout-row={board.row}
      data-layout-column={board.column}
      data-face={board.face}
      data-rotation={board.rotation}
      data-central={board.isCentral}
      data-motion={motion?.className ?? 'none'}
      key={board.face}
      style={placementStyle}
    >
      {diagnostics ? (
        <figcaption className="cube-2d-board__diagnostic">
          <strong>{board.face}</strong>
          <span>{board.rotation}°</span>
          {board.isCentral ? <span>central</span> : null}
        </figcaption>
      ) : null}

      <div className={motion?.fromRotation ? 'cube-2d-board__motion cube-2d-board__motion--rotating' : 'cube-2d-board__motion'}>
        <svg
          className="cube-2d-board__svg"
          viewBox={`0 0 ${CUBE_2D_SVG_SIZE} ${CUBE_2D_SVG_SIZE}`}
          role="img"
          aria-label={`${board.face} face, rotation ${board.rotation} degrees`}
        >
          <rect
            className="cube-2d-board__surface"
            x="0"
            y="0"
            width={CUBE_2D_SVG_SIZE}
            height={CUBE_2D_SVG_SIZE}
          />

          <g className="cube-2d-board__grid" aria-hidden="true">
            {coordinates.map((coordinate, index) => (
              <line
                key={`v:${index}`}
                x1={coordinate}
                y1="0"
                x2={coordinate}
                y2={CUBE_2D_SVG_SIZE}
              />
            ))}
            {coordinates.map((coordinate, index) => (
              <line
                key={`h:${index}`}
                x1="0"
                y1={coordinate}
                x2={CUBE_2D_SVG_SIZE}
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
      </div>
    </figure>
  );
};

const renderAnchorSlots = (
  layout: Cube2DLayout,
  disabled: boolean,
  onVerticalAnchorColumnChange: Cube2DRendererProps['onVerticalAnchorColumnChange'],
): readonly ReactElement[] => {
  const slots: ReactElement[] = [];

  for (const row of [0, 2] as const) {
    for (const column of [0, 1, 2, 3] as const) {
      if (layout.rows[row][column] !== null) continue;
      const side = row === 0 ? 'top' : 'bottom';
      slots.push(
        <button
          type="button"
          className="cube-2d-anchor-slot"
          aria-label={`Move top and bottom to column ${column + 1} using ${side} slot`}
          data-layout-row={row}
          data-layout-column={column}
          data-anchor-preview="available"
          disabled={disabled || !onVerticalAnchorColumnChange}
          key={`slot:${row}:${column}`}
          style={{ gridRow: row + 1, gridColumn: column + 1 }}
          onClick={() => onVerticalAnchorColumnChange?.(column)}
        />,
      );
    }
  }

  return Object.freeze(slots);
};

/** Six physical faces in a 4x3 placement field. Topology is already resolved by Cube2DLayout. */
export function Cube2DRenderer({
  layout,
  diagnostics = false,
  transition,
  onVerticalAnchorColumnChange,
}: Cube2DRendererProps) {
  const model = createCube2DRenderModel(layout);
  const isAnimating = transition !== undefined;

  return (
    <section
      className="cube-2d-renderer"
      data-cube-size={model.size}
      data-layout-rows={model.rows}
      data-layout-columns={model.columns}
      data-board-count={model.boards.length}
      data-vertical-anchor-column={layout.verticalAnchorColumn}
      data-animating={isAnimating}
      data-transition-id={transition?.id ?? 'none'}
      aria-label="Cube 2D six-face renderer in 4 by 3 placement field"
    >
      {renderAnchorSlots(layout, isAnimating, onVerticalAnchorColumnChange)}
      {model.boards.map((board) => renderBoard(board, model.size, diagnostics, transition))}
    </section>
  );
}
