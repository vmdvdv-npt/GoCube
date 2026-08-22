import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import {
  endgameGroupForPoint,
  type EndgameGroupRenderState,
} from '../presentation/EndgameGroupPresentation';
import { GameResultDialog } from './GameResultDialog';
import { GameSidebar } from './GameSidebar';
import './manual-endgame.css';
import './game-viewport.css';
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
import {
  TorusGameController,
  type TorusEndgameDecisions,
  type TorusEndgameGroup,
  type TorusGameActionResult,
} from './TorusGameController';
import { useDragPan, type DragPanOffset } from './useDragPan';

const ENDGAME_STATUSES: readonly GroupStatus[] = ['alive', 'dead', 'seki'];
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
  if (bounds.width <= 0 || bounds.height <= 0 || viewBox.width <= 0 || viewBox.height <= 0) {
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

const statusLabel = (status: GroupStatus): string =>
  status === 'alive' ? 'Alive' : status === 'dead' ? 'Dead' : 'Seki';

export interface TorusGameProps {
  readonly controller: TorusGameController;
  readonly onRequestNewGame: () => void;
}

export function TorusGame({ controller, onRequestNewGame }: TorusGameProps) {
  const initialViewModel = controller.viewModel();
  const [viewModel, setViewModel] = useState(() => initialViewModel);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [endgameGroups, setEndgameGroups] = useState<readonly TorusEndgameGroup[]>(() =>
    initialViewModel.phase === 'endgame' ? controller.endgameGroups() : [],
  );
  const [decisions, setDecisions] = useState<TorusEndgameDecisions>({});
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [resultOpen, setResultOpen] = useState(
    () => initialViewModel.phase === 'finished',
  );
  const [showDuplicateRegions, setShowDuplicateRegions] = useState(false);
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  const [passGuardUntil, setPassGuardUntil] = useState<number | null>(null);
  const [passGuardRemainingMs, setPassGuardRemainingMs] = useState(0);
  const shellRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<Torus2DRenderer | null>(null);
  const actionInFlight = useRef(false);
  const previewedMovePointRef = useRef<string | null>(null);

  const constrainViewPan = useCallback(
    (candidate: DragPanOffset): DragPanOffset => {
      const shell = shellRef.current;
      if (!shell) return candidate;

      const overflowX = (shell.offsetWidth * Math.max(0, viewZoom - 1)) / 2;
      const overflowY = (shell.offsetHeight * Math.max(0, viewZoom - 1)) / 2;
      const maxX = overflowX + TORUS_PAN_EDGE_SLACK;
      const maxY = overflowY + TORUS_PAN_EDGE_SLACK;
      return Object.freeze({
        x: clamp(candidate.x, -maxX, maxX),
        y: clamp(candidate.y, -maxY, maxY),
      });
    },
    [viewZoom],
  );

  const clearPanHover = useCallback((): void => {
    previewedMovePointRef.current = null;
    rendererRef.current?.setMovePreview(null);
    setHoveredGroupId(null);
  }, []);

  const dragPan = useDragPan({
    constrain: constrainViewPan,
    onDragStart: clearPanHover,
  });

  const renderGroups = useMemo<readonly EndgameGroupRenderState[]>(
    () =>
      endgameGroups.map((group) =>
        Object.freeze({
          ...group,
          status: decisions[group.id] ?? null,
        }),
      ),
    [decisions, endgameGroups],
  );

  const selectedGroup = useMemo(
    () => endgameGroups.find((group) => group.id === selectedGroupId) ?? null,
    [endgameGroups, selectedGroupId],
  );

  const classifiedCount = useMemo(
    () => endgameGroups.filter((group) => Boolean(decisions[group.id])).length,
    [decisions, endgameGroups],
  );

  useEffect(() => {
    rendererRef.current = null;
    previewedMovePointRef.current = null;
    dragPan.reset();
    const nextViewModel = controller.viewModel();
    setViewModel(nextViewModel);
    setFeedback(null);
    setDecisions({});
    setHoveredGroupId(null);
    setSelectedGroupId(null);
    setShowDuplicateRegions(false);
    setShowMoveNumbers(false);
    setViewZoom(1);
    setPassGuardUntil(null);
    setPassGuardRemainingMs(0);
    setResultOpen(nextViewModel.phase === 'finished');
    setEndgameGroups(
      nextViewModel.phase === 'endgame' ? controller.endgameGroups() : [],
    );
  }, [controller, dragPan.reset]);

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
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      setViewZoom((current) =>
        clamp(
          current * Math.exp(-event.deltaY * TORUS_ZOOM_WHEEL_SENSITIVITY),
          TORUS_ZOOM_MIN,
          TORUS_ZOOM_MAX,
        ),
      );
    };

    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [controller]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || viewModel.points.length !== controller.size * controller.size) return;

    const renderer = rendererRef.current ?? new Torus2DRenderer(svg, controller.size);
    rendererRef.current = renderer;

    // The legacy renderer expansion is deliberately kept disabled. The opt-in
    // duplicate view is now a separate one-line, non-interactive edge overlay.
    renderer.setDuplicateRegionsVisible(false);
    renderer.setEndgameOverlay(
      viewModel.phase === 'endgame'
        ? {
            groups: renderGroups,
            hoveredGroupId,
            selectedGroupId,
          }
        : null,
    );
    renderer.render(viewModel);
    renderTorus2DEdgeDuplicates(
      svg,
      viewModel,
      controller.size,
      renderer.viewState(),
      showDuplicateRegions,
    );
    renderTorus2DStoneAnnotations(svg, viewModel, showMoveNumbers);
  }, [
    controller,
    hoveredGroupId,
    renderGroups,
    selectedGroupId,
    showDuplicateRegions,
    showMoveNumbers,
    viewModel,
  ]);

  useEffect(() => {
    const svg = svgRef.current;
    const view = svg?.ownerDocument.defaultView;
    if (!svg) return;

    const applyCamera = (): void =>
      applyTorusVectorCamera(svg, controller.size, showDuplicateRegions);

    // Torus2DRenderer still owns the scene lifecycle and may perform one final
    // initial render after React's first effect pass. Apply immediately and once
    // again on the next frame so the stable vector-fit camera remains the owner
    // of the root viewBox while user zoom is applied to the whole board shell.
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
          viewModel,
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

  const applyResult = (result: TorusGameActionResult): void => {
    previewedMovePointRef.current = null;
    rendererRef.current?.setMovePreview(null);
    setViewModel(result.viewModel);
    setFeedback(result.accepted ? null : rejectionLabel(result.reason));
    setResultOpen(result.viewModel.phase === 'finished' && Boolean(result.viewModel.finalScore));

    if (
      result.viewModel.phase !== 'playing' ||
      result.viewModel.consecutivePasses === 0
    ) {
      setPassGuardUntil(null);
    }

    if (result.viewModel.phase === 'endgame') {
      setEndgameGroups(controller.endgameGroups());
      setHoveredGroupId(null);
      setSelectedGroupId(null);
    } else {
      setEndgameGroups([]);
      setDecisions({});
      setHoveredGroupId(null);
      setSelectedGroupId(null);
    }
  };

  const groupAtClientPosition = (
    event: ReactMouseEvent<SVGSVGElement>,
  ): TorusEndgameGroup | null => {
    const renderer = rendererRef.current;
    const svg = svgRef.current;
    if (!renderer || !svg) return null;
    const client = rendererClientPosition(svg, event.clientX, event.clientY);
    if (
      showDuplicateRegions &&
      !isTorus2DPrimaryBoardClientPosition(svg, client.x, client.y)
    ) {
      return null;
    }

    const lineGroupId = renderer.endgameGroupFromClientPosition(client.x, client.y);
    if (lineGroupId) {
      return endgameGroups.find((group) => group.id === lineGroupId) ?? null;
    }

    const point = renderer.pointFromClientPosition(client.x, client.y);
    return point ? endgameGroupForPoint(endgameGroups, point) : null;
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
        setSelectedGroupId(group.id);
        setHoveredGroupId(group.id);
      }
      return;
    }

    if (viewModel.phase !== 'playing') return;

    const renderer = rendererRef.current;
    if (!renderer) return;

    const exactHit = renderer.visualPointFromClientPosition(client.x, client.y);
    const logicalPointId = previewedMovePointRef.current ?? exactHit?.logicalPointId ?? null;
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
      applyResult(await controller.placeStone(logicalPointId));
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleBoardMouseMove = (event: ReactMouseEvent<SVGSVGElement>): void => {
    const renderer = rendererRef.current;
    if (dragPan.dragging) {
      previewedMovePointRef.current = null;
      renderer?.setMovePreview(null);
      if (hoveredGroupId !== null) setHoveredGroupId(null);
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
      if (hoveredGroupId !== null) setHoveredGroupId(null);
      return;
    }

    if (viewModel.phase === 'playing') {
      if (hoveredGroupId !== null) setHoveredGroupId(null);
      if (!renderer || actionInFlight.current) {
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
      if (hoveredGroupId !== null) setHoveredGroupId(null);
      return;
    }

    const group = groupAtClientPosition(event);
    const nextHoveredGroupId = group?.id ?? null;
    if (nextHoveredGroupId !== hoveredGroupId) {
      setHoveredGroupId(nextHoveredGroupId);
    }
  };

  const handleBoardMouseLeave = (): void => {
    previewedMovePointRef.current = null;
    rendererRef.current?.setMovePreview(null);
    if (hoveredGroupId !== null) setHoveredGroupId(null);
  };

  const handlePan = (direction: Torus2DPanDirection): void => {
    const renderer = rendererRef.current;
    previewedMovePointRef.current = null;
    renderer?.setMovePreview(null);
    renderer?.pan(direction);
  };

  const handlePass = async (): Promise<void> => {
    if (
      actionInFlight.current ||
      viewModel.phase !== 'playing' ||
      passGuardRemainingMs > 0
    ) {
      return;
    }

    actionInFlight.current = true;
    try {
      const result = await controller.pass();
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
      applyResult(await controller.undo());
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleRedo = async (): Promise<void> => {
    if (actionInFlight.current) return;

    actionInFlight.current = true;
    try {
      applyResult(await controller.redo());
    } finally {
      actionInFlight.current = false;
    }
  };

  const setGroupStatus = (group: TorusEndgameGroup, status: GroupStatus): void => {
    setDecisions((current) => ({ ...current, [group.id]: status }));
  };

  const handleFinishEndgame = async (): Promise<void> => {
    if (actionInFlight.current || viewModel.phase !== 'endgame') return;

    actionInFlight.current = true;
    try {
      applyResult(await controller.finishEndgame(decisions));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Endgame classification failed.');
    } finally {
      actionInFlight.current = false;
    }
  };

  const allGroupsClassified = endgameGroups.every((group) => Boolean(decisions[group.id]));
  const gameResult = viewModel.phase === 'finished' ? controller.resultModel() : null;
  const passGuardActive = passGuardRemainingMs > 0;

  const endgamePanel =
    viewModel.phase === 'endgame' ? (
      <section className="endgame-panel" aria-labelledby="endgame-title">
        <div>
          <h2 id="endgame-title">Manual endgame classification</h2>
          <p>
            Hover a stone to highlight its whole logical group. Click a stone or an existing group line to select it, then choose Alive, Dead, or Seki.
          </p>
        </div>

        {endgameGroups.length > 0 ? (
          <>
            <div className="endgame-progress" aria-live="polite">
              Classified {classifiedCount} of {endgameGroups.length}
            </div>

            {selectedGroup ? (
              <div className="endgame-selection">
                <div className="endgame-selection__identity">
                  <span
                    className={`stone-chip stone-chip--${selectedGroup.color}`}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>Selected group</strong>
                    <span>
                      {selectedGroup.points.length} {selectedGroup.points.length === 1 ? 'stone' : 'stones'}
                    </span>
                  </div>
                </div>
                <div
                  className="endgame-statuses"
                  role="group"
                  aria-label="Selected group status"
                >
                  {ENDGAME_STATUSES.map((status) => (
                    <button
                      type="button"
                      key={status}
                      className={decisions[selectedGroup.id] === status ? 'is-selected' : undefined}
                      aria-pressed={decisions[selectedGroup.id] === status}
                      onClick={() => setGroupStatus(selectedGroup, status)}
                    >
                      {statusLabel(status)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="endgame-empty">Select a stone group directly on the board.</p>
            )}
          </>
        ) : (
          <p className="endgame-empty">There are no stone groups to classify.</p>
        )}

        <button
          className="finish-game-button"
          type="button"
          disabled={!allGroupsClassified}
          onClick={() => void handleFinishEndgame()}
        >
          Calculate final score
        </button>
      </section>
    ) : null;

  return (
    <section className="torus-game" aria-label="Torus 2D game">
      <GameSidebar
        size={controller.size}
        viewModel={viewModel}
        showMoveNumbers={showMoveNumbers}
        onShowMoveNumbersChange={setShowMoveNumbers}
        showDuplicateRegions={showDuplicateRegions}
        onShowDuplicateRegionsChange={setShowDuplicateRegions}
        passDisabled={viewModel.phase !== 'playing' || passGuardActive}
        canRedo={controller.canRedo()}
        canUndo={controller.canUndo()}
        onPass={() => void handlePass()}
        onRedo={() => void handleRedo()}
        onUndo={() => void handleUndo()}
        gameResultAvailable={Boolean(gameResult && !resultOpen)}
        onOpenGameResult={() => setResultOpen(true)}
        onRequestNewGame={onRequestNewGame}
        endgame={endgamePanel}
        feedback={feedback}
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
          transform: `translate(${dragPan.offset.x}px, ${dragPan.offset.y}px) scale(${viewZoom})`,
          transition: dragPan.dragging ? 'none' : undefined,
          touchAction: 'none',
        }}
        onPointerDown={dragPan.onPointerDown}
        onPointerMove={dragPan.onPointerMove}
        onPointerUp={dragPan.onPointerUp}
        onPointerCancel={dragPan.onPointerCancel}
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
            className={`torus-board${viewModel.phase === 'playing' ? '' : viewModel.phase === 'endgame' ? ' torus-board--endgame' : ' torus-board--inactive'}`}
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
