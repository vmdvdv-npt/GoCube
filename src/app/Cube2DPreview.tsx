import { useEffect, useMemo, useRef, useState } from 'react';
import { CUBE_SIZES, type CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
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
import { Cube2DGameController } from './Cube2DGameController';
import './cube2d-preview.css';

const PLACEMENT_ANIMATION_MS = 120;

export function Cube2DPreview() {
  const [size, setSize] = useState<CubeSize>(4);
  const controller = useMemo(() => new Cube2DGameController({ size }), [size]);
  const [viewModel, setViewModel] = useState(() => controller.viewModel());
  const [viewState, setViewState] = useState<Cube2DViewState>(() => createCube2DViewState());
  const [transition, setTransition] = useState<Cube2DRendererTransition | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<PointId | null>(null);
  const [hoverStatus, setHoverStatus] = useState<Cube2DHoverStatus>(null);
  const [recentlyPlacedPointId, setRecentlyPlacedPointId] = useState<PointId | null>(null);
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const transitionId = useRef(0);
  const transitionTimer = useRef<number | null>(null);
  const placementTimer = useRef<number | null>(null);

  const layout = useMemo(
    () => createCube2DLayout(viewState.orientation, size, viewState.verticalAnchorColumn),
    [size, viewState],
  );
  const emptySlots = layout.rows.flat().filter((slot) => slot === null).length;
  const isAnimating = transition !== null;

  useEffect(() => {
    setViewModel(controller.viewModel());
    setHoveredPointId(null);
    setHoverStatus(null);
    setRecentlyPlacedPointId(null);
  }, [controller]);

  useEffect(
    () => () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      if (placementTimer.current !== null) window.clearTimeout(placementTimer.current);
    },
    [],
  );

  const clearHover = () => {
    setHoveredPointId(null);
    setHoverStatus(null);
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
    if (!pointId || isAnimating) {
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
    if (isAnimating) return;

    const availability = controller.moveAvailability(pointId);
    if (!availability.allowed) {
      handlePointHover(pointId);
      return;
    }

    const result = await controller.placeStone(pointId);
    setViewModel(result.viewModel);
    clearHover();

    if (result.accepted) {
      setRecentlyPlacedPointId(pointId);
      if (placementTimer.current !== null) window.clearTimeout(placementTimer.current);
      placementTimer.current = window.setTimeout(() => {
        setRecentlyPlacedPointId(null);
        placementTimer.current = null;
      }, PLACEMENT_ANIMATION_MS);
    }
  };

  return (
    <main className="cube-2d-preview">
      <header className="cube-2d-preview__header">
        <div>
          <p className="cube-2d-preview__kicker">Game Cube Go · 0.2 · task 01.05</p>
          <h1>Cube 2D gameplay integration</h1>
          <p>
            Six physical cube faces backed by the real GameSession and GameEngine. Hover resolves
            to logical PointId, legal moves preview the next stone, forbidden moves show a red
            marker, and navigation remains presentation-only.
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

      <section className="cube-2d-preview__status" aria-label="Preview orientation">
        <span>center: {viewState.orientation.centerFace}</span>
        <span>up: {viewState.orientation.upFace}</span>
        <span>vertical anchor: {viewState.verticalAnchorColumn}</span>
        <span>occupied boards: {layout.cells.length}</span>
        <span>logical points: {6 * size * size}</span>
        <span>player: {viewModel.currentPlayer}</span>
        <span>move: {viewModel.moveNumber}</span>
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
          inputDisabled={isAnimating}
          onPointHover={handlePointHover}
          onPointActivate={handlePointActivate}
        />
      </div>
    </main>
  );
}
