import type { CSSProperties } from 'react';
import type { EndgameClassification } from '../core/endgame/EndgameClassifier';
import type { FinalScore } from '../core/scoring/Scoring';
import type { PointId } from '../core/topology/Topology';
import {
  ENDGAME_GROUP_HOVER_COLOR,
  ENDGAME_GROUP_HOVER_TRANSITION_MS,
  ENDGAME_TERRITORY_MARKER_RADIUS_FRACTION,
  ENDGAME_TERRITORY_MARKER_STYLES,
  type EndgamePresentationModel,
  type EndgamePresentationShape,
} from '../presentation/EndgamePresentation';
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
import {
  buildEndgameContourPath,
  endgameContourStrokeWidth,
} from '../renderer2d/EndgameContourGeometry';
import { StoneArtworkDefs, stoneArtworkFill } from '../renderer2d/StoneArtwork';

export { CUBE_2D_CAPTURE_FLIGHT_MS, CUBE_2D_CAPTURE_STAGGER_MS };

interface Cube2DVisualEffectsProps {
  readonly layout: Cube2DLayout;
  readonly layoutCellSize?: number;
  readonly finalScore: FinalScore | null;
  readonly finalClassification?: EndgameClassification | null;
  readonly endgamePresentation?: EndgamePresentationModel | null;
  readonly capturedStones?: readonly CapturedStoneEffect[];
  readonly onEndgamePointHover?: (pointId: PointId | null) => void;
  readonly onEndgamePointActivate?: (pointId: PointId) => void;
}

type EffectsStyle = CSSProperties & {
  '--cube-2d-cell-size'?: string;
};

type BoardPoint = ReturnType<typeof createCube2DRenderModel>['boards'][number]['points'][number];

const contourPathForBoard = (
  shape: EndgamePresentationShape,
  boardPoints: readonly BoardPoint[],
  step: number,
  contentScale: number,
): string => {
  const pointIds = new Set(shape.points);
  const cells = boardPoints.flatMap((point) =>
    pointIds.has(point.pointId) ? [{ column: point.column, row: point.row }] : [],
  );
  if (cells.length === 0) return '';

  const center = CUBE_2D_SVG_SIZE / 2;
  const spacing = step * contentScale;
  const origin = center + (step * 0.5 - center) * contentScale;
  return buildEndgameContourPath(cells, {
    originX: origin,
    originY: origin,
    spacing,
  });
};

