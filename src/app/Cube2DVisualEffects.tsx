import type { CSSProperties, ReactElement } from 'react';
import type { EndgameClassification, GroupStatus } from '../core/endgame/EndgameClassifier';
import type { FinalScore } from '../core/scoring/Scoring';
import type { PointId } from '../core/topology/Topology';
import type { EndgameGroupPresentation } from '../presentation/EndgameGroupPresentation';
import type { Cube2DLayout } from '../presentation/cube/Cube2DLayout';
import {
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

export const CUBE_2D_CAPTURE_STAGGER_MS = 150;
export const CUBE_2D_CAPTURE_FLIGHT_MS = 520;

interface Cube2DVisualEffectsProps {
  readonly layout: Cube2DLayout;
  readonly layoutCellSize?: number;
  readonly finalScore: FinalScore | null;
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

const pointMap = <T extends { readonly pointId: PointId }>(points: readonly T[]) =>
  new Map(points.map((point) => [point.pointId, point]));

export function Cube2DVisualEffects({
  layout,
  layoutCellSize = CUBE_2D_BASE_CELL_SIZE,
  finalScore,
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
  const annotationRadius = stoneRadius * 1.12;
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
                return (
                  <rect
                    key={`territory:${point.pointId}`}
                    className={`cube-2d-territory cube-2d-territory--${owner}`}
                    x={point.column * step}
                    y={point.row * step}
                    width={step}
                    height={step}
                    data-logical-point-id={point.pointId}
                    data-territory={owner}
                  />
                );
              })}
            </g>

            <g className="cube-2d-effects__groups">
              {board.points.map((point) => {
                const status = effects.pointStatuses.get(point.pointId);
                if (!status) return null;
                const displayX = CUBE_2D_SVG_SIZE / 2 + (point.x - CUBE_2D_SVG_SIZE / 2) * contentScale;
                const displayY = CUBE_2D_SVG_SIZE / 2 + (point.y - CUBE_2D_SVG_SIZE / 2) * contentScale;
                const classes = [
                  'cube-2d-group-annotation',
                  status.groupStatus ? `cube-2d-group-annotation--${status.groupStatus}` : '',
                  status.selected ? 'cube-2d-group-annotation--selected' : '',
                  status.hovered ? 'cube-2d-group-annotation--hovered' : '',
                ].filter(Boolean).join(' ');
                return (
                  <g key={`group:${point.pointId}`} data-logical-point-id={point.pointId} data-group-status={status.groupStatus ?? 'unclassified'}>
                    {status.groupStatus === 'dead' ? (
                      <circle
                        className="cube-2d-dead-stone-mask"
                        cx={displayX}
                        cy={displayY}
                        r={stoneRadius * 1.02}
                      />
                    ) : null}
                    {status.groupStatus === 'seki' || status.selected || status.hovered ? (
                      <circle
                        className={classes}
                        cx={displayX}
                        cy={displayY}
                        r={annotationRadius}
                      />
                    ) : null}
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
              const delayMs = effect.order * CUBE_2D_CAPTURE_STAGGER_MS;
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
                  data-capture-delay-ms={delayMs}
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
                    begin={`${delayMs}ms`}
                    dur={`${CUBE_2D_CAPTURE_FLIGHT_MS}ms`}
                    calcMode="spline"
                    keyTimes="0;1"
                    keySplines="0.22 0.65 0.3 1"
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    values="1;1;0"
                    keyTimes="0;0.78;1"
                    begin={`${delayMs}ms`}
                    dur={`${CUBE_2D_CAPTURE_FLIGHT_MS}ms`}
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
