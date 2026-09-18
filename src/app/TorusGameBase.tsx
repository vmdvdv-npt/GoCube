import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { AnimationMode } from '../presentation/AnimationMode';
import { endgameGroupForPoint } from '../presentation/EndgameGroupPresentation';
import { finalBoardViewModel } from '../presentation/EndgameTerritoryPresentation';
import {
  isTorus2DPrimaryBoardClientPosition,
  renderTorus2DEdgeDuplicates,
} from '../renderer2d/Torus2DEdgeDuplicates';
import {
  Torus2DRenderer,
  type Torus2DPanDirection,
  type Torus2DSize,
} from '../renderer2d/Torus2DRenderer';
import { renderTorus2DStoneAnnotations } from '../renderer2d/Torus2DStoneAnnotations';
import { EndgameReviewControls } from './EndgameReviewControls';
import type { GameInteractionBoundary } from './GameInteractionBoundary';
import { GameResultDialog } from './GameResultDialog';
import { GameSidebar } from './GameSidebar';
import {
  TorusGameController,
  type TorusEndgameGroup,
  type TorusGameActionResult,
} from './TorusGameController';
import { useDragPan, type DragPanOffset } from './useDragPan';
import { useEndgameReview } from './useEndgameReview';
import './manual-endgame.css';
import './game-viewport.css';

const TORUS_ZOOM_MIN = 0.7;
const TORUS_ZOOM_MAX = 2.5;
const TORUS_ZOOM_WHEEL_SENSITIVITY = 0.0015;
const TORUS_VIEWBOX_SIZE = 1000;
const PASS_GUARD_DURATION_MS = 1000;
const PASS_GUARD_TICK_MS = 100;
const TORUS_PAN_EDGE_SLACK = 48;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const torusEdgeFitScale = (size: Torus2DSize, duplicatesVisible: boolean): number => {
  if (size === 9) return duplicatesVisible ? 0.95 : 1.09649;
  if (size === 13) return duplicatesVisible ? 1.04 : 1.16099;
  return duplicatesVisible ? 1.11 : 1.20838;
};

const applyTorusVectorCamera = (
  svg: SVGSVGElement,
  size: Torus2DSize,
  duplicatesVisible: boolean,
): void => {
  const cameraScale = torusEdgeFitScale(size, duplicatesVisible);
  const span = TORUS_VIEWBOX_SIZE / cameraScale;
  const origin = (TORUS_VIEWBOX_SIZE - span) / 2;
  svg.setAttribute('viewBox', `${origin} ${origin} ${span} ${span}`);
  svg.setAttribute('data-vector-camera', 'viewBox');
  svg.setAttribute('data-vector-camera-scale', cameraScale.toFixed(6));
};

/**
 * Torus2DRenderer intentionally owns logical 0..1000 scene coordinates. Convert
 * the real pointer through the stable vector-fit viewBox to the synthetic client
 * coordinate expected by the renderer's hit-test API. CSS zoom of the whole
 * board shell is already reflected by getBoundingClientRect().
 */
const rendererClientPosition = (
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): Readonly<{ x: number; y: number }> => {
  const bounds = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    viewBox.width <= 0 ||
    viewBox.height <= 0
  ) {
    return Object.freeze({ x: clientX, y: clientY });
  }

  const sceneX = viewBox.x + ((clientX - bounds.left) / bounds.width) * viewBox.width;
  const sceneY = viewBox.y + ((clientY - bounds.top) / bounds.height) * viewBox.height;
  return Object.freeze({
    x: bounds.left + (sceneX / TORUS_VIEWBOX_SIZE) * bounds.width,
    y: bounds.top + (sceneY / TORUS_VIEWBOX_SIZE) * bounds.height,
  });
};

const rejectionLabel = (reason: TorusGameActionResult['reason']): string | null => {
  if (!reason) return null;

  switch (reason) {
    case 'occupied':
      return 'That point is occupied.';
    case 'suicide':
      return 'That move is not legal.';
    case 'repetition':
      return 'That move repeats a prohibited position.';
    case 'wrong-player':
      return 'It is the other player’s turn.';
    case 'not-playing':
      return 'The game is not accepting moves.';
    case 'nothing-to-undo':
      return 'There is no action to undo.';
    case 'nothing-to-redo':
      return 'There is no action to redo.';
  }
};

export interface TorusExternalAction {
  readonly sequence: number;
  readonly result: TorusGameActionResult;
}

