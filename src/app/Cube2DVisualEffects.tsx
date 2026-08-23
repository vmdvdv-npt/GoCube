import type { CSSProperties, ReactNode } from 'react';
import type { EndgameClassification, GroupStatus } from '../core/endgame/EndgameClassifier';
import type { FinalScore } from '../core/scoring/Scoring';
import { CubeTopology } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type {
  EndgameGroupPresentation,
  EndgameGroupRenderState,
  EndgameVisualStatus,
} from '../presentation/EndgameGroupPresentation';
import { buildEndgameSekiRegions } from '../presentation/EndgameSekiPresentation';
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
type GroupShape = Pick<EndgameGroupPresentation, 'points' | 'edges'>;
type DisplayPoint = Readonly<{ x: number; y: number }>;

const pointMap = <T extends { readonly pointId: PointId }>(points: readonly T[]) =>
  new Map(points.map((point) => [point.pointId, point]));

const contourColor = (status: EndgameVisualStatus | null): string => {
  if (status === 'dead') return '#e52b2b';
  if (status === 'seki') return '#80878f';
  if (status === 'alive') return 'transparent';
  return '#a8e85e';
};

const contourPaintPriority = (status: EndgameVisualStatus | null): number => {
  if (status === 'dead') return 0;
  if (status === 'alive') return 1;
  return 2;
};

const groupShape = (
  group: GroupShape,
  pointsById: ReadonlyMap<PointId, BoardPoint>,
  contentScale: number,
  radius: number,
): ReactNode => {
  const center = CUBE_2D_SVG_SIZE / 2;
  const display = (point: BoardPoint): DisplayPoint => ({
    x: center + (point.x - center) * contentScale,
    y: center + (point.y - center) * contentScale,
  });
  const visible = group.points.flatMap((pointId) => {
    const point = pointsById.get(pointId);
    return point ? [[pointId, point] as const] : [];
  });
  const displayedById = new Map<PointId, DisplayPoint>(
    visible.map(([pointId, point]) => [pointId, display(point)]),
  );
  const visibleEdges = group.edges.flatMap((edge) => {
    const from = displayedById.get(edge.from);
    const to = displayedById.get(edge.to);
    if (!from || !to) return [];
    return [[edge, from, to] as const];
  });

  return (
    <>
      {visibleEdges.map(([edge, from, to]) => (
        <line
          key={`edge:${edge.from}:${edge.to}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="currentColor"
          strokeWidth={radius * 2}
          strokeLinecap="round"
        />
      ))}
      {/*
        Round-ended edge capsules plus the stone circles form one smooth union.
        Extra corner patches make the subtraction outline locally thicker and can
        create the doubled inner bands visible at bends.
      */}
      {visible.map(([pointId]) => {
        const position = displayedById.get(pointId);
        if (!position) return null;
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

const groupOutline = (
  group: GroupShape,
  pointsById: ReadonlyMap<PointId, BoardPoint>,
  contentScale: number,
  innerRadius: number,
  outlineWidth: number,
  color: string,
  maskId: string,
): ReactNode => (
  <>
    <defs>
      <mask
        id={maskId}
        maskUnits="userSpaceOnUse"
        x={0}
        y={0}
        width={CUBE_2D_SVG_SIZE}
        height={CUBE_2D_SVG_SIZE}
      >
        <rect
          x={0}
          y={0}
          width={CUBE_2D_SVG_SIZE}
          height={CUBE_2D_SVG_SIZE}
          fill="#ffffff"
        />
        <g style={{ color: '#000000' }}>
          {groupShape(group, pointsById, contentScale, innerRadius)}
        </g>
      </mask>
    </defs>
    <g
      className="cube-2d-group-contour__outline-source"
      style={{ color }}
      mask={`url(#${maskId})`}
    >
      {groupShape(group, pointsById, contentScale, innerRadius + outlineWidth)}
    </g>
  </>
);

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
  const groupStates: readonly EndgameGroupRenderState[] = Object.freeze(
    endgameGroups.map((group) => {
      const firstPointId = group.points[0];
      const status = firstPointId
        ? effects.pointStatuses.get(firstPointId)?.groupStatus ?? null
        : null;
      return Object.freeze({ ...group, status });
    }),
  );
  const sekiRegions = buildEndgameSekiRegions(groupStates, new CubeTopology(renderModel.size));
  const sekiGroupIds = new Set(sekiRegions.flatMap((region) => region.groupIds));
  const regularGroups = groupStates
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => !sekiGroupIds.has(group.id))
    .sort(
      (left, right) =>
        contourPaintPriority(left.group.status) - contourPaintPriority(right.group.status) ||
        left.index - right.index,
    );
  const size = renderModel.size;
  const step = CUBE_2D_SVG_SIZE / size;
  const contentScale = cube2DContentScale(size);
  const stoneRadius = step * 0.39 * contentScale;
  const contourRadius = stoneRadius;
  const contourWidth = 1.2;
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
              {/*
                Dead contours are intentionally painted first. If a red outline
                coincides with unresolved or seki geometry, the non-red contour is
                the single visible shared stroke and the red contour continues as a branch.
              */}
              {regularGroups.map(({ group, index: groupIndex }) => {
                if (!group.points.some((pointId) => pointsById.has(pointId))) return null;
                const status = group.status;
                const selected = selectedGroupId === group.id;
                const hovered = hoveredGroupId === group.id;
                const color = contourColor(status);
                const maskId = `cube-endgame-outline-mask-${board.face}-${groupIndex}`;
                return (
                  <g
                    key={`group:${group.id}`}
                    className={`cube-2d-group-contour cube-2d-group-contour--${status ?? 'unresolved'}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`}
                    data-endgame-group-id={group.id}
                    data-group-status={status ?? 'unresolved'}
                    pointerEvents="none"
                  >
                    {groupOutline(
                      group,
                      pointsById,
                      contentScale,
                      contourRadius,
                      contourWidth,
                      color,
                      maskId,
                    )}
                  </g>
                );
              })}

              {sekiRegions.map((region, regionIndex) => {
                if (!region.points.some((pointId) => pointsById.has(pointId))) return null;
                const selected = selectedGroupId !== null && region.groupIds.includes(selectedGroupId);
                const hovered = hoveredGroupId !== null && region.groupIds.includes(hoveredGroupId);
                const maskId = `cube-endgame-seki-outline-mask-${board.face}-${regionIndex}`;
                const shape = groupShape(region, pointsById, contentScale, contourRadius);
                return (
                  <g
                    key={`seki-region:${region.id}`}
                    className={`cube-2d-group-contour cube-2d-group-contour--seki${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`}
                    data-endgame-seki-region-id={region.id}
                    data-endgame-group-ids={region.groupIds.join(' ')}
                    data-group-status="seki"
                    pointerEvents="none"
                  >
                    <g className="cube-2d-seki-mask" style={{ color: '#80878f' }} opacity={0.6}>
                      {shape}
                    </g>
                    {groupOutline(
                      region,
                      pointsById,
                      contentScale,
                      contourRadius,
                      contourWidth,
                      '#80878f',
                      maskId,
                    )}
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
