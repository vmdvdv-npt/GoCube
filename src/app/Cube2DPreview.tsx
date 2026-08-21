import { useEffect, useMemo, useRef, useState } from 'react';
import { CUBE_SIZES, type CubeSize } from '../core/topology/CubeTopology';
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
  type Cube2DRendererTransition,
} from '../renderer2d/Cube2DRenderer';
import './cube2d-preview.css';

export function Cube2DPreview() {
  const [size, setSize] = useState<CubeSize>(4);
  const [viewState, setViewState] = useState<Cube2DViewState>(() => createCube2DViewState());
  const [transition, setTransition] = useState<Cube2DRendererTransition | null>(null);
  const transitionId = useRef(0);
  const transitionTimer = useRef<number | null>(null);

  const layout = useMemo(
    () => createCube2DLayout(viewState.orientation, size, viewState.verticalAnchorColumn),
    [size, viewState],
  );
  const emptySlots = layout.rows.flat().filter((slot) => slot === null).length;
  const isAnimating = transition !== null;

  useEffect(
    () => () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    },
    [],
  );

  const applyViewState = (
    nextState: Cube2DViewState,
    direction: Cube2DRendererTransition['direction'],
  ) => {
    if (isAnimating) return;

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

  return (
    <main className="cube-2d-preview">
      <header className="cube-2d-preview__header">
        <div>
          <p className="cube-2d-preview__kicker">Game Cube Go · 0.2 · task 01.04</p>
          <h1>Cube 2D navigation preview</h1>
          <p>
            Six physical cube faces only. Arrow controls rebuild Cube2DLayout through
            CubeOrientation, while empty top/bottom slots move the real vertical pair with
            topology-correct rotations and no visual duplicates.
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
        <span>empty slots: {emptySlots}</span>
        <span>logical points: {6 * size * size}</span>
        <span>animation: {isAnimating ? 'moving' : 'idle'}</span>
      </section>

      <div className="cube-2d-preview__viewport">
        <Cube2DRenderer
          layout={layout}
          diagnostics
          transition={transition ?? undefined}
          onVerticalAnchorColumnChange={moveVerticalAnchor}
        />
      </div>
    </main>
  );
}
