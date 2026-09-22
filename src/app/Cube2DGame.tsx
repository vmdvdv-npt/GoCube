import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { AnimationMode } from '../presentation/AnimationMode';
import { finalBoardViewModel } from '../presentation/EndgameTerritoryPresentation';
import {
  CUBE_2D_LAYOUT_COLUMNS,
  CUBE_2D_LAYOUT_ROWS,
} from '../presentation/cube/Cube2DLayout';
import {
  createCube3DViewState,
  withCube3DOrientationAnchor,
} from '../presentation/cube/Cube3DViewState';
import { orientationAtVerticalAnchor, recenterOrientationFromVerticalAnchor } from '../presentation/cube/Cube2DNavigation';
import type { CubeViewTransitionBridge } from '../renderer3d/CubeViewTransition';
import { CubeOrientation } from '../presentation/cube/CubeOrientation';
import {
  CUBE_2D_BASE_CELL_SIZE,
  CUBE_2D_TRANSITION_MS,
  Cube2DRenderer,
} from '../renderer2d/Cube2DRenderer';
import { Cube2DGameController } from './Cube2DGameController';
import { Cube2DVisualEffects } from './Cube2DVisualEffects';
import { EndgameReviewControls } from './EndgameReviewControls';
import type { GameInteractionBoundary } from './GameInteractionBoundary';
import { GameResultDialog } from './GameResultDialog';
import { GameSidebar } from './GameSidebar';
import { useCube2DGame, type Cube2DExternalAction } from './useCube2DGame';
import { useDragPan, type DragPanOffset } from './useDragPan';
import { useGameControllerLifecycle } from './useGameControllerLifecycle';
import './manual-endgame.css';
import './cube2d-preview.css';
import './cube2d-game-flow.css';
import './cube2d-game.css';
import './cube-view-fold.css';

const LazyCubeViewFold = lazy(async () => {
  const module = await import('./CubeViewFold');
  return { default: module.CubeViewFold };
});

const LazyThreeScene = lazy(async () => {
  const module = await import('../renderer3d/ThreeScene');
  return { default: module.ThreeScene };
});

const CUBE_2D_NAVIGATION_GAP = 30;
const CUBE_2D_NAVIGATION_BUTTON_SIZE = 38;
const CUBE_2D_NAVIGATION_INSET = CUBE_2D_NAVIGATION_GAP + CUBE_2D_NAVIGATION_BUTTON_SIZE;
const CUBE_2D_ZOOM_WHEEL_SENSITIVITY = 0.0008;
const CUBE_2D_HOME_ZOOM = 1;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;

type CubeViewMode = '2d' | '3d';
type Cube2DNavigationArrowStyle = CSSProperties & {
  '--cube-2d-navigation-from-x'?: string;
};

const wheelDeltaPixels = (event: ReactWheelEvent<HTMLDivElement>): number => {
  if (event.deltaMode === WHEEL_DELTA_LINE) return event.deltaY * WHEEL_LINE_HEIGHT_PX;
  if (event.deltaMode === WHEEL_DELTA_PAGE) return event.deltaY * event.currentTarget.clientHeight;
  return event.deltaY;
};

const recenteredPanForZoomOut = (
  currentPan: DragPanOffset,
  currentZoom: number,
  nextZoom: number,
): DragPanOffset => {
  if (currentZoom <= CUBE_2D_HOME_ZOOM || nextZoom <= CUBE_2D_HOME_ZOOM) {
    return Object.freeze({ x: 0, y: 0 });
  }
  const currentDistanceFromHome = currentZoom - CUBE_2D_HOME_ZOOM;
  const nextDistanceFromHome = nextZoom - CUBE_2D_HOME_ZOOM;
  const homeProgress = nextDistanceFromHome / currentDistanceFromHome;
  return Object.freeze({ x: currentPan.x * homeProgress, y: currentPan.y * homeProgress });
};

