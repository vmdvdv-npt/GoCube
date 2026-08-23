import type { CSSProperties, ReactNode } from 'react';
import type { EndgameClassification, GroupStatus } from '../core/endgame/EndgameClassifier';
import type { FinalScore } from '../core/scoring/Scoring';
import type { PointId } from '../core/topology/Topology';
import type { EndgameGroupPresentation } from '../presentation/EndgameGroupPresentation';
import type { Cube2DLayout } from '../presentation/cube/Cube2DLayout';
import {
  CUBE_2D_CAPTURE_FLIGHT_MS,
  CUBE_2D_CAPTURE_STAGGER_MS,
  createCube2DVisualEffectsModel,
  type CapturedStoneEffect,
} from '../presentation/cube/Cube2DVisualEffectsModel';
import {
  CUBE_2D_BASE_CELL_SIZE,
  CUBE_2D_STAGE_HEIGHT,
  CUBE_2D_STAGE_WIDTH,
  CUBE_2D_SVG_SIZE,
  createCube2DRenderModel,
  cube2DContentScale,
} from '../renderer2d/Cube2DRenderer';
import { StoneArtworkDefs, stoneArtworkFill } from '../renderer2d/StoneArtwork';

export { CUBE_2D_CAPTURE_FLIGHT_MS, CUBE_2D_CAPTURE_STAGGER_MS };

interface Cube2DVisualEffectsProps {
  readonly layout: Cube2DLayout;
  readonly layoutCellSize?: number;
  readonly finalScore: FinalScore | null;
  readonly provisionalTerritory?: ReadonlyMap<PointId, 'black' | 'white'>;
  readonly finalClassification?: EndgameClassification | null;
  readonly endgameGroups?: readonly EndgameGroupPresentation[];
  readonly decisions?: Readonly<Partial<Record<string, GroupStatus>>>;
  readonly selectedGroupId?: string | null;
  readonly hoveredGroupId?: string | null;
  readonly capturedStones?: readonly CapturedStoneEffect[];
}

type EffectsStyle = CSSProperties & {
  '--cube-2d-cell-size'?: string;
};

type BoardPoint = ReturnType<typeof createCube2DRenderModel>['boards'][number]['points'][number];

const pointMap = <T extends { readonly pointId: PointId }>(points: readonly T[]) =>
  new Map(points.map((point) => [point.pointId, point]));

const contourColor = (
  status: GroupStatus | null,
  stoneColor: 'black' | 'white',
): string => {
  if (status === 'dead') return '#e52b2b';
  if (status === 'seki') return '#80878f';
  if (status === 'alive') return stoneColor === 'black' ? '#111111' : '#ffffff';
  return '#a8e85e';
};

