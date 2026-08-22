import {
  useEffect,
  type CSSProperties,
  type WheelEvent,
} from 'react';
import { CUBE_2D_LAYOUT_COLUMNS, CUBE_2D_LAYOUT_ROWS } from '../presentation/cube/Cube2DLayout';
import {
  CUBE_2D_BASE_CELL_SIZE,
  CUBE_2D_TRANSITION_MS,
  Cube2DRenderer,
} from '../renderer2d/Cube2DRenderer';
import { Cube2DGameController } from './Cube2DGameController';
import { Cube2DVisualEffects } from './Cube2DVisualEffects';
import { GameResultDialog } from './GameResultDialog';
import { GameSidebar } from './GameSidebar';
import { CUBE_ENDGAME_STATUSES, cubeEndgameStatusLabel, useCube2DGame } from './useCube2DGame';
import { useDragPan } from './useDragPan';
import './manual-endgame.css';
import './cube2d-preview.css';
import './cube2d-game-flow.css';
import './cube2d-game.css';

const CUBE_2D_NAVIGATION_GAP = 30;
const CUBE_2D_NAVIGATION_BUTTON_SIZE = 38;
const CUBE_2D_NAVIGATION_INSET = CUBE_2D_NAVIGATION_GAP + CUBE_2D_NAVIGATION_BUTTON_SIZE;

type Cube2DNavigationArrowStyle = CSSProperties & {
  '--cube-2d-navigation-from-x'?: string;
};

export interface Cube2DGameProps {
  readonly controller: Cube2DGameController;
  readonly onRequestNewGame: () => void;
}

