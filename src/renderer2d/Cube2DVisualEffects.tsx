import type { ReactElement } from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { StoneColor } from '../core/game/types';
import type { CubeFace } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type { EndgameGroupRenderState } from '../presentation/EndgameGroupPresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
import type { Cube2DLayout } from '../presentation/cube/Cube2DLayout';
import { CUBE_2D_TRANSITION_MS, type Cube2DRendererTransition } from './Cube2DRenderer';

export const CUBE_2D_CAPTURE_FLIGHT_STAGGER_MS = 150;
export const CUBE_2D_CAPTURE_FLIGHT_DURATION_MS = 520;
export const CUBE_2D_OVERLAY_WIDTH = 400;
export const CUBE_2D_OVERLAY_HEIGHT = 300;

export interface Cube2DOverlayPointGeometry {
  readonly pointId: PointId;
  readonly face: CubeFace;
  readonly x: number;
  readonly y: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly cellSize: number;
}

export interface Cube2DCaptureEffect {
  readonly id: string;
  readonly logicalPointId: PointId;
  readonly color: StoneColor;
  readonly x: number;
  readonly y: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly delayMs: number;
  readonly durationMs: number;
}

export interface Cube2DTerritoryCell extends Cube2DOverlayPointGeometry {
  readonly owner: 'black' | 'white';
}

export interface Cube2DEndgameSegment {
  readonly face: CubeFace;
  readonly groupId: string;
  readonly status: GroupStatus | null;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly hovered: boolean;
  readonly selected: boolean;
}

export interface Cube2DVisualEffectsProps {
  readonly layout: Cube2DLayout;
  readonly viewModel: GameViewModel;
  readonly endgameGroups?: readonly EndgameGroupRenderState[];
  readonly hoveredGroupId?: string | null;
  readonly selectedGroupId?: string | null;
  readonly captureEffects?: readonly Cube2DCaptureEffect[];
  readonly transition?: Cube2DRendererTransition;
}

const geometryMap = (layout: Cube2DLayout): ReadonlyMap<PointId, Cube2DOverlayPointGeometry> => {
  const step = 100 / layout.size;
  const geometry = new Map<PointId, Cube2DOverlayPointGeometry>();

  for (const cell of layout.cells) {
    for (let row = 0; row < cell.pointIds.length; row += 1) {
      for (let column = 0; column < cell.pointIds[row]!.length; column += 1) {
        const pointId = cell.pointIds[row]![column]!;
        const cellX = cell.column * 100 + column * step;
        const cellY = cell.row * 100 + row * step;
        geometry.set(
          pointId,
          Object.freeze({
            pointId,
            face: cell.face,
            x: cellX + step / 2,
            y: cellY + step / 2,
            cellX,
            cellY,
            cellSize: step,
          }),
        );
      }
    }
  }

  return geometry;
};

export const buildCube2DCaptureEffects = (
  previousViewModel: GameViewModel,
  captured: readonly PointId[],
  layout: Cube2DLayout,
): readonly Cube2DCaptureEffect[] => {
  const geometry = geometryMap(layout);
  const occupancy = new Map(
    previousViewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
  );
  const effects: Cube2DCaptureEffect[] = [];

  for (const [index, pointId] of captured.entries()) {
    const point = geometry.get(pointId);
    const color = occupancy.get(pointId);
    if (!point || (color !== 'black' && color !== 'white')) continue;

    effects.push(
      Object.freeze({
        id: `capture:${previousViewModel.moveNumber}:${index}:${pointId}`,
        logicalPointId: pointId,
        color,
        x: point.x,
        y: point.y,
        targetX: color === 'white' ? CUBE_2D_OVERLAY_WIDTH + 60 : -60,
        targetY: Math.max(-24, point.y - 36),
        delayMs: index * CUBE_2D_CAPTURE_FLIGHT_STAGGER_MS,
        durationMs: CUBE_2D_CAPTURE_FLIGHT_DURATION_MS,
      }),
    );
  }

  return Object.freeze(effects);
};

export const buildCube2DTerritoryCells = (
  viewModel: GameViewModel,
  layout: Cube2DLayout,
): readonly Cube2DTerritoryCell[] => {
  const score = viewModel.finalScore;
  if (!score) return Object.freeze([]);

  const geometry = geometryMap(layout);
  const cells: Cube2DTerritoryCell[] = [];

  for (const owner of ['black', 'white'] as const) {
    for (const pointId of score.territoryPoints[owner]) {
      const point = geometry.get(pointId);
      if (!point) continue;
      cells.push(Object.freeze({ ...point, owner }));
    }
  }

  return Object.freeze(cells);
};