export interface Cube2DGameProps {
  readonly controller: Cube2DGameController;
  readonly onRequestNewGame: () => void;
  readonly gameplayReadOnly?: boolean;
  readonly newGameDisabled?: boolean;
  readonly animationMode?: AnimationMode;
  readonly externalAction?: Cube2DExternalAction | null;
  readonly interaction?: GameInteractionBoundary;
  readonly turnLabelOverride?: string | null;
  readonly retryBotTurn?: (() => void) | null;
  /** True only when this view is also the explicit owner of an ephemeral controller. */
  readonly ownsController?: boolean;
}

export function Cube2DGame({
  controller,
  onRequestNewGame,
  gameplayReadOnly = false,
  newGameDisabled = false,
  animationMode = 'normal',
  externalAction = null,
  interaction = controller,
  turnLabelOverride = null,
  retryBotTurn = null,
  ownsController = false,
}: Cube2DGameProps) {
  useGameControllerLifecycle(ownsController ? controller : null);
  const foldBridgeRef = useRef<CubeViewTransitionBridge | null>(null);
  const gameRef = useRef<HTMLElement>(null);
  const [foldDirection, setFoldDirection] = useState<CubeViewMode | null>(null);
  const [viewMode, setViewMode] = useState<CubeViewMode>('2d');
  const [cube3DViewState, setCube3DViewState] = useState(() => createCube3DViewState());
  const [cube3DTransitioning, setCube3DTransitioning] = useState(false);

  const g = useCube2DGame(controller, {
    gameplayReadOnly,
    animationMode,
    externalAction,
    interaction,
  });
  const switching = cube3DTransitioning || foldDirection !== null;
  const animateSwitch = animationMode !== 'disabled' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const displayViewModel = finalBoardViewModel(g.vm);
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
        '--cube-2d-navigation-from-x': `${(g.transition.fromLayout.verticalAnchorColumn - g.view.verticalAnchorColumn) * layoutCellSize}px`,
        animationDuration: `${animationMode === 'disabled' ? 0 : CUBE_2D_TRANSITION_MS}ms`,
      }
    : {};

  const dragPan = useDragPan({
    startOnPointerDown: true,
    allowInteractiveDrag: true,
    onDragStart: () => g.hover(null),
  });
  const zoomRef = useRef(g.zoom);
  const panOffsetRef = useRef<DragPanOffset>(dragPan.offset);
  zoomRef.current = g.zoom;
  panOffsetRef.current = dragPan.offset;

  useEffect(() => {
    setViewMode('2d');
    setFoldDirection(null);
    setCube3DViewState(createCube3DViewState());
    setCube3DTransitioning(false);
    zoomRef.current = CUBE_2D_HOME_ZOOM;
    panOffsetRef.current = Object.freeze({ x: 0, y: 0 });
    dragPan.reset();
  }, [controller, dragPan.reset]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const currentZoom = zoomRef.current;
    const currentPan = panOffsetRef.current;
    const nextZoom = g.setZoom(
      currentZoom - wheelDeltaPixels(event) * CUBE_2D_ZOOM_WHEEL_SENSITIVITY,
    );
    if (nextZoom === currentZoom) return;

    let nextPan: DragPanOffset;
    if (nextZoom < currentZoom) {
      nextPan = recenteredPanForZoomOut(currentPan, currentZoom, nextZoom);
    } else {
      const viewportBounds = event.currentTarget.getBoundingClientRect();
      const sceneCenterX = viewportBounds.left + viewportBounds.width / 2 + currentPan.x;
      const sceneCenterY = viewportBounds.top + viewportBounds.height / 2 + currentPan.y;
      const ratio = nextZoom / currentZoom;
      nextPan = Object.freeze({
        x: currentPan.x + (event.clientX - sceneCenterX) * (1 - ratio),
        y: currentPan.y + (event.clientY - sceneCenterY) * (1 - ratio),
      });
    }
    zoomRef.current = nextZoom;
    panOffsetRef.current = nextPan;
    dragPan.setOffset(nextPan);
  };

  const switchTo2D = (): void => {
    if (viewMode === '2d' || switching || navigationDisabled) return;
    g.syncOrientation(recenterOrientationFromVerticalAnchor(
      new CubeOrientation(cube3DViewState.orientationAnchor), g.view.verticalAnchorColumn,
    ));
    if (animateSwitch) setFoldDirection('2d');
    else setViewMode('2d');
  };

  const switchTo3D = (): void => {
    if (viewMode === '3d' || switching || navigationDisabled) return;
    const orientationAnchor = orientationAtVerticalAnchor(g.view.orientation, g.view.verticalAnchorColumn).toState();
    setCube3DViewState((current) => withCube3DOrientationAnchor(current, orientationAnchor));
    g.hover(null);
    if (animateSwitch) setFoldDirection('3d');
    else setViewMode('3d');
  };

  const endgamePanel =
    g.vm.phase === 'endgame' ? (
      <EndgameReviewControls
        titleId="cube-endgame-title"
        reviewReady={g.endgameReviewReady}
        groups={g.groups}
        decisions={g.decisions}
        selectedGroup={g.selected}
        resolvedCount={g.resolvedCount}
        automaticClassified={g.automaticClassified}
        canFinish={g.canFinishEndgame}
        onDecision={g.setDecision}
        onFinish={g.finishEndgame}
      />
    ) : null;

  const viewSwitch = (
    <div className="cube-view-switch" role="group" aria-label="Cube view">
      <button
        type="button"
        aria-pressed={viewMode === '2d'}
        disabled={switching || navigationDisabled}
        onClick={switchTo2D}
      >
        2D
      </button>
      <button
        type="button"
        aria-pressed={viewMode === '3d'}
        disabled={switching || navigationDisabled}
        onClick={switchTo3D}
      >
        3D
      </button>
    </div>
  );

  const cube2dView = (
    <div className="cube-2d-game__board-shell" aria-label="Cube 2D view">
      {viewSwitch}
      <div
        className="cube-2d-game__viewport"
        data-view-zoom={g.zoom.toFixed(3)}
        data-pan-x={dragPan.offset.x.toFixed(1)}
        data-pan-y={dragPan.offset.y.toFixed(1)}
        data-dragging={dragPan.dragging ? 'true' : 'false'}
        style={{ position: 'relative', touchAction: 'none' }}
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
          data-cube2d-anchor={`${g.view.orientation.centerFace}:${g.view.orientation.upFace}`}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: `${navigationWidth}px`,
            height: `${navigationHeight}px`,
            transform: `translate(-50%, -50%) translate(${dragPan.offset.x}px, ${dragPan.offset.y}px)`,
          }}
        >
          <button
            className={`torus-pan torus-pan--up cube-2d-game__navigation-arrow${verticalPairIsMoving ? ' cube-2d-game__navigation-arrow--anchor-moving' : ''}`}
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
              viewModel={displayViewModel}
              hoveredPointId={g.hoveredPoint}
              hoverStatus={g.hoverStatus}
              showMoveNumbers={g.showMoveNumbers}
              inputDisabled={
                switching || Boolean(g.transition) ||
                g.captureAnimating ||
                g.vm.phase === 'finished' ||
                (gameplayReadOnly && g.vm.phase === 'playing') ||
                dragPan.dragging
              }
              onPointHover={g.hover}
              onPointActivate={(point) => void g.activate(point)}
            />
            <Cube2DVisualEffects
              layout={g.layout}
              layoutCellSize={layoutCellSize}
              finalScore={g.vm.finalScore}
              finalClassification={g.finalClassification}
              endgamePresentation={g.vm.phase === 'endgame' ? g.endgamePresentation : null}
              capturedStones={g.capturedEffects}
              onEndgamePointHover={g.vm.phase === 'endgame' ? g.hover : undefined}
              onEndgamePointActivate={
                g.vm.phase === 'endgame' ? (point) => void g.activate(point) : undefined
              }
            />
          </div>

          <button
            className="torus-pan torus-pan--right cube-2d-game__navigation-arrow"
            type="button"
            aria-label="Move cube right"
            disabled={navigationDisabled}
            style={{
              left: `${CUBE_2D_NAVIGATION_INSET + stageWidth + CUBE_2D_NAVIGATION_GAP}px`,
              top: `${sideRowCenterY - CUBE_2D_NAVIGATION_BUTTON_SIZE / 2}px`,
            }}
            onClick={() => g.navigate('right')}
          >
            →
          </button>
          <button
            className={`torus-pan torus-pan--down cube-2d-game__navigation-arrow${verticalPairIsMoving ? ' cube-2d-game__navigation-arrow--anchor-moving' : ''}`}
            type="button"
            aria-label="Move cube down"
            disabled={navigationDisabled}
            style={{
              ...verticalArrowMotionStyle,
              left: `${verticalPairCenterX - CUBE_2D_NAVIGATION_BUTTON_SIZE / 2}px`,
              top: `${CUBE_2D_NAVIGATION_INSET + stageHeight + CUBE_2D_NAVIGATION_GAP}px`,
            }}
            onClick={() => g.navigate('down')}
          >
            ↓
          </button>
        </div>
      </div>
    </div>
  );

  const cube3dView = (
    <div className="cube-2d-game__board-shell cube-3d-board-shell" aria-label="Cube 3D view">
      {viewSwitch}
      <Suspense fallback={<div className="cube-3d-scene cube-3d-scene--loading">Loading 3D…</div>}>
        <LazyThreeScene
          transitionBridgeRef={foldBridgeRef}
          animationMode={animationMode}
          size={controller.size}
          viewModel={displayViewModel}
          endgamePresentation={g.vm.phase === 'endgame' ? g.endgamePresentation : null}
          showMoveNumbers={g.showMoveNumbers}
          viewState={cube3DViewState}
          hoveredPointId={g.hoveredPoint}
          hoverStatus={g.hoverStatus}
          inputDisabled={
            switching ||
            Boolean(g.transition) ||
            g.captureAnimating ||
            g.vm.phase === 'finished' ||
            (gameplayReadOnly && g.vm.phase === 'playing')
          }
          onViewStateChange={setCube3DViewState}
          onViewTransitioningChange={setCube3DTransitioning}
          onPointHover={g.hover}
          onPointActivate={(point) => void g.activate(point)}
        />
      </Suspense>
    </div>
  );

  return (
    <section
      ref={gameRef}
      data-folding={foldDirection !== null}
      className="torus-game cube-2d-game"
      aria-label="Cube game"
      data-animation-mode={animationMode}
      data-cube-view={viewMode}
      data-cube-view-transitioning={switching ? 'true' : 'false'}
    >
      <GameSidebar
        size={controller.size}
        viewModel={g.vm}
        showMoveNumbers={g.showMoveNumbers}
        onShowMoveNumbersChange={g.setShowMoveNumbers}
        showDuplicateRegions={false}
        duplicateRegionsDisabled
        passDisabled={
          switching || gameplayReadOnly ||
          g.vm.phase !== 'playing' ||
          g.passGuarded ||
          Boolean(g.transition) ||
          g.captureAnimating
        }
        canRedo={!switching && !g.transition && !g.captureAnimating && interaction.canRedo()}
        canUndo={!switching && !g.transition && !g.captureAnimating && interaction.canUndo()}
        onPass={() => void g.pass()}
        onRedo={() => void g.run(() => interaction.redo())}
        onUndo={() => void g.run(() => interaction.undo())}
        gameResultAvailable={Boolean(g.result && !g.resultOpen)}
        onOpenGameResult={() => g.setResultOpen(true)}
        onRequestNewGame={onRequestNewGame}
        newGameDisabled={newGameDisabled}
        endgame={endgamePanel ? <div inert={switching}>{endgamePanel}</div> : null}
        feedback={g.feedback}
        finalAnalysisProgressSource={controller.finalAnalysisProgressSource()}
        turnLabelOverride={turnLabelOverride}
        retryBotTurn={retryBotTurn}
      />

      {(viewMode === '2d' || foldDirection) && cube2dView}
      {(viewMode === '3d' || foldDirection) && cube3dView}
      {foldDirection && <Suspense fallback={null}><LazyCubeViewFold transitionBridgeRef={foldBridgeRef} gameRef={gameRef} layout={g.layout} viewState={cube3DViewState} direction={foldDirection} onComplete={() => {
        setViewMode(foldDirection);
        setFoldDirection(null);
      }} /></Suspense>}

      {g.result && g.resultOpen ? (
        <GameResultDialog result={g.result} onClose={() => g.setResultOpen(false)} />
      ) : null}
    </section>
  );
}
