import type { CSSProperties, ReactElement } from 'react';
import type { StoneColor } from '../core/game/types';
import type { CubeFace } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
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

export type Cube2DRendererTransitionDirection = 'left' | 'right' | 'up' | 'down';

export interface Cube2DRendererTransition {
  readonly fromLayout: Cube2DLayout;
  readonly direction: Cube2DRendererTransitionDirection;
  readonly id: number;
}

export type Cube2DHoverStatus = 'allowed' | 'forbidden' | 'occupied' | null;

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

/** Converts an already-resolved Cube2DLayout into renderer-local SVG coordinates. */
export const createCube2DRenderModel = (layout: Cube2DLayout): Cube2DRenderModel =>
  Object.freeze({
    size: layout.size,
    rows: CUBE_2D_LAYOUT_ROWS,
    columns: CUBE_2D_LAYOUT_COLUMNS,
    boards: Object.freeze(layout.cells.map((cell) => createVisualBoard(cell, layout.size))),
  });

/** Pure hit test inside one visual board. Coordinates are in the 0..100 SVG viewBox. */
export const hitTestCube2DPoint = (
  board: Cube2DVisualBoard,
  x: number,
  y: number,
): PointId | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x >= CUBE_2D_SVG_SIZE || y >= CUBE_2D_SVG_SIZE) return null;

  const size = board.pointRows.length;
  const step = CUBE_2D_SVG_SIZE / size;
  const row = Math.min(size - 1, Math.floor(y / step));
  const column = Math.min(size - 1, Math.floor(x / step));
  return board.pointRows[row]?.[column]?.pointId ?? null;
};