export const buildCube2DEndgameSegments = (
  groups: readonly EndgameGroupRenderState[],
  layout: Cube2DLayout,
  hoveredGroupId: string | null,
  selectedGroupId: string | null,
): readonly Cube2DEndgameSegment[] => {
  const geometry = geometryMap(layout);
  const visibleNeighborDistance = 100 / layout.size;
  const segments: Cube2DEndgameSegment[] = [];

  for (const group of groups) {
    const hovered = group.id === hoveredGroupId;
    const selected = group.id === selectedGroupId;
    if (!group.status && !hovered && !selected) continue;

    for (const edge of group.edges) {
      const from = geometry.get(edge.from);
      const to = geometry.get(edge.to);
      if (!from || !to) continue;

      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (distance > visibleNeighborDistance * 1.05) continue;

      const base = {
        groupId: group.id,
        status: group.status,
        hovered,
        selected,
      } as const;
      if (from.face === to.face) {
        segments.push(
          Object.freeze({
            ...base,
            face: from.face,
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
          }),
        );
      } else {
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        segments.push(
          Object.freeze({
            ...base,
            face: from.face,
            x1: from.x,
            y1: from.y,
            x2: midX,
            y2: midY,
          }),
          Object.freeze({
            ...base,
            face: to.face,
            x1: midX,
            y1: midY,
            x2: to.x,
            y2: to.y,
          }),
        );
      }
    }
  }

  return Object.freeze(segments);
};

const statusByPoint = (
  viewModel: GameViewModel,
  groups: readonly EndgameGroupRenderState[],
): ReadonlyMap<PointId, GroupStatus> => {
  const statuses = new Map<PointId, GroupStatus>();

  for (const point of viewModel.points) {
    if (point.endgameStatus) statuses.set(point.logicalPointId, point.endgameStatus);
  }
  for (const group of groups) {
    if (!group.status) continue;
    for (const point of group.points) statuses.set(point, group.status);
  }

  return statuses;
};

const groupPoints = (
  groups: readonly EndgameGroupRenderState[],
  groupId: string | null,
): readonly PointId[] => groups.find((group) => group.id === groupId)?.points ?? Object.freeze([]);

interface FaceMotion {
  readonly dx: number;
  readonly dy: number;
  readonly rotationDelta: number;
  readonly wrap: 'right-to-left' | 'left-to-right' | null;
  readonly centerX: number;
  readonly centerY: number;
}

const shortestRotationDelta = (from: number, to: number): number => {
  let delta = from - to;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
};

const faceMotion = (
  face: CubeFace,
  layout: Cube2DLayout,
  transition: Cube2DRendererTransition | undefined,
): FaceMotion | null => {
  if (!transition) return null;
  const current = layout.cells.find((cell) => cell.face === face);
  const previous = transition.fromLayout.cells.find((cell) => cell.face === face);
  if (!current || !previous) return null;

  const dx = (previous.column - current.column) * 100;
  const dy = (previous.row - current.row) * 100;
  const rotationDelta = shortestRotationDelta(previous.rotation, current.rotation);
  if (dx === 0 && dy === 0 && rotationDelta === 0) return null;

  let wrap: FaceMotion['wrap'] = null;
  if (
    transition.direction === 'left' &&
    previous.row === 1 &&
    current.row === 1 &&
    previous.column === 3 &&
    current.column === 0
  ) {
    wrap = 'right-to-left';
  } else if (
    transition.direction === 'right' &&
    previous.row === 1 &&
    current.row === 1 &&
    previous.column === 0 &&
    current.column === 3
  ) {
    wrap = 'left-to-right';
  }

  return Object.freeze({
    dx,
    dy,
    rotationDelta,
    wrap,
    centerX: current.column * 100 + 50,
    centerY: current.row * 100 + 50,
  });
};