const groupShape = (
  group: EndgameGroupPresentation,
  pointsById: ReadonlyMap<PointId, BoardPoint>,
  contentScale: number,
  radius: number,
): ReactNode => {
  const center = CUBE_2D_SVG_SIZE / 2;
  const display = (point: BoardPoint) => ({
    x: center + (point.x - center) * contentScale,
    y: center + (point.y - center) * contentScale,
  });
  const visible = group.points.flatMap((pointId) => {
    const point = pointsById.get(pointId);
    return point ? [[pointId, point] as const] : [];
  });

  return (
    <>
      {group.edges.map((edge) => {
        const from = pointsById.get(edge.from);
        const to = pointsById.get(edge.to);
        if (!from || !to) return null;
        const a = display(from);
        const b = display(to);
        return (
          <line
            key={`edge:${edge.from}:${edge.to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="currentColor"
            strokeWidth={radius * 2}
            strokeLinecap="round"
          />
        );
      })}
      {visible.map(([pointId, point]) => {
        const position = display(point);
        return (
          <circle
            key={`point:${pointId}`}
            cx={position.x}
            cy={position.y}
            r={radius}
            fill="currentColor"
          />
        );
      })}
    </>
  );
};

export function Cube2DVisualEffects({
  layout,
  layoutCellSize = CUBE_2D_BASE_CELL_SIZE,
  finalScore,
  provisionalTerritory = new Map(),
  finalClassification = null,
  endgameGroups = [],
  decisions = {},
  selectedGroupId = null,
  hoveredGroupId = null,
  capturedStones = [],
}: Cube2DVisualEffectsProps) {
  const renderModel = createCube2DRenderModel(layout);
  const effects = createCube2DVisualEffectsModel({
    finalScore,
    provisionalTerritory,
    finalClassification,
    endgameGroups,
    decisions,
    selectedGroupId,
    hoveredGroupId,
    capturedStones,
  });
  const size = renderModel.size;
  const step = CUBE_2D_SVG_SIZE / size;
  const contentScale = cube2DContentScale(size);
  const stoneRadius = step * 0.39 * contentScale;
  const contourRadius = stoneRadius * 1.12;
  const territoryRadius = Math.max(1.25, step * 0.115 * contentScale);
  const effectsStyle: EffectsStyle = { '--cube-2d-cell-size': `${layoutCellSize}px` };
  const captureArtworkPrefix = 'cube-2d-capture-artwork';

  return (
    <div
      className="cube-2d-effects"
      style={effectsStyle}
      aria-hidden="true"
      data-capture-count={capturedStones.length}
      data-layout-cell-size={layoutCellSize.toFixed(3)}
    >
      {renderModel.boards.map((board) => {
        const pointsById = pointMap(board.points);
        return (
          <svg
            key={board.face}
            className="cube-2d-effects__board"
            viewBox={`0 0 ${CUBE_2D_SVG_SIZE} ${CUBE_2D_SVG_SIZE}`}
            style={{ gridRow: board.row + 1, gridColumn: board.column + 1 }}
            data-face={board.face}
          >
            <g className="cube-2d-effects__territory">
              {board.points.map((point) => {
                const owner = effects.territory.get(point.pointId);
                if (!owner) return null;
                const center = CUBE_2D_SVG_SIZE / 2;
                const displayX = center + (point.x - center) * contentScale;
                const displayY = center + (point.y - center) * contentScale;
                return (
                  <circle
                    key={`territory:${point.pointId}`}
                    className={`cube-2d-territory-dot cube-2d-territory-dot--${owner}`}
                    cx={displayX}
                    cy={displayY}
                    r={territoryRadius}
                    fill={owner === 'black' ? '#111111' : '#ffffff'}
                    stroke={owner === 'white' ? 'rgb(40 40 40 / 36%)' : 'none'}
                    strokeWidth={owner === 'white' ? 0.55 : 0}
                    data-logical-point-id={point.pointId}
                    data-territory={owner}
                  />
                );
              })}
            </g>

            <g className="cube-2d-effects__groups">
              {endgameGroups.map((group, groupIndex) => {
                if (!group.points.some((pointId) => pointsById.has(pointId))) return null;
                const status = decisions[group.id] ?? null;
                const selected = selectedGroupId === group.id;
                const hovered = hoveredGroupId === group.id;
                const color = contourColor(status, group.color);
                const filterId = `cube-endgame-outline-${board.face}-${groupIndex}`;
                const outlineRadius = selected ? 1.7 : hovered ? 1.45 : 1.2;
                const shape = groupShape(group, pointsById, contentScale, contourRadius);
                return (
                  <g
                    key={`group:${group.id}`}
                    className={`cube-2d-group-contour cube-2d-group-contour--${status ?? 'unresolved'}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`}
                    data-endgame-group-id={group.id}
                    data-group-status={status ?? 'unresolved'}
                    pointerEvents="none"
                  >
                    <defs>
                      <filter
                        id={filterId}
                        x="-30%"
                        y="-30%"
                        width="160%"
                        height="160%"
                        colorInterpolationFilters="sRGB"
                      >
                        <feMorphology in="SourceAlpha" operator="dilate" radius={outlineRadius} result="dilated" />
                        <feComposite in="dilated" in2="SourceAlpha" operator="out" result="outline" />
                        <feFlood floodColor={color} result="outline-color" />
                        <feComposite in="outline-color" in2="outline" operator="in" />
                      </filter>
                    </defs>
                    {status === 'seki' ? (
                      <g className="cube-2d-seki-mask" style={{ color: '#80878f' }} opacity={0.6}>
                        {shape}
                      </g>
                    ) : null}
                    <g
                      className="cube-2d-group-contour__outline-source"
                      style={{ color: '#ffffff' }}
                      filter={`url(#${filterId})`}
                    >
                      {shape}
                    </g>
                  </g>
                );
              })}
            </g>
          </svg>
        );
      })}

      {effects.capturedStones.length > 0 ? (
        <svg
          className="cube-2d-effects__capture-stage"
          viewBox={`0 0 ${CUBE_2D_STAGE_WIDTH} ${CUBE_2D_STAGE_HEIGHT}`}
          preserveAspectRatio="none"
          data-capture-coordinate-space="stage-4x3"
        >
          <StoneArtworkDefs idPrefix={captureArtworkPrefix} />
          <g className="cube-2d-effects__captures">
            {effects.capturedStones.map((effect) => {
              const dx = effect.targetStageX - effect.stageX;
              const dy = effect.targetStageY - effect.stageY;
              return (
                <circle
                  key={effect.id}
                  className={`cube-2d-captured-stone cube-2d-captured-stone--${effect.color}`}
                  cx={effect.stageX}
                  cy={effect.stageY}
                  r={effect.radius}
                  fill={stoneArtworkFill(captureArtworkPrefix, effect.color)}
                  stroke="none"
                  data-stone-artwork="custom-svg"
                  data-logical-point-id={effect.pointId}
                  data-captured-color={effect.color}
                  data-capture-direction={effect.color === 'white' ? 'left' : 'right'}
                  data-capture-order={effect.order}
                  data-capture-delay-ms={effect.delayMs}
                  data-source-face={effect.face}
                  data-source-layout-row={effect.layoutRow}
                  data-source-layout-column={effect.layoutColumn}
                  data-source-local-x={effect.localX}
                  data-source-local-y={effect.localY}
                  data-source-stage-x={effect.stageX}
                  data-source-stage-y={effect.stageY}
                  data-target-stage-x={effect.targetStageX}
                  data-target-stage-y={effect.targetStageY}
                >
                  <animateTransform
                    attributeName="transform"
                    type="translate"
                    from="0 0"
                    to={`${dx} ${dy}`}
                    begin={`${effect.delayMs}ms`}
                    dur={`${effect.durationMs}ms`}
                    calcMode="spline"
                    keyTimes="0;1"
                    keySplines="0.22 0.65 0.3 1"
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    values="1;1;0"
                    keyTimes="0;0.78;1"
                    begin={`${effect.delayMs}ms`}
                    dur={`${effect.durationMs}ms`}
                    fill="freeze"
                  />
                </circle>
              );
            })}
          </g>
        </svg>
      ) : null}
    </div>
  );
}