export function Cube2DGame({ controller, onRequestNewGame }: Cube2DGameProps) {
  const g = useCube2DGame(controller);
  const layoutCellSize = CUBE_2D_BASE_CELL_SIZE * g.zoom;
  const stageWidth = layoutCellSize * CUBE_2D_LAYOUT_COLUMNS;
  const stageHeight = layoutCellSize * CUBE_2D_LAYOUT_ROWS;
  const navigationWidth = stageWidth + CUBE_2D_NAVIGATION_INSET * 2;
  const navigationHeight = stageHeight + CUBE_2D_NAVIGATION_INSET * 2;
  const sideRowCenterY = CUBE_2D_NAVIGATION_INSET + layoutCellSize * 1.5;
  const verticalPairCenterX =
    CUBE_2D_NAVIGATION_INSET + layoutCellSize * (g.view.verticalAnchorColumn + 0.5);
  const navigationDisabled = Boolean(g.transition) || g.captureAnimating;
  const verticalPairIsMoving = g.transition?.direction === 'anchor';
  const verticalArrowMotionStyle: Cube2DNavigationArrowStyle = verticalPairIsMoving
    ? {
        '--cube-2d-navigation-from-x': `${
          (g.transition.fromLayout.verticalAnchorColumn - g.view.verticalAnchorColumn) * layoutCellSize
        }px`,
        animationDuration: `${CUBE_2D_TRANSITION_MS}ms`,
      }
    : {};

  const dragPan = useDragPan({
    startOnPointerDown: true,
    onDragStart: () => g.hover(null),
  });

  useEffect(() => {
    dragPan.reset();
  }, [controller, dragPan.reset]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    g.setZoom(g.zoom - event.deltaY * 0.0008);
  };

  const endgamePanel =
    g.vm.phase === 'endgame' ? (
      <section className="endgame-panel" aria-labelledby="cube-endgame-title">
        <div>
          <h2 id="cube-endgame-title">Manual endgame classification</h2>
          <p>Select a stone group on the Cube surface, then choose Alive, Dead, or Seki.</p>
        </div>
        {g.groups.length ? (
          <>
            <div className="endgame-progress" aria-live="polite">
              Classified {g.classified} of {g.groups.length}
            </div>
            {g.selected ? (
              <div className="endgame-selection">
                <div className="endgame-selection__identity">
                  <span className={`stone-chip stone-chip--${g.selected.color}`} aria-hidden="true" />
                  <div>
                    <strong>Selected group</strong>
                    <span>
                      {g.selected.points.length} {g.selected.points.length === 1 ? 'stone' : 'stones'}
                    </span>
                  </div>
                </div>
                <div className="endgame-statuses" role="group" aria-label="Selected group status">
                  {CUBE_ENDGAME_STATUSES.map((status) => (
                    <button
                      type="button"
                      key={status}
                      className={g.decisions[g.selected!.id] === status ? 'is-selected' : undefined}
                      aria-pressed={g.decisions[g.selected!.id] === status}
                      onClick={() =>
                        g.setDecisions((current) => ({ ...current, [g.selected!.id]: status }))
                      }
                    >
                      {cubeEndgameStatusLabel(status)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="endgame-empty">Select a stone group directly on a Cube face.</p>
            )}
          </>
        ) : (
          <p className="endgame-empty">There are no stone groups to classify.</p>
        )}
        <button
          className="finish-game-button"
          type="button"
          disabled={!g.allClassified || Boolean(g.transition)}
          onClick={() => void g.finish()}
        >
          Calculate final score
        </button>
      </section>
    ) : null;

  return (
    <section className="torus-game cube-2d-game" aria-label="Cube 2D game">
      <GameSidebar
        size={controller.size}
        viewModel={g.vm}
        showMoveNumbers={g.showMoveNumbers}
        onShowMoveNumbersChange={g.setShowMoveNumbers}
        showDuplicateRegions={false}
        duplicateRegionsDisabled
        passDisabled={g.vm.phase !== 'playing' || g.passGuarded || Boolean(g.transition) || g.captureAnimating}
        canRedo={!g.transition && !g.captureAnimating && controller.canRedo()}
        canUndo={!g.transition && !g.captureAnimating && controller.canUndo()}
        onPass={() => void g.pass()}
        onRedo={() => void g.run(() => controller.redo())}
        onUndo={() => void g.run(() => controller.undo())}
        gameResultAvailable={Boolean(g.result && !g.resultOpen)}
        onOpenGameResult={() => g.setResultOpen(true)}
        onRequestNewGame={onRequestNewGame}
        endgame={endgamePanel}
        feedback={g.feedback}
      />

      <div className="cube-2d-game__board-shell" aria-label="Cube 2D view">
        <div
          className="cube-2d-game__viewport"
          data-view-zoom={g.zoom.toFixed(3)}
          data-pan-x={dragPan.offset.x.toFixed(1)}
          data-pan-y={dragPan.offset.y.toFixed(1)}
          data-dragging={dragPan.dragging ? 'true' : 'false'}
          style={{ touchAction: 'none' }}
          onWheel={handleWheel}
          onPointerDown={dragPan.onPointerDown}
          onPointerMove={dragPan.onPointerMove}
          onPointerUp={dragPan.onPointerUp}
          onPointerCancel={dragPan.onPointerCancel}
          onClickCapture={dragPan.onClickCapture}
        >
          <div
            className="cube-2d-game__navigation-layer"
            data-navigation-gap={CUBE_2D_NAVIGATION_GAP}
            data-vertical-anchor-column={g.view.verticalAnchorColumn}
            style={{
              width: `${navigationWidth}px`,
              height: `${navigationHeight}px`,
              transform: `translate(${dragPan.offset.x}px, ${dragPan.offset.y}px)`,
            }}
          >
            <button
              className={`torus-pan torus-pan--up cube-2d-game__navigation-arrow${
                verticalPairIsMoving ? ' cube-2d-game__navigation-arrow--anchor-moving' : ''
              }`}
              type="button"
              aria-label="Move cube up"
              disabled={navigationDisabled}
              style={{
                ...verticalArrowMotionStyle,
                left: `${verticalPairCenterX - CUBE_2D_NAVIGATION_BUTTON_SIZE / 2}px`,
                top: 0,
              }}
              onClick={() => g.navigate('up')}
            >
              ↑
            </button>
            <button
              className="torus-pan torus-pan--left cube-2d-game__navigation-arrow"
              type="button"
              aria-label="Move cube left"
              disabled={navigationDisabled}
              style={{
                left: 0,
                top: `${sideRowCenterY - CUBE_2D_NAVIGATION_BUTTON_SIZE / 2}px`,
              }}
              onClick={() => g.navigate('left')}
            >
              ←
            </button>

            <div
              className="cube-2d-stage cube-2d-game__stage"
              data-view-zoom={g.zoom.toFixed(3)}
              style={{
                left: `${CUBE_2D_NAVIGATION_INSET}px`,
                top: `${CUBE_2D_NAVIGATION_INSET}px`,
                width: `${stageWidth}px`,
                height: `${stageHeight}px`,
              }}
            >
              <Cube2DRenderer
                layout={g.layout}
                layoutCellSize={layoutCellSize}
                transition={g.transition ?? undefined}
                onVerticalAnchorColumnChange={g.moveAnchor}
                viewModel={g.vm}
                hoveredPointId={g.hoveredPoint}
                hoverStatus={g.hoverStatus}
                showMoveNumbers={g.showMoveNumbers}
                inputDisabled={
                  Boolean(g.transition) ||
                  g.captureAnimating ||
                  g.vm.phase === 'finished' ||
                  dragPan.dragging
                }
                onPointHover={g.hover}
                onPointActivate={(point) => void g.activate(point)}
              />
              <Cube2DVisualEffects
                layout={g.layout}
                layoutCellSize={layoutCellSize}
                captureAnimation={g.captureAnimation}
                endgameGroups={g.groups}
                endgameDecisions={g.decisions}
                selectedGroupId={g.selectedGroupId}
                hoveredGroupId={g.hoveredGroupId}
                territoryPointIds={g.result ? g.controller.territoryPointIds() : undefined}
              />
            </div>

            <button
              className="torus-pan torus-pan--right cube-2d-game__navigation-arrow"
              type="button"
              aria-label="Move cube right"
              disabled={navigationDisabled}
              style={{
                right: 0,
                top: `${sideRowCenterY - CUBE_2D_NAVIGATION_BUTTON_SIZE / 2}px`,
              }}
              onClick={() => g.navigate('right')}
            >
              →
            </button>
            <button
              className={`torus-pan torus-pan--down cube-2d-game__navigation-arrow${
                verticalPairIsMoving ? ' cube-2d-game__navigation-arrow--anchor-moving' : ''
              }`}
              type="button"
              aria-label="Move cube down"
              disabled={navigationDisabled}
              style={{
                ...verticalArrowMotionStyle,
                left: `${verticalPairCenterX - CUBE_2D_NAVIGATION_BUTTON_SIZE / 2}px`,
                bottom: 0,
              }}
              onClick={() => g.navigate('down')}
            >
              ↓
            </button>
          </div>
        </div>
      </div>

      <GameResultDialog
        open={Boolean(g.result && g.resultOpen)}
        result={g.result}
        onClose={() => g.setResultOpen(false)}
        onNewGame={onRequestNewGame}
      />
    </section>
  );
}
