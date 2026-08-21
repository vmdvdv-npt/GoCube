import { useEffect, useMemo, useRef, useState } from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { RuleSet } from '../core/game/types';
import { CUBE_SIZES, type CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import { endgameGroupForPoint } from '../presentation/EndgameGroupPresentation';
import { createCube2DLayout, type Cube2DLayoutColumn } from '../presentation/cube/Cube2DLayout';
import {
  createCube2DViewState,
  navigateCube2DViewState,
  setCube2DVerticalAnchorColumn,
  type Cube2DNavigationDirection,
  type Cube2DViewState,
} from '../presentation/cube/Cube2DNavigation';
import {
  CUBE_2D_TRANSITION_MS,
  Cube2DRenderer,
  type Cube2DHoverStatus,
  type Cube2DRendererTransition,
} from '../renderer2d/Cube2DRenderer';
import {
  Cube2DGameController,
  type Cube2DEndgameDecisions,
  type Cube2DEndgameGroup,
  type Cube2DGameActionResult,
} from './Cube2DGameController';
import { GameResultDialog } from './GameResultDialog';
import './manual-endgame.css';
import './cube2d-preview.css';
import './cube2d-game-flow.css';

const PLACEMENT_ANIMATION_MS = 120;
const PASS_GUARD_DURATION_MS = 1000;
const ENDGAME_STATUSES: readonly GroupStatus[] = ['alive', 'dead', 'seki'];

const statusLabel = (status: GroupStatus): string =>
  status === 'alive' ? 'Alive' : status === 'dead' ? 'Dead' : 'Seki';

export function Cube2DPreview() {
  const [size, setSize] = useState<CubeSize>(4);
  const [ruleSet, setRuleSet] = useState<RuleSet>('chinese');
  const [komi, setKomi] = useState(7.5);
  const [komiInput, setKomiInput] = useState('7.5');
  const [newGameRevision, setNewGameRevision] = useState(0);
  const controller = useMemo(
    () => new Cube2DGameController({ size, ruleSet, komi }),
    [komi, newGameRevision, ruleSet, size],
  );
  const [viewModel, setViewModel] = useState(() => controller.viewModel());
  const [viewState, setViewState] = useState<Cube2DViewState>(() => createCube2DViewState());
  const [transition, setTransition] = useState<Cube2DRendererTransition | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<PointId | null>(null);
  const [hoverStatus, setHoverStatus] = useState<Cube2DHoverStatus>(null);
  const [recentlyPlacedPointId, setRecentlyPlacedPointId] = useState<PointId | null>(null);
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [endgameGroups, setEndgameGroups] = useState<readonly Cube2DEndgameGroup[]>([]);
  const [decisions, setDecisions] = useState<Cube2DEndgameDecisions>({});
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [passGuarded, setPassGuarded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const transitionId = useRef(0);
  const transitionTimer = useRef<number | null>(null);
  const placementTimer = useRef<number | null>(null);
  const passGuardTimer = useRef<number | null>(null);
  const actionInFlight = useRef(false);

  const layout = useMemo(
    () => createCube2DLayout(viewState.orientation, size, viewState.verticalAnchorColumn),
    [size, viewState],
  );
  const emptySlots = layout.rows.flat().filter((slot) => slot === null).length;
  const isAnimating = transition !== null;
  const selectedGroup = useMemo(
    () => endgameGroups.find((group) => group.id === selectedGroupId) ?? null,
    [endgameGroups, selectedGroupId],
  );
  const classifiedCount = useMemo(
    () => endgameGroups.filter((group) => Boolean(decisions[group.id])).length,
    [decisions, endgameGroups],
  );
  const allGroupsClassified = endgameGroups.every((group) => Boolean(decisions[group.id]));
  const gameResult = viewModel.phase === 'finished' ? controller.resultModel() : null;

  useEffect(() => {
    const nextViewModel = controller.viewModel();
    setViewModel(nextViewModel);
    setViewState(createCube2DViewState());
    setHoveredPointId(null);
    setHoverStatus(null);
    setRecentlyPlacedPointId(null);
    setEndgameGroups(nextViewModel.phase === 'endgame' ? controller.endgameGroups() : []);
    setDecisions({});
    setSelectedGroupId(null);
    setResultOpen(nextViewModel.phase === 'finished');
    setPassGuarded(false);
    setFeedback(null);
    if (passGuardTimer.current !== null) {
      window.clearTimeout(passGuardTimer.current);
      passGuardTimer.current = null;
    }
  }, [controller]);

  useEffect(
    () => () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      if (placementTimer.current !== null) window.clearTimeout(placementTimer.current);
      if (passGuardTimer.current !== null) window.clearTimeout(passGuardTimer.current);
    },
    [],
  );

  const clearHover = () => {
    setHoveredPointId(null);
    setHoverStatus(null);
  };

  const clearPassGuard = () => {
    setPassGuarded(false);
    if (passGuardTimer.current !== null) {
      window.clearTimeout(passGuardTimer.current);
      passGuardTimer.current = null;
    }
  };

  const startPassGuard = () => {
    clearPassGuard();
    setPassGuarded(true);
    passGuardTimer.current = window.setTimeout(() => {
      setPassGuarded(false);
      passGuardTimer.current = null;
    }, PASS_GUARD_DURATION_MS);
  };

  const applyGameResult = (result: Cube2DGameActionResult) => {
    clearHover();
    setViewModel(result.viewModel);
    setFeedback(result.accepted ? null : result.reason ?? 'Action rejected');
    setResultOpen(result.viewModel.phase === 'finished' && Boolean(result.viewModel.finalScore));

    if (result.viewModel.phase === 'endgame') {
      setEndgameGroups(controller.endgameGroups());
      setSelectedGroupId(null);
    } else {
      setEndgameGroups([]);
      setDecisions({});
      setSelectedGroupId(null);
    }

    if (result.viewModel.phase !== 'playing' || result.viewModel.consecutivePasses === 0) {
      clearPassGuard();
    }
  };

  const applyViewState = (
    nextState: Cube2DViewState,
    direction: Cube2DRendererTransition['direction'],
  ) => {
    if (isAnimating) return;

    clearHover();
    transitionId.current += 1;
    setViewState(nextState);
    setTransition({ fromLayout: layout, direction, id: transitionId.current });
    transitionTimer.current = window.setTimeout(() => {
      setTransition(null);
      transitionTimer.current = null;
    }, CUBE_2D_TRANSITION_MS);
  };

  const navigate = (direction: Cube2DNavigationDirection) => {
    applyViewState(navigateCube2DViewState(viewState, direction), direction);
  };

  const moveVerticalAnchor = (column: Cube2DLayoutColumn) => {
    applyViewState(setCube2DVerticalAnchorColumn(viewState, column), 'anchor');
  };

  const handlePointHover = (pointId: PointId | null) => {
    if (!pointId || isAnimating || viewModel.phase !== 'playing') {
      clearHover();
      return;
    }

    const availability = controller.moveAvailability(pointId);
    setHoveredPointId(pointId);
    setHoverStatus(
      availability.allowed
        ? 'allowed'
        : availability.reason === 'occupied'
          ? 'occupied'
          : 'forbidden',
    );
  };

  const handlePointActivate = async (pointId: PointId) => {
    if (isAnimating || actionInFlight.current) return;

    if (viewModel.phase === 'endgame') {
      const group = endgameGroupForPoint(endgameGroups, pointId);
      if (group) setSelectedGroupId(group.id);
      return;
    }

    if (viewModel.phase !== 'playing') return;

    const availability = controller.moveAvailability(pointId);
    if (!availability.allowed) {
      handlePointHover(pointId);
      return;
    }

    actionInFlight.current = true;
    try {
      const result = await controller.placeStone(pointId);
      applyGameResult(result);

      if (result.accepted) {
        setRecentlyPlacedPointId(pointId);
        if (placementTimer.current !== null) window.clearTimeout(placementTimer.current);
        placementTimer.current = window.setTimeout(() => {
          setRecentlyPlacedPointId(null);
          placementTimer.current = null;
        }, PLACEMENT_ANIMATION_MS);
      }
    } finally {
      actionInFlight.current = false;
    }
  };

  const handlePass = async () => {
    if (actionInFlight.current || viewModel.phase !== 'playing' || passGuarded) return;

    actionInFlight.current = true;
    try {
      const result = await controller.pass();
      applyGameResult(result);
      if (
        result.accepted &&
        result.viewModel.phase === 'playing' &&
        result.viewModel.consecutivePasses === 1
      ) {
        startPassGuard();
      }
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleUndo = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    try {
      applyGameResult(await controller.undo());
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleRedo = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    try {
      applyGameResult(await controller.redo());
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleFinishEndgame = async () => {
    if (actionInFlight.current || viewModel.phase !== 'endgame') return;
    actionInFlight.current = true;
    try {
      applyGameResult(await controller.finishEndgame(decisions));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Endgame classification failed.');
    } finally {
      actionInFlight.current = false;
    }
  };

  const handleNewGame = () => {
    const parsedKomi = Number(komiInput);
    if (!Number.isFinite(parsedKomi)) {
      setFeedback('Komi must be a finite number.');
      return;
    }
    setKomi(parsedKomi);
    setNewGameRevision((revision) => revision + 1);
  };

  const setGroupStatus = (group: Cube2DEndgameGroup, status: GroupStatus) => {
    setDecisions((current) => ({ ...current, [group.id]: status }));
  };

  return (
    <main className="cube-2d-preview">
      <header className="cube-2d-preview__header">
        <div>
          <p className="cube-2d-preview__kicker">Game Cube Go · 0.2 · task 01.06</p>
          <h1>Cube 2D gameplay integration</h1>
          <p>
            Six physical faces backed by one GameSession: PlaceStone, captures, Pass, Undo/Redo,
            manual endgame classification, Chinese/Japanese scoring, and the shared result dialog.
          </p>
        </div>

        <div className="cube-2d-preview__controls">
          <label className="cube-2d-preview__control">
            Cube size
            <select
              aria-label="Cube size"
              value={size}
              disabled={isAnimating}
              onChange={(event) => setSize(Number(event.target.value) as CubeSize)}
            >
              {CUBE_SIZES.map((option) => (
                <option key={option} value={option}>
                  {option}×{option}
                </option>
              ))}
            </select>
          </label>

          <label className="cube-2d-preview__control">
            Rules
            <select
              aria-label="Cube rules"
              value={ruleSet}
              disabled={isAnimating}
              onChange={(event) => setRuleSet(event.target.value as RuleSet)}
            >
              <option value="chinese">Chinese</option>
              <option value="japanese">Japanese</option>
            </select>
          </label>

          <label className="cube-2d-preview__control">
            Komi
            <input
              aria-label="Cube komi"
              type="number"
              step="any"
              value={komiInput}
              onChange={(event) => setKomiInput(event.target.value)}
            />
          </label>

          <button
            type="button"
            className="cube-2d-preview__toggle"
            aria-pressed={showMoveNumbers}
            onClick={() => setShowMoveNumbers((visible) => !visible)}
          >
            Move numbers
          </button>

          <div className="cube-2d-navigation" aria-label="Cube 2D navigation">
            <button type="button" aria-label="Move cube up" disabled={isAnimating} onClick={() => navigate('up')}>
              ↑
            </button>
            <div>
              <button type="button" aria-label="Move cube left" disabled={isAnimating} onClick={() => navigate('left')}>
                ←
              </button>
              <button type="button" aria-label="Move cube right" disabled={isAnimating} onClick={() => navigate('right')}>
                →
              </button>
            </div>
            <button type="button" aria-label="Move cube down" disabled={isAnimating} onClick={() => navigate('down')}>
              ↓
            </button>
          </div>
        </div>
      </header>

      <section className="cube-2d-preview__status" aria-label="Cube game status">
        <span>center: {viewState.orientation.centerFace}</span>
        <span>up: {viewState.orientation.upFace}</span>
        <span>vertical anchor: {viewState.verticalAnchorColumn}</span>
        <span>occupied boards: {layout.cells.length}</span>
        <span>logical points: {6 * size * size}</span>
        <span>phase: {viewModel.phase}</span>
        <span>player: {viewModel.currentPlayer}</span>
        <span>move: {viewModel.moveNumber}</span>
        <span>passes: {viewModel.consecutivePasses}</span>
        <span>White Captured {viewModel.captures.black}</span>
        <span>Black Captured {viewModel.captures.white}</span>
        <span>rules: {viewModel.ruleSet}</span>
        <span>komi: {viewModel.komi}</span>
        <span>animation: {isAnimating ? 'moving' : 'idle'}</span>
        <span className="cube-2d-preview__empty-count">empty slots: {emptySlots}</span>
      </section>

      <div className="cube-2d-preview__viewport">
        <Cube2DRenderer
          layout={layout}
          diagnostics
          transition={transition ?? undefined}
          onVerticalAnchorColumnChange={moveVerticalAnchor}
          viewModel={viewModel}
          hoveredPointId={hoveredPointId}
          hoverStatus={hoverStatus}
          recentlyPlacedPointId={recentlyPlacedPointId}
          showMoveNumbers={showMoveNumbers}
          inputDisabled={isAnimating || viewModel.phase === 'finished'}
          onPointHover={handlePointHover}
          onPointActivate={(pointId) => void handlePointActivate(pointId)}
        />
      </div>

      <div className="cube-2d-preview__game-controls" role="group" aria-label="Cube game controls">
        <button
          className="cube-2d-preview__action cube-2d-preview__action--primary"
          type="button"
          disabled={viewModel.phase !== 'playing' || passGuarded}
          onClick={() => void handlePass()}
        >
          {viewModel.phase === 'playing' && viewModel.consecutivePasses === 1 ? 'Pass (1)' : 'Pass'}
        </button>
        <button
          className="cube-2d-preview__action"
          type="button"
          disabled={!controller.canRedo()}
          onClick={() => void handleRedo()}
        >
          Redo
        </button>
        <button
          className="cube-2d-preview__action"
          type="button"
          disabled={!controller.canUndo()}
          onClick={() => void handleUndo()}
        >
          Undo
        </button>
        {gameResult && !resultOpen ? (
          <button className="cube-2d-preview__action" type="button" onClick={() => setResultOpen(true)}>
            Game result
          </button>
        ) : null}
        <button className="cube-2d-preview__action" type="button" onClick={handleNewGame}>
          New game
        </button>
      </div>

      {viewModel.phase === 'endgame' ? (
        <section className="endgame-panel cube-2d-preview__endgame" aria-labelledby="cube-endgame-title">
          <div>
            <h2 id="cube-endgame-title">Manual endgame classification</h2>
            <p>
              Select any stone on the six Cube faces. Its complete logical group is selected even
              when the group crosses a physical cube edge, then choose Alive, Dead, or Seki.
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
                    <span className={`stone-chip stone-chip--${selectedGroup.color}`} aria-hidden="true" />
                    <div>
                      <strong>Selected group</strong>
                      <span>
                        {selectedGroup.points.length} {selectedGroup.points.length === 1 ? 'stone' : 'stones'}
                      </span>
                    </div>
                  </div>
                  <div className="endgame-statuses" role="group" aria-label="Selected group status">
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
                <p className="endgame-empty">Select a stone group directly on a Cube face.</p>
              )}
            </>
          ) : (
            <p className="endgame-empty">There are no stone groups to classify.</p>
          )}

          <button
            className="finish-game-button"
            type="button"
            disabled={!allGroupsClassified || isAnimating}
            onClick={() => void handleFinishEndgame()}
          >
            Calculate final score
          </button>
        </section>
      ) : null}

      {gameResult && resultOpen ? (
        <GameResultDialog result={gameResult} onClose={() => setResultOpen(false)} />
      ) : null}

      {feedback ? <p className="cube-2d-preview__feedback">{feedback}</p> : null}
    </main>
  );
}