export function Cube2DVisualEffects({
  layout,
  layoutCellSize = CUBE_2D_BASE_CELL_SIZE,
  finalScore,
  finalClassification = null,
  endgamePresentation = null,
  capturedStones = [],
  onEndgamePointHover,
  onEndgamePointActivate,
}: Cube2DVisualEffectsProps) {
  const renderModel = createCube2DRenderModel(layout);
  const effects = createCube2DVisualEffectsModel({
    finalScore,
    provisionalTerritory: endgamePresentation?.territory,
    finalClassification,
    capturedStones,
  });
  const size = renderModel.size;
  const step = CUBE_2D_SVG_SIZE / size;
  const contentScale = cube2DContentScale(size);
  const contourSpacing = step * contentScale;
  const stoneRadius = step * 0.39 * contentScale;
  const contourWidth = endgameContourStrokeWidth(contourSpacing, stoneRadius);
  const territoryRadius = Math.max(
    1.25,
    step * ENDGAME_TERRITORY_MARKER_RADIUS_FRACTION * contentScale,
  );
  const effectsStyle: EffectsStyle = { '--cube-2d-cell-size': `${layoutCellSize}px` };
  const captureArtworkPrefix = 'cube-2d-capture-artwork';
  const interactiveEndgame = Boolean(
    endgamePresentation && onEndgamePointHover && onEndgamePointActivate,
  );

  return (
    <div
      className="cube-2d-effects"
      style={effectsStyle}
      aria-hidden={interactiveEndgame ? undefined : true}
      data-capture-count={capturedStones.length}
      data-layout-cell-size={layoutCellSize.toFixed(3)}
    >
      {renderModel.boards.map((board) => (
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
              const markerStyle = ENDGAME_TERRITORY_MARKER_STYLES[owner];
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
                  fill={markerStyle.fill}
                  stroke={markerStyle.stroke ?? 'none'}
                  strokeWidth={markerStyle.stroke ? 0.55 : 0}
                  data-logical-point-id={point.pointId}
                  data-territory={owner}
                />
              );
            })}
          </g>

          <g className="cube-2d-effects__groups">
            {endgamePresentation?.contours.map((contour) => {
              const path = contourPathForBoard(contour, board.points, step, contentScale);
              if (!path) return null;
              return (
                <g
                  key={`bundle:${contour.status}:${contour.color}`}
                  className={`cube-2d-group-contour cube-2d-group-contour--${contour.status}${contour.selected ? ' is-selected' : ''}`}
                  data-endgame-group-ids={contour.groupIds.join(' ')}
                  data-group-status={contour.status}
                  data-group-color={contour.color}
                  pointerEvents="none"
                >
                  <path
                    className="cube-2d-group-contour__outline-source"
                    d={path}
                    fill="none"
                    stroke={contour.contourColor}
                    strokeWidth={contourWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

            {endgamePresentation?.sekiRegions.map((region) => {
              const path = contourPathForBoard(region, board.points, step, contentScale);
              if (!path) return null;
              return (
                <g
                  key={`seki-region:${region.id}`}
                  className={`cube-2d-group-contour cube-2d-group-contour--seki${region.selected ? ' is-selected' : ''}`}
                  data-endgame-seki-region-id={region.id}
                  data-endgame-group-ids={region.groupIds.join(' ')}
                  data-group-status="seki"
                  pointerEvents="none"
                >
                  <path
                    className="cube-2d-seki-mask"
                    d={path}
                    fill={region.maskColor}
                    fillRule="evenodd"
                    opacity={region.maskOpacity}
                  />
                  <path
                    className="cube-2d-group-contour__outline-source"
                    d={path}
                    fill="none"
                    stroke={region.contourColor}
                    strokeWidth={contourWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

            {endgamePresentation?.groups.map((group) => {
              const path = contourPathForBoard(group, board.points, step, contentScale);
              const representativePoint = group.points[0];
              if (!path || !representativePoint) return null;
              return (
                <g
                  key={`interaction:${group.id}`}
                  className="cube-2d-group-interaction"
                  data-endgame-group-id={group.id}
                  data-group-status={group.status}
                  onPointerEnter={
                    interactiveEndgame
                      ? () => onEndgamePointHover?.(representativePoint)
                      : undefined
                  }
                  onPointerLeave={
                    interactiveEndgame ? () => onEndgamePointHover?.(null) : undefined
                  }
                  onClick={
                    interactiveEndgame
                      ? () => onEndgamePointActivate?.(representativePoint)
                      : undefined
                  }
                >
                  <path
                    className="cube-2d-group-contour__hover-outline"
                    d={path}
                    fill="none"
                    stroke={ENDGAME_GROUP_HOVER_COLOR}
                    strokeOpacity={group.hovered ? 1 : 0}
                    strokeWidth={contourWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pointerEvents="none"
                    style={{
                      transition: `stroke-opacity ${ENDGAME_GROUP_HOVER_TRANSITION_MS}ms ease-out`,
                    }}
                  />
                  {interactiveEndgame ? (
                    <path
                      className="cube-2d-group-contour__hit-area"
                      d={path}
                      fill="transparent"
                      fillRule="evenodd"
                      stroke="none"
                      pointerEvents="fill"
                      style={{ cursor: 'pointer' }}
                      data-endgame-hit-group-id={group.id}
                    />
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      ))}

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