export interface Cube2DRendererProps {
  readonly layout: Cube2DLayout;
  readonly diagnostics?: boolean;
  readonly transition?: Cube2DRendererTransition;
  readonly viewModel?: GameViewModel;
  readonly hoveredPointId?: PointId | null;
  readonly hoverStatus?: Cube2DHoverStatus;
  readonly recentlyPlacedPointId?: PointId | null;
  readonly showMoveNumbers?: boolean;
  readonly inputDisabled?: boolean;
  readonly onPointHover?: (pointId: PointId | null) => void;
  readonly onPointActivate?: (pointId: PointId) => void;
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

interface BoardGameplayContext {
  readonly points: ReadonlyMap<PointId, GameViewPoint>;
  readonly currentPlayer: StoneColor | null;
  readonly lastMovePointId: PointId | null;
  readonly hoveredPointId: PointId | null;
  readonly hoverStatus: Cube2DHoverStatus;
  readonly recentlyPlacedPointId: PointId | null;
  readonly showMoveNumbers: boolean;
  readonly inputDisabled: boolean;
  readonly onPointHover?: (pointId: PointId | null) => void;
  readonly onPointActivate?: (pointId: PointId) => void;
}

const stonePaintIds = (face: CubeFace) => ({
  blackGradient: `cube-2d-${face}-black-gradient`,
  whiteGradient: `cube-2d-${face}-white-gradient`,
});

const renderStoneDefs = (face: CubeFace): ReactElement => {
  const ids = stonePaintIds(face);
  return (
    <defs aria-hidden="true">
      <radialGradient id={ids.blackGradient} cx="35%" cy="25%" r="70%">
        <stop offset="0" stopColor="#555" />
        <stop offset="0.35" stopColor="#111" />
        <stop offset="1" stopColor="#000" />
      </radialGradient>
      <radialGradient id={ids.whiteGradient} cx="35%" cy="25%" r="70%">
        <stop offset="0" stopColor="#fff" />
        <stop offset="0.45" stopColor="#eee" />
        <stop offset="1" stopColor="#cfcfcf" />
      </radialGradient>
    </defs>
  );
};

const renderBoard = (
  board: Cube2DVisualBoard,
  size: number,
  diagnostics: boolean,
  transition: Cube2DRendererTransition | undefined,
  gameplay: BoardGameplayContext,
): ReactElement => {
  const coordinates = Array.from({ length: size }, (_, index) =>
    visualCoordinate(index, size),
  );
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
  const step = CUBE_2D_SVG_SIZE / size;
  const stoneRadius = step * 0.39;
  const previewRadius = stoneRadius;
  const markerRadius = Math.max(1.1, step * 0.09);
  const ids = stonePaintIds(board.face);

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

      <div
        className={
          motion?.fromRotation
            ? 'cube-2d-board__motion cube-2d-board__motion--rotating'
            : 'cube-2d-board__motion'
        }
      >
        <svg
          className="cube-2d-board__svg"
          viewBox={`0 0 ${CUBE_2D_SVG_SIZE} ${CUBE_2D_SVG_SIZE}`}
          role="img"
          aria-label={`${board.face} face, rotation ${board.rotation} degrees`}
        >
          {renderStoneDefs(board.face)}
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

          <g className="cube-2d-board__stones" aria-hidden="true">
            {board.points.map((point) => {
              const viewPoint = gameplay.points.get(point.pointId);
              const occupancy = viewPoint?.occupancy;
              if (occupancy !== 'black' && occupancy !== 'white') return null;
              const isLastMove = gameplay.lastMovePointId === point.pointId;
              const showNumber =
                gameplay.showMoveNumbers && !isLastMove && viewPoint?.moveNumber;
              const fill =
                occupancy === 'black'
                  ? `url(#${ids.blackGradient})`
                  : `url(#${ids.whiteGradient})`;
              return (
                <g key={`stone:${point.pointId}`} data-logical-point-id={point.pointId}>
                  <circle
                    className={`cube-2d-stone cube-2d-stone--${occupancy}${
                      gameplay.recentlyPlacedPointId === point.pointId
                        ? ' cube-2d-stone--placed'
                        : ''
                    }`}
                    cx={point.x}
                    cy={point.y}
                    r={stoneRadius}
                    fill={fill}
                    data-occupancy={occupancy}
                    data-logical-point-id={point.pointId}
                  />
                  {isLastMove ? (
                    <circle
                      className="cube-2d-last-move-marker"
                      cx={point.x}
                      cy={point.y}
                      r={markerRadius}
                      fill={occupancy === 'black' ? '#fff' : '#000'}
                      data-logical-point-id={point.pointId}
                    />
                  ) : null}
                  {showNumber ? (
                    <text
                      className="cube-2d-move-number"
                      x={point.x}
                      y={point.y}
                      fill={occupancy === 'black' ? '#f6f6f6' : '#111'}
                      textAnchor="middle"
                      dominantBaseline="central"
                      data-logical-point-id={point.pointId}
                    >
                      {viewPoint.moveNumber}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g className="cube-2d-board__hover" aria-hidden="true">
            {gameplay.hoveredPointId &&
            gameplay.currentPlayer &&
            gameplay.hoverStatus === 'allowed'
              ? board.points
                  .filter((point) => point.pointId === gameplay.hoveredPointId)
                  .map((point) => (
                    <circle
                      key={`preview:${point.pointId}`}
                      className={`cube-2d-preview-stone cube-2d-preview-stone--${gameplay.currentPlayer}`}
                      cx={point.x}
                      cy={point.y}
                      r={previewRadius}
                      fill={
                        gameplay.currentPlayer === 'black'
                          ? `url(#${ids.blackGradient})`
                          : `url(#${ids.whiteGradient})`
                      }
                      data-logical-point-id={point.pointId}
                    />
                  ))
              : null}
            {gameplay.hoveredPointId && gameplay.hoverStatus === 'forbidden'
              ? board.points
                  .filter((point) => point.pointId === gameplay.hoveredPointId)
                  .map((point) => (
                    <circle
                      key={`forbidden:${point.pointId}`}
                      className="cube-2d-forbidden-marker"
                      cx={point.x}
                      cy={point.y}
                      r={markerRadius}
                      data-logical-point-id={point.pointId}
                    />
                  ))
              : null}
          </g>

          <g className="cube-2d-board__hit-areas">
            {board.points.map((point) => (
              <rect
                key={`hit:${point.row}:${point.column}`}
                className="cube-2d-hit-area"
                x={point.column * step}
                y={point.row * step}
                width={step}
                height={step}
                fill="transparent"
                data-point-id={point.pointId}
                data-logical-point-id={point.pointId}
                data-visual-row={point.row}
                data-visual-column={point.column}
                pointerEvents={gameplay.inputDisabled ? 'none' : 'all'}
                onMouseEnter={() => gameplay.onPointHover?.(point.pointId)}
                onMouseLeave={() => gameplay.onPointHover?.(null)}
                onClick={() => gameplay.onPointActivate?.(point.pointId)}
              />
            ))}
          </g>
        </svg>
      </div>
    </figure>
  );
};

/** Six physical faces in a fixed 4×3 placement field with six plain empty slots. */
export function Cube2DRenderer({
  layout,
  diagnostics = false,
  transition,
  viewModel,
  hoveredPointId = null,
  hoverStatus = null,
  recentlyPlacedPointId = null,
  showMoveNumbers = false,
  inputDisabled = false,
  onPointHover,
  onPointActivate,
}: Cube2DRendererProps) {
  const model = createCube2DRenderModel(layout);
  const isAnimating = transition !== undefined;
  const gameplayInputDisabled = isAnimating || inputDisabled;
  const points = new Map<PointId, GameViewPoint>(
    viewModel?.points.map((point) => [point.logicalPointId, point]) ?? [],
  );
  const gameplay: BoardGameplayContext = {
    points,
    currentPlayer: viewModel?.currentPlayer ?? null,
    lastMovePointId: viewModel?.lastMovePointId ?? null,
    hoveredPointId: gameplayInputDisabled ? null : hoveredPointId,
    hoverStatus: gameplayInputDisabled ? null : hoverStatus,
    recentlyPlacedPointId,
    showMoveNumbers,
    inputDisabled: gameplayInputDisabled,
    onPointHover,
    onPointActivate,
  };

  return (
    <section
      className="cube-2d-renderer"
      data-cube-size={model.size}
      data-layout-rows={model.rows}
      data-layout-columns={model.columns}
      data-board-count={model.boards.length}
      data-animating={isAnimating}
      data-gameplay-input-disabled={gameplayInputDisabled}
      data-transition-id={transition?.id ?? 'none'}
      aria-label="Cube 2D six-face renderer in 4 by 3 placement field"
    >
      {model.boards.map((board) =>
        renderBoard(board, model.size, diagnostics, transition, gameplay),
      )}
    </section>
  );
}