const renderFaceMotionAnimations = (motion: FaceMotion | null): ReactElement | null => {
  if (!motion) return null;
  const duration = `${CUBE_2D_TRANSITION_MS}ms`;
  const translate = motion.wrap === 'right-to-left'
    ? (
        <>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="300 0;400 0;-100 0;0 0"
            keyTimes="0;0.48;0.52;1"
            dur={duration}
            fill="freeze"
          />
          <animate
            attributeName="opacity"
            values="1;1;0;0;1;1"
            keyTimes="0;0.47;0.48;0.52;0.53;1"
            dur={duration}
            fill="freeze"
          />
        </>
      )
    : motion.wrap === 'left-to-right'
      ? (
          <>
            <animateTransform
              attributeName="transform"
              type="translate"
              values="-300 0;-400 0;100 0;0 0"
              keyTimes="0;0.48;0.52;1"
              dur={duration}
              fill="freeze"
            />
            <animate
              attributeName="opacity"
              values="1;1;0;0;1;1"
              keyTimes="0;0.47;0.48;0.52;0.53;1"
              dur={duration}
              fill="freeze"
            />
          </>
        )
      : (
          <animateTransform
            attributeName="transform"
            type="translate"
            from={`${motion.dx} ${motion.dy}`}
            to="0 0"
            dur={duration}
            fill="freeze"
            calcMode="spline"
            keyTimes="0;1"
            keySplines="0.22 0.75 0.22 1"
          />
        );

  return <>{translate}</>;
};

const renderRotationAnimation = (motion: FaceMotion | null): ReactElement | null => {
  if (!motion || motion.rotationDelta === 0) return null;
  return (
    <animateTransform
      attributeName="transform"
      type="rotate"
      from={`${motion.rotationDelta} ${motion.centerX} ${motion.centerY}`}
      to={`0 ${motion.centerX} ${motion.centerY}`}
      dur={`${CUBE_2D_TRANSITION_MS}ms`}
      fill="freeze"
      calcMode="spline"
      keyTimes="0;1"
      keySplines="0.22 0.75 0.22 1"
    />
  );
};

const renderCaptureEffect = (
  effect: Cube2DCaptureEffect,
  radius: number,
): ReactElement => {
  const dx = effect.targetX - effect.x;
  const dy = effect.targetY - effect.y;
  const begin = `${effect.delayMs}ms`;
  const duration = `${effect.durationMs}ms`;

  return (
    <circle
      key={effect.id}
      className={`cube-2d-capture-stone cube-2d-capture-stone--${effect.color}`}
      cx={effect.x}
      cy={effect.y}
      r={radius}
      fill={effect.color === 'black' ? 'url(#cube-2d-overlay-black-stone)' : 'url(#cube-2d-overlay-white-stone)'}
      data-logical-point-id={effect.logicalPointId}
      data-capture-color={effect.color}
      data-delay-ms={effect.delayMs}
      data-target-x={effect.targetX}
      data-target-y={effect.targetY}
    >
      <animateTransform
        attributeName="transform"
        type="translate"
        from="0 0"
        to={`${dx} ${dy}`}
        begin={begin}
        dur={duration}
        fill="freeze"
        calcMode="spline"
        keyTimes="0;1"
        keySplines="0.22 0.72 0.24 1"
      />
      <animate
        attributeName="opacity"
        values="1;1;0"
        keyTimes="0;0.76;1"
        begin={begin}
        dur={duration}
        fill="freeze"
      />
    </circle>
  );
};