export interface TorusGameProps {
  readonly controller: TorusGameController;
  readonly onRequestNewGame: () => void;
  readonly initialShowDuplicateRegions: boolean;
  readonly onShowDuplicateRegionsPreferenceChange: (visible: boolean) => void;
  readonly gameplayReadOnly?: boolean;
  readonly newGameDisabled?: boolean;
  readonly animationMode?: AnimationMode;
  readonly externalAction?: TorusExternalAction | null;
  readonly interaction?: GameInteractionBoundary;
  readonly turnLabelOverride?: string | null;
  readonly retryBotTurn?: (() => void) | null;
}

export function TorusGame({
  controller,
  onRequestNewGame,
  initialShowDuplicateRegions,
  onShowDuplicateRegionsPreferenceChange,
  gameplayReadOnly = false,
  newGameDisabled = false,
  animationMode = 'normal',
  externalAction = null,
  interaction = controller,
  turnLabelOverride = null,
  retryBotTurn = null,
}: TorusGameProps) {
  const initialViewModel = controller.viewModel();
  const [viewModel, setViewModel] = useState(() => initialViewModel);
  const endgame = useEndgameReview(controller, { onReviewReady: setViewModel });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [resultOpen, setResultOpen] = useState(
    () => initialViewModel.phase === 'finished',
  );
  const [showDuplicateRegions, setShowDuplicateRegions] = useState(
    initialShowDuplicateRegions,
  );
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  const [passGuardUntil, setPassGuardUntil] = useState<number | null>(null);
  const [passGuardRemainingMs, setPassGuardRemainingMs] = useState(0);
  const gameRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<Torus2DRenderer | null>(null);
  const actionInFlight = useRef(false);
  const previewedMovePointRef = useRef<string | null>(null);
  const viewZoomRef = useRef(1);
  const lastExternalActionSequenceRef = useRef<number | null>(null);

  const constrainViewPan = useCallback(
    (candidate: DragPanOffset): DragPanOffset => {
      const shell = shellRef.current;
      if (!shell) return candidate;

      const zoom = viewZoomRef.current;
      const overflowX = (shell.offsetWidth * Math.max(0, zoom - 1)) / 2;
      const overflowY = (shell.offsetHeight * Math.max(0, zoom - 1)) / 2;
      const maxX = overflowX + TORUS_PAN_EDGE_SLACK;
      const maxY = overflowY + TORUS_PAN_EDGE_SLACK;
      return Object.freeze({
        x: clamp(candidate.x, -maxX, maxX),
        y: clamp(candidate.y, -maxY, maxY),
      });
    },
    [],
  );

  const clearPanHover = useCallback((): void => {
    previewedMovePointRef.current = null;
    rendererRef.current?.setMovePreview(null);
    endgame.setHoveredGroupId(null);
  }, [endgame.setHoveredGroupId]);

  const dragPan = useDragPan({
    constrain: constrainViewPan,
    onDragStart: clearPanHover,
    startOnPointerDown: true,
  });
  const panOffsetRef = useRef<DragPanOffset>(dragPan.offset);

  const applyResult = useCallback(
    (result: TorusGameActionResult): void => {
      previewedMovePointRef.current = null;
      rendererRef.current?.setMovePreview(null);
      setViewModel(result.viewModel);
      setFeedback(result.accepted ? null : rejectionLabel(result.reason));
      setResultOpen(
        result.viewModel.phase === 'finished' && Boolean(result.viewModel.finalScore),
      );
      endgame.sync(result.viewModel);

      if (
        result.viewModel.phase !== 'playing' ||
        result.viewModel.consecutivePasses === 0
      ) {
        setPassGuardUntil(null);
      }
    },
    [endgame.sync],
  );

  useEffect(() => {
    panOffsetRef.current = dragPan.offset;
  }, [dragPan.offset]);

  useEffect(() => {
    rendererRef.current = null;
    previewedMovePointRef.current = null;
    viewZoomRef.current = 1;
    panOffsetRef.current = Object.freeze({ x: 0, y: 0 });
    lastExternalActionSequenceRef.current = null;
    dragPan.reset();
    const nextViewModel = controller.viewModel();
    setViewModel(nextViewModel);
    setFeedback(null);
    endgame.sync(nextViewModel);
    setShowMoveNumbers(false);
    setViewZoom(1);
    setPassGuardUntil(null);
    setPassGuardRemainingMs(0);
    setResultOpen(nextViewModel.phase === 'finished');
  }, [controller, dragPan.reset, endgame.sync]);

  useEffect(() => {
    if (
      !externalAction ||
      lastExternalActionSequenceRef.current === externalAction.sequence
    ) {
      return;
    }
    lastExternalActionSequenceRef.current = externalAction.sequence;
    applyResult(externalAction.result);
  }, [applyResult, externalAction]);

  useEffect(() => {
    dragPan.reconstrain();
  }, [viewZoom, dragPan.reconstrain]);

  useEffect(() => {
    if (passGuardUntil === null) {
      setPassGuardRemainingMs(0);
      return;
    }

    const updateRemaining = (): void => {
      const remaining = Math.max(0, passGuardUntil - Date.now());
      setPassGuardRemainingMs(remaining);
      if (remaining === 0) setPassGuardUntil(null);
    };

    updateRemaining();
    const timer = window.setInterval(updateRemaining, PASS_GUARD_TICK_MS);
    return () => window.clearInterval(timer);
  }, [passGuardUntil]);

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;

    const handleWheel = (event: WheelEvent): void => {
      const sidebar = game.querySelector<HTMLElement>('.game-summary');
      const sidebarBounds = sidebar?.getBoundingClientRect();
      if (sidebarBounds && event.clientX <= sidebarBounds.right) return;

      const shell = shellRef.current;
      if (!shell) return;

      event.preventDefault();
      const currentZoom = viewZoomRef.current;
      const nextZoom = clamp(
        currentZoom * Math.exp(-event.deltaY * TORUS_ZOOM_WHEEL_SENSITIVITY),
        TORUS_ZOOM_MIN,
        TORUS_ZOOM_MAX,
      );
      if (nextZoom === currentZoom) return;

      const shellBounds = shell.getBoundingClientRect();
      const renderedPanX = Number(shell.dataset.panX ?? 0);
      const renderedPanY = Number(shell.dataset.panY ?? 0);
      const baseCenterX = shellBounds.left + shellBounds.width / 2 - renderedPanX;
      const baseCenterY = shellBounds.top + shellBounds.height / 2 - renderedPanY;
      const currentPan = panOffsetRef.current;
      const sceneCenterX = baseCenterX + currentPan.x;
      const sceneCenterY = baseCenterY + currentPan.y;
      const ratio = nextZoom / currentZoom;

      viewZoomRef.current = nextZoom;
      setViewZoom(nextZoom);

      const nextPan = constrainViewPan(
        Object.freeze({
          x: currentPan.x + (event.clientX - sceneCenterX) * (1 - ratio),
          y: currentPan.y + (event.clientY - sceneCenterY) * (1 - ratio),
        }),
      );
      panOffsetRef.current = nextPan;
      dragPan.setOffset(nextPan);
    };

    game.addEventListener('wheel', handleWheel, { passive: false });
    return () => game.removeEventListener('wheel', handleWheel);
  }, [constrainViewPan, dragPan.setOffset]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || viewModel.points.length !== controller.size * controller.size) return;

    const renderer = rendererRef.current ?? new Torus2DRenderer(svg, controller.size);
    rendererRef.current = renderer;
    const displayViewModel = finalBoardViewModel(viewModel);

    renderer.setDuplicateRegionsVisible(false);
    renderer.setEndgamePresentation(
      viewModel.phase === 'endgame' ? endgame.presentation : null,
    );
    renderer.render(displayViewModel);
    renderTorus2DEdgeDuplicates(
      svg,
      displayViewModel,
      controller.size,
      renderer.viewState(),
      showDuplicateRegions,
    );
    renderTorus2DStoneAnnotations(svg, viewModel, showMoveNumbers);
  }, [controller, endgame.presentation, showDuplicateRegions, showMoveNumbers, viewModel]);

  useEffect(() => {
    const svg = svgRef.current;
    const view = svg?.ownerDocument.defaultView;
    if (!svg) return;

    const applyCamera = (): void =>
      applyTorusVectorCamera(svg, controller.size, showDuplicateRegions);

    applyCamera();
    const frameId = view?.requestAnimationFrame(applyCamera) ?? null;
    return () => {
      if (frameId !== null) view?.cancelAnimationFrame(frameId);
    };
  }, [controller, showDuplicateRegions]);

  useEffect(() => {
    const svg = svgRef.current;
    const Observer = svg?.ownerDocument.defaultView?.MutationObserver;
    if (!svg || !Observer) return;

    const observer = new Observer(() => {
      const renderer = rendererRef.current;
      if (renderer && svg.getAttribute('data-pan-animating') !== 'true') {
        renderTorus2DEdgeDuplicates(
          svg,
          finalBoardViewModel(viewModel),
          controller.size,
          renderer.viewState(),
          showDuplicateRegions,
        );
      }
      renderTorus2DStoneAnnotations(svg, viewModel, showMoveNumbers);
      applyTorusVectorCamera(svg, controller.size, showDuplicateRegions);
    });
    observer.observe(svg, { childList: true });
    return () => observer.disconnect();
  }, [controller, showDuplicateRegions, showMoveNumbers, viewModel]);

  const groupAtClientPosition = (
    event: ReactMouseEvent<SVGSVGElement>,
  ): TorusEndgameGroup | null => {
    const renderer = rendererRef.current;
    const svg = svgRef.current;
    if (!renderer || !svg) return null;

    const pathPoint = event.nativeEvent
      .composedPath()
      .find(
        (target): target is Element =>
          target instanceof Element && target.hasAttribute('data-logical-point-id'),
      );
    const directPointId =
      pathPoint?.getAttribute('data-logical-point-id') ??
      (event.target as Element | null)
        ?.closest('[data-logical-point-id]')
        ?.getAttribute('data-logical-point-id');
    if (directPointId) {
      const directGroup = endgameGroupForPoint(endgame.groups, directPointId);
      if (directGroup) return directGroup;
    }

    const client = rendererClientPosition(svg, event.clientX, event.clientY);
    if (
      showDuplicateRegions &&
      !isTorus2DPrimaryBoardClientPosition(svg, client.x, client.y)
    ) {
      return null;
    }

    const point = renderer.pointFromClientPosition(client.x, client.y);
    return point ? endgameGroupForPoint(endgame.groups, point) : null;
  };

  const handleBoardClick = async (
    event: ReactMouseEvent<SVGSVGElement>,
  ): Promise<void> => {
    if (actionInFlight.current) return;

    const svg = svgRef.current;
    const client = svg
      ? rendererClientPosition(svg, event.clientX, event.clientY)
      : Object.freeze({ x: event.clientX, y: event.clientY });
    if (
      showDuplicateRegions &&
      svg &&
      !isTorus2DPrimaryBoardClientPosition(svg, client.x, client.y)
    ) {
      previewedMovePointRef.current = null;
      rendererRef.current?.setMovePreview(null);
      return;
    }

    if (viewModel.phase === 'endgame') {
      const group = groupAtClientPosition(event);
      if (group) {
        endgame.setSelectedGroupId(group.id);
        endgame.setHoveredGroupId(group.id);
      }
      return;
    }

    if (gameplayReadOnly || viewModel.phase !== 'playing') return;

    const renderer = rendererRef.current;
    if (!renderer) return;

    const exactHit = renderer.visualPointFromClientPosition(client.x, client.y);
    const logicalPointId =
      previewedMovePointRef.current ?? exactHit?.logicalPointId ?? null;
    if (!logicalPointId) return;

    const availability = controller.moveAvailability(logicalPointId);
    if (!availability.allowed) {
      previewedMovePointRef.current = null;
      renderer.setMovePreview(null);
      return;
    }

    previewedMovePointRef.current = null;
    renderer.setMovePreview(null);
    actionInFlight.current = true;
    try {
      applyResult(await interaction.placeStone(logicalPointId));
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleBoardMouseMove = (event: ReactMouseEvent<SVGSVGElement>): void => {
    const renderer = rendererRef.current;
    if (dragPan.dragging) {
      previewedMovePointRef.current = null;
      renderer?.setMovePreview(null);
      if (endgame.hoveredGroupId !== null) endgame.setHoveredGroupId(null);
      return;
    }

    const svg = svgRef.current;
    const client = svg
      ? rendererClientPosition(svg, event.clientX, event.clientY)
      : Object.freeze({ x: event.clientX, y: event.clientY });

    if (
      showDuplicateRegions &&
      svg &&
      !isTorus2DPrimaryBoardClientPosition(svg, client.x, client.y)
    ) {
      previewedMovePointRef.current = null;
      renderer?.setMovePreview(null);
      if (endgame.hoveredGroupId !== null) endgame.setHoveredGroupId(null);
      return;
    }

    if (viewModel.phase === 'playing') {
      if (endgame.hoveredGroupId !== null) endgame.setHoveredGroupId(null);
      if (gameplayReadOnly || !renderer || actionInFlight.current) {
        previewedMovePointRef.current = null;
        renderer?.setMovePreview(null);
        return;
      }

      const hit = renderer.hoverVisualPointFromClientPosition(client.x, client.y);
      if (!hit) {
        previewedMovePointRef.current = null;
        renderer.setMovePreview(null);
        return;
      }

      const availability = controller.moveAvailability(hit.logicalPointId);
      endgame.setHoveredGroupId(null);
      setHoveredPoint(hit.logicalPointId);
      setHoverStatus(
        availability.allowed
          ? 'allowed'
          : availability.reason === 'occupied'
            ? 'occupied'
            : 'forbidden',
      );
      if (availability.allowed) {
        previewedMovePointRef.current = hit.logicalPointId;
        renderer.setMovePreview({
          kind: 'legal',
          logicalPointId: hit.logicalPointId,
          color: viewModel.currentPlayer,
        });
      } else if (availability.reason === 'occupied') {
        previewedMovePointRef.current = null;
        renderer.setMovePreview(null);
      } else {
        previewedMovePointRef.current = null;
        renderer.setMovePreview({
          kind: 'forbidden',
          logicalPointId: hit.logicalPointId,
          visualColumn: hit.visualColumn,
          visualRow: hit.visualRow,
          pointerX: hit.pointerX,
          pointerY: hit.pointerY,
        });
      }
      return;
    }

    previewedMovePointRef.current = null;
    renderer?.setMovePreview(null);
    if (viewModel.phase !== 'endgame') {
      if (endgame.hoveredGroupId !== null) endgame.setHoveredGroupId(null);
      return;
    }

    const group = groupAtClientPosition(event);
    const nextHoveredGroupId = group?.id ?? null;
    if (nextHoveredGroupId !== endgame.hoveredGroupId) {
      endgame.setHoveredGroupId(nextHoveredGroupId);
    }
  };

  const handleBoardMouseLeave = (): void => {
    previewedMovePointRef.current = null;
    rendererRef.current?.setMovePreview(null);
    if (endgame.hoveredGroupId !== null) endgame.setHoveredGroupId(null);
  };

  const handlePan = (direction: Torus2DPanDirection): void => {
    const renderer = rendererRef.current;
    previewedMovePointRef.current = null;
    renderer?.setMovePreview(null);
    renderer?.pan(direction);
  };

  const handlePass = async (): Promise<void> => {
    if (
      gameplayReadOnly ||
      actionInFlight.current ||
      viewModel.phase !== 'playing' ||
      passGuardRemainingMs > 0
    ) {
      return;
    }

    actionInFlight.current = true;
    try {
      const result = await interaction.pass();
      applyResult(result);
      if (
        result.accepted &&
        result.viewModel.phase === 'playing' &&
        result.viewModel.consecutivePasses === 1
      ) {
        setPassGuardRemainingMs(PASS_GUARD_DURATION_MS);
        setPassGuardUntil(Date.now() + PASS_GUARD_DURATION_MS);
      }
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleUndo = async (): Promise<void> => {
    if (actionInFlight.current) return;

    actionInFlight.current = true;
    try {
      applyResult(await interaction.undo());
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleRedo = async (): Promise<void> => {
    if (actionInFlight.current) return;

    actionInFlight.current = true;
    try {
      applyResult(await interaction.redo());
    } finally {
      actionInFlight.current = false;
    }
  };

  const setGroupStatus = async (
    groupId: string,
    status: GroupStatus,
  ): Promise<void> => {
    if (actionInFlight.current || viewModel.phase !== 'endgame') return;

    actionInFlight.current = true;
    try {
      await endgame.setDecision(groupId, status);
      setViewModel(controller.viewModel());
      setFeedback(null);
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : 'Endgame decision could not be saved.',
      );
      endgame.sync(controller.viewModel());
    } finally {
      actionInFlight.current = false;
    }
  };

  const finishEndgame = async (): Promise<void> => {
    if (actionInFlight.current || !endgame.canFinish) return;
    actionInFlight.current = true;
    try {
      applyResult(await controller.finishEndgame());
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Scoring could not be finished.');
    } finally {
      actionInFlight.current = false;
    }
  };

  const gameResult = viewModel.phase === 'finished' ? controller.resultModel() : null;
  const passGuardActive = passGuardRemainingMs > 0;

  const endgamePanel =
    viewModel.phase === 'endgame' ? (
      <EndgameReviewControls
        titleId="endgame-title"
        reviewReady={endgame.reviewReady}
        groups={endgame.groups}
        decisions={endgame.decisions}
        selectedGroup={endgame.selectedGroup}
        resolvedCount={endgame.resolvedCount}
        automaticClassified={endgame.automaticClassified}
        canFinish={endgame.canFinish}
        onDecision={setGroupStatus}
        onFinish={finishEndgame}
      />
    ) : null;

  const handleShowDuplicateRegionsChange = (visible: boolean): void => {
    setShowDuplicateRegions(visible);
    onShowDuplicateRegionsPreferenceChange(visible);
  };

  const hasVisualTransform =
    viewZoom !== 1 || dragPan.offset.x !== 0 || dragPan.offset.y !== 0;

  return (
    <section
      ref={gameRef}
      className="torus-game"
      aria-label="Torus 2D game"
      data-animation-mode={animationMode}
    >
      <GameSidebar
        size={controller.size}
        viewModel={viewModel}
        showMoveNumbers={showMoveNumbers}
        onShowMoveNumbersChange={setShowMoveNumbers}
        showDuplicateRegions={showDuplicateRegions}
        onShowDuplicateRegionsChange={handleShowDuplicateRegionsChange}
        passDisabled={gameplayReadOnly || viewModel.phase !== 'playing' || passGuardActive}
        canRedo={interaction.canRedo()}
        canUndo={interaction.canUndo()}
        onPass={() => void handlePass()}
        onRedo={() => void handleRedo()}
        onUndo={() => void handleUndo()}
        gameResultAvailable={Boolean(gameResult && !resultOpen)}
        onOpenGameResult={() => setResultOpen(true)}
        onRequestNewGame={onRequestNewGame}
        newGameDisabled={newGameDisabled}
        endgame={endgamePanel}
        feedback={feedback}
        turnLabelOverride={turnLabelOverride}
        retryBotTurn={retryBotTurn}
      />

      <div
        ref={shellRef}
        className="torus-board-shell"
        aria-label="Infinite torus view"
        data-view-zoom={viewZoom.toFixed(3)}
        data-pan-x={dragPan.offset.x.toFixed(1)}
        data-pan-y={dragPan.offset.y.toFixed(1)}
        data-dragging={dragPan.dragging ? 'true' : 'false'}
        style={{
          transform: hasVisualTransform
            ? `translate(${dragPan.offset.x}px, ${dragPan.offset.y}px) scale(${viewZoom})`
            : undefined,
          transition: dragPan.dragging ? 'none' : undefined,
          touchAction: 'none',
        }}
        onPointerDown={dragPan.onPointerDown}
        onPointerMove={dragPan.onPointerMove}
        onPointerUp={dragPan.onPointerUp}
        onPointerCancel={dragPan.onPointerCancel}
        onPointerLeave={dragPan.onPointerLeave}
        onClickCapture={dragPan.onClickCapture}
      >
        <button
          className="torus-pan torus-pan--up"
          type="button"
          aria-label="Shift torus view up"
          onClick={() => handlePan('up')}
        >
          ↑
        </button>
        <button
          className="torus-pan torus-pan--left"
          type="button"
          aria-label="Shift torus view left"
          onClick={() => handlePan('left')}
        >
          ←
        </button>
        <div className="torus-board-viewport">
          <svg
            ref={svgRef}
            className={`torus-board${
              viewModel.phase === 'playing'
                ? ''
                : viewModel.phase === 'endgame'
                  ? ' torus-board--endgame'
                  : ' torus-board--inactive'
            }`}
            data-view-zoom={viewZoom.toFixed(3)}
            data-move-numbers-visible={showMoveNumbers ? 'true' : 'false'}
            style={{ cursor: 'default' }}
            onClick={(event) => void handleBoardClick(event)}
            onMouseMove={handleBoardMouseMove}
            onMouseLeave={handleBoardMouseLeave}
          />
        </div>
        <button
          className="torus-pan torus-pan--right"
          type="button"
          aria-label="Shift torus view right"
          onClick={() => handlePan('right')}
        >
          →
        </button>
        <button
          className="torus-pan torus-pan--down"
          type="button"
          aria-label="Shift torus view down"
          onClick={() => handlePan('down')}
        >
          ↓
        </button>
      </div>

      {gameResult && resultOpen ? (
        <GameResultDialog result={gameResult} onClose={() => setResultOpen(false)} />
      ) : null}
    </section>
  );
}
