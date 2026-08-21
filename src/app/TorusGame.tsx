import {
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
import './manual-endgame.css';
import {
  isTorus2DPrimaryBoardClientPosition,
  renderTorus2DEdgeDuplicates,
} from '../renderer2d/Torus2DEdgeDuplicates';
import {
  Torus2DRenderer,
  type Torus2DPanDirection,
} from '../renderer2d/Torus2DRenderer';
import { renderTorus2DStoneAnnotations } from '../renderer2d/Torus2DStoneAnnotations';
import {
  TorusGameController,
  type TorusEndgameDecisions,
  type TorusEndgameGroup,
  type TorusGameActionResult,
} from './TorusGameController';

const ENDGAME_STATUSES: readonly GroupStatus[] = ['alive', 'dead', 'seki'];
const TORUS_ZOOM_MIN = 0.7;
const TORUS_ZOOM_MAX = 2.5;
const TORUS_ZOOM_WHEEL_SENSITIVITY = 0.0015;
const PASS_GUARD_DURATION_MS = 1000;
const PASS_GUARD_TICK_MS = 100;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

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
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<Torus2DRenderer | null>(null);
  const actionInFlight = useRef(false);
  const previewedMovePointRef = useRef<string | null>(null);

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
  }, [controller]);

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
    if (
      showDuplicateRegions &&
      !isTorus2DPrimaryBoardClientPosition(svg, event.clientX, event.clientY)
    ) {
      return null;
    }

    const lineGroupId = renderer.endgameGroupFromClientPosition(
      event.clientX,
      event.clientY,
    );
    if (lineGroupId) {
      return endgameGroups.find((group) => group.id === lineGroupId) ?? null;
    }

    const point = renderer.pointFromClientPosition(event.clientX, event.clientY);
    return point ? endgameGroupForPoint(endgameGroups, point) : null;
  };

  const handleBoardClick = async (
    event: ReactMouseEvent<SVGSVGElement>,
  ): Promise<void> => {
    if (actionInFlight.current) return;

    const svg = svgRef.current;
    if (
      showDuplicateRegions &&
      svg &&
      !isTorus2DPrimaryBoardClientPosition(svg, event.clientX, event.clientY)
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

    const exactHit = renderer.visualPointFromClientPosition(event.clientX, event.clientY);
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
    const svg = svgRef.current;

    if (
      showDuplicateRegions &&
      svg &&
      !isTorus2DPrimaryBoardClientPosition(svg, event.clientX, event.clientY)
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

      const hit = renderer.hoverVisualPointFromClientPosition(event.clientX, event.clientY);
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
  const stageLabel =
    viewModel.phase === 'playing'
      ? `${viewModel.currentPlayer === 'black' ? 'Black' : 'White'} to move`
      : viewModel.phase === 'endgame'
        ? 'Classify groups'
        : 'Game finished';

  return (
    <section className="torus-game" aria-label="Torus 2D game">
      <div className="game-summary" aria-live="polite">
        <div className="turn-indicator">
          {viewModel.phase === 'playing' ? (
            <span
              className={`stone-chip stone-chip--${viewModel.currentPlayer}`}
              aria-hidden="true"
            />
          ) : null}
          <strong>{stageLabel}</strong>
        </div>
        <div className="game-statistics">
          <span>{controller.size}×{controller.size}</span>
          <span>Move {viewModel.moveNumber}</span>
          <span>Passes {viewModel.consecutivePasses}</span>
          <span>Black Captured {viewModel.captures.white}</span>
          <span>White Captured {viewModel.captures.black}</span>
          <span>{viewModel.ruleSet === 'chinese' ? 'Chinese' : 'Japanese'} rules</span>
          <span>Komi {viewModel.komi}</span>
        </div>
      </div>

      <div className="torus-board-shell" aria-label="Infinite torus view">
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
            style={{ transform: `scale(${viewZoom})`, cursor: 'default' }}
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

      <div className="torus-duplicates-control" role="group" aria-label="Board display options">
        <label>
          <input
            type="checkbox"
            checked={showDuplicateRegions}
            onChange={(event) => setShowDuplicateRegions(event.target.checked)}
          />
          Показывать дублирующие области
        </label>
        <label>
          <input
            type="checkbox"
            checked={showMoveNumbers}
            onChange={(event) => setShowMoveNumbers(event.target.checked)}
          />
          Номера ходов
        </label>
      </div>

      <p className="torus-view-hint">
        {showDuplicateRegions
          ? 'One wrapped row or column is shown on each side as a non-interactive visual copy.'
          : `Duplicate regions are hidden. The board shows exactly ${controller.size}×${controller.size} intersections.`}
      </p>

      <div className="game-controls">
        <button
          className="pass-control"
          type="button"
          onClick={() => void handlePass()}
          disabled={viewModel.phase !== 'playing' || passGuardActive}
        >
          {viewModel.phase === 'playing' && viewModel.consecutivePasses === 1 ? 'Pass (1)' : 'Pass'}
        </button>
        <div className="history-controls" role="group" aria-label="Move history controls">
          <button
            type="button"
            onClick={() => void handleRedo()}
            disabled={!controller.canRedo()}
          >
            Redo
          </button>
          <button
            type="button"
            onClick={() => void handleUndo()}
            disabled={!controller.canUndo()}
          >
            Undo
          </button>
        </div>
        {gameResult && !resultOpen ? (
          <button
            className="game-result-control"
            type="button"
            onClick={() => setResultOpen(true)}
          >
            Game result
          </button>
        ) : null}
        <button className="new-game-control" type="button" onClick={onRequestNewGame}>
          New game
        </button>
      </div>

      {viewModel.phase === 'endgame' ? (
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
      ) : null}

      {gameResult && resultOpen ? (
        <GameResultDialog result={gameResult} onClose={() => setResultOpen(false)} />
      ) : null}

      {feedback ? <p className="game-feedback">{feedback}</p> : null}
    </section>
  );
}
