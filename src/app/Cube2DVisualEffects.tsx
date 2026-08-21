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
import { CUBE_2D_SVG_SIZE, createCube2DRenderModel } from '../renderer2d/Cube2DRenderer';

export const CUBE_2D_CAPTURE_STAGGER_MS = 150;
export const CUBE_2D_CAPTURE_FLIGHT_MS = 520;

interface Cube2DVisualEffectsProps {
  readonly layout: Cube2DLayout;
  readonly finalScore: FinalScore | null;
  readonly finalClassification?: EndgameClassification | null;
  readonly endgameGroups?: readonly EndgameGroupPresentation[];
  readonly decisions?: Readonly<Partial<Record<string, GroupStatus>>>;
  readonly selectedGroupId?: string | null;
  readonly hoveredGroupId?: string | null;
  readonly capturedStones?: readonly CapturedStoneEffect[];
}

type CaptureStyle = CSSProperties & {
  '--capture-delay'?: string;
};

const pointMap = <T extends { readonly pointId: PointId }>(points: readonly T[]) =>
  new Map(points.map((point) => [point.pointId, point]));

export function Cube2DVisualEffects({
  layout,
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
  const stoneRadius = step * 0.39;
  const annotationRadius = stoneRadius * 1.12;

  return (
    <div className="cube-2d-effects" aria-hidden="true" data-capture-count={capturedStones.length}>
      {renderModel.boards.map((board) => {
        const pointsById = pointMap(board.points);
        const boardCaptures = capturedStones.filter((effect) => pointsById.has(effect.pointId));
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
                        cx={point.x}
                        cy={point.y}
                        r={stoneRadius * 1.02}
                      />
                    ) : null}
                    {status.groupStatus === 'seki' || status.selected || status.hovered ? (
                      <circle
                        className={classes}
                        cx={point.x}
                        cy={point.y}
                        r={annotationRadius}
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>

            <g className="cube-2d-effects__captures">
              {boardCaptures.map((effect) => {
                const point = pointsById.get(effect.pointId)!;
                const style: CaptureStyle = {
                  '--capture-delay': `${effect.order * CUBE_2D_CAPTURE_STAGGER_MS}ms`,
                };
                return (
                  <circle
                    key={effect.id}
                    className={`cube-2d-captured-stone cube-2d-captured-stone--${effect.color}`}
                    cx={point.x}
                    cy={point.y}
                    r={stoneRadius}
                    style={style}
                    data-logical-point-id={effect.pointId}
                    data-captured-color={effect.color}
                  />
                );
              })}
            </g>
          </svg>
        );
      })}
    </div>
  );
}