export function Cube2DVisualEffects({
  layout,
  viewModel,
  endgameGroups = Object.freeze([]),
  hoveredGroupId = null,
  selectedGroupId = null,
  captureEffects = Object.freeze([]),
  transition,
}: Cube2DVisualEffectsProps) {
  const geometry = geometryMap(layout);
  const territoryCells = buildCube2DTerritoryCells(viewModel, layout);
  const statuses = statusByPoint(viewModel, endgameGroups);
  const hoveredPoints = new Set(groupPoints(endgameGroups, hoveredGroupId));
  const selectedPoints = new Set(groupPoints(endgameGroups, selectedGroupId));
  const segments = buildCube2DEndgameSegments(
    endgameGroups,
    layout,
    hoveredGroupId,
    selectedGroupId,
  );
  const stoneRadius = (100 / layout.size) * 0.39;

  const faces = layout.cells.map((cell) => cell.face);

  return (
    <svg
      className="cube-2d-visual-effects"
      viewBox={`0 0 ${CUBE_2D_OVERLAY_WIDTH} ${CUBE_2D_OVERLAY_HEIGHT}`}
      aria-hidden="true"
      data-capture-count={captureEffects.length}
      data-territory-count={territoryCells.length}
    >
      <defs>
        <radialGradient id="cube-2d-overlay-black-stone" cx="35%" cy="25%" r="70%">
          <stop offset="0" stopColor="#555" />
          <stop offset="0.35" stopColor="#111" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <radialGradient id="cube-2d-overlay-white-stone" cx="35%" cy="25%" r="70%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.45" stopColor="#eee" />
          <stop offset="1" stopColor="#cfcfcf" />
        </radialGradient>
      </defs>

      <g className="cube-2d-territory-layer">
        {faces.map((face) => {
          const motion = faceMotion(face, layout, transition);
          return (
            <g key={`territory-face:${face}:${transition?.id ?? 'static'}`}>
              {renderFaceMotionAnimations(motion)}
              <g>
                {renderRotationAnimation(motion)}
                {territoryCells
                  .filter((cell) => cell.face === face)
                  .map((cell) => (
                    <rect
                      key={`territory:${cell.owner}:${cell.pointId}`}
                      className={`cube-2d-territory-cell cube-2d-territory-cell--${cell.owner}`}
                      x={cell.cellX}
                      y={cell.cellY}
                      width={cell.cellSize}
                      height={cell.cellSize}
                      data-logical-point-id={cell.pointId}
                      data-territory-owner={cell.owner}
                    />
                  ))}
              </g>
            </g>
          );
        })}
      </g>

      <g className="cube-2d-endgame-links">
        {faces.map((face) => {
          const motion = faceMotion(face, layout, transition);
          return (
            <g key={`links-face:${face}:${transition?.id ?? 'static'}`}>
              {renderFaceMotionAnimations(motion)}
              <g>
                {renderRotationAnimation(motion)}
                {segments
                  .filter((segment) => segment.face === face)
                  .map((segment, index) => (
                    <line
                      key={`${segment.groupId}:${face}:${index}`}
                      className={`cube-2d-endgame-link${segment.status ? ` cube-2d-endgame-link--${segment.status}` : ''}${segment.hovered ? ' cube-2d-endgame-link--hovered' : ''}${segment.selected ? ' cube-2d-endgame-link--selected' : ''}`}
                      x1={segment.x1}
                      y1={segment.y1}
                      x2={segment.x2}
                      y2={segment.y2}
                      data-group-id={segment.groupId}
                      data-status={segment.status ?? 'unknown'}
                    />
                  ))}
              </g>
            </g>
          );
        })}
      </g>

      <g className="cube-2d-endgame-status-layer">
        {faces.map((face) => {
          const motion = faceMotion(face, layout, transition);
          return (
            <g key={`status-face:${face}:${transition?.id ?? 'static'}`}>
              {renderFaceMotionAnimations(motion)}
              <g>
                {renderRotationAnimation(motion)}
                {[...statuses.entries()].map(([pointId, status]) => {
                  const point = geometry.get(pointId);
                  if (!point || point.face !== face) return null;
                  return (
                    <g key={`status:${pointId}`} data-logical-point-id={pointId} data-endgame-status={status}>
                      {status === 'dead' ? (
                        <circle
                          className="cube-2d-dead-stone"
                          cx={point.x}
                          cy={point.y}
                          r={stoneRadius}
                          data-logical-point-id={pointId}
                        />
                      ) : null}
                      <circle
                        className={`cube-2d-endgame-status-ring cube-2d-endgame-status-ring--${status}`}
                        cx={point.x}
                        cy={point.y}
                        r={stoneRadius * 1.04}
                        data-logical-point-id={pointId}
                      />
                    </g>
                  );
                })}
              </g>
            </g>
          );
        })}
      </g>

      <g className="cube-2d-endgame-interaction-layer">
        {faces.map((face) => {
          const motion = faceMotion(face, layout, transition);
          return (
            <g key={`interaction-face:${face}:${transition?.id ?? 'static'}`}>
              {renderFaceMotionAnimations(motion)}
              <g>
                {renderRotationAnimation(motion)}
                {[...hoveredPoints].map((pointId) => {
                  const point = geometry.get(pointId);
                  return point && point.face === face ? (
                    <circle
                      key={`hover:${pointId}`}
                      className="cube-2d-endgame-group-hover"
                      cx={point.x}
                      cy={point.y}
                      r={stoneRadius * 1.12}
                      data-logical-point-id={pointId}
                    />
                  ) : null;
                })}
                {[...selectedPoints].map((pointId) => {
                  const point = geometry.get(pointId);
                  return point && point.face === face ? (
                    <circle
                      key={`selected:${pointId}`}
                      className="cube-2d-endgame-group-selected"
                      cx={point.x}
                      cy={point.y}
                      r={stoneRadius * 1.17}
                      data-logical-point-id={pointId}
                    />
                  ) : null;
                })}
              </g>
            </g>
          );
        })}
      </g>

      <g className="cube-2d-capture-layer">
        {captureEffects.map((effect) => renderCaptureEffect(effect, stoneRadius))}
      </g>
    </svg>
  );

}
