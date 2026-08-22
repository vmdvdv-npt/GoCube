import { useMemo, useState } from 'react';
import { Cube2DRenderer } from '../renderer2d/Cube2DRenderer';
import { CUBE_UI_SIZES, type CubeUiSize } from './CubeGameConfig';
import { Cube2DGameController } from './Cube2DGameController';
import { Cube2DVisualEffects } from './Cube2DVisualEffects';
import { useCube2DGame } from './useCube2DGame';
import './cube2d-preview.css';
import './cube2d-game-flow.css';

/**
 * Development-only Cube 2D inspection surface. It intentionally reuses the same
 * controller/hook/renderer stack as the production game, including the movable
 * TOP/BOTTOM vertical anchor controlled through empty layout slots.
 */
export function Cube2DPreview() {
  const [size, setSize] = useState<CubeUiSize>(4);
  const controller = useMemo(
    () => new Cube2DGameController({ size, ruleSet: 'chinese', komi: 7.5 }),
    [size],
  );
  const g = useCube2DGame(controller);
  const emptySlots = g.layout.rows.flat().filter((slot) => slot === null).length;

  return (
    <main className="cube-2d-preview">
      <header className="cube-2d-preview__header">
        <div>
          <p className="cube-2d-preview__kicker">Game Cube Go · developer view</p>
          <h1>Cube 2D visual completion</h1>
          <p>
            One renderer path, six physical faces, a 4×3 placement field, movable
            TOP/BOTTOM anchor slots and one logical representation per Cube point.
          </p>
        </div>

        <div className="cube-2d-preview__controls">
          <label className="cube-2d-preview__control">
            Cube size
            <select
              aria-label="Cube size"
              value={size}
              disabled={Boolean(g.transition) || g.captureAnimating}
              onChange={(event) => setSize(Number(event.target.value) as CubeUiSize)}
            >
              {CUBE_UI_SIZES.map((option) => (
                <option value={option} key={option}>
                  {option}×{option}
                </option>
              ))}
            </select>
          </label>

          <button
            className="cube-2d-preview__toggle"
            type="button"
            aria-pressed={g.showMoveNumbers}
            onClick={() => g.setShowMoveNumbers(!g.showMoveNumbers)}
          >
            Move numbers
          </button>

          <div className="cube-2d-navigation" role="group" aria-label="Cube navigation">
            <button
              type="button"
              aria-label="Move cube up"
              disabled={Boolean(g.transition) || g.captureAnimating}
              onClick={() => g.navigate('up')}
            >
              ↑
            </button>
            <div>
              <button
                type="button"
                aria-label="Move cube left"
                disabled={Boolean(g.transition) || g.captureAnimating}
                onClick={() => g.navigate('left')}
              >
                ←
              </button>
              <button
                type="button"
                aria-label="Move cube right"
                disabled={Boolean(g.transition) || g.captureAnimating}
                onClick={() => g.navigate('right')}
              >
                →
              </button>
            </div>
            <button
              type="button"
              aria-label="Move cube down"
              disabled={Boolean(g.transition) || g.captureAnimating}
              onClick={() => g.navigate('down')}
            >
              ↓
            </button>
          </div>
        </div>
      </header>

      <div className="cube-2d-preview__status" aria-live="polite">
        <span>occupied boards: {g.layout.cells.length}</span>
        <span className="cube-2d-preview__empty-count">empty slots: {emptySlots}</span>
        <span>vertical anchor: column {g.view.verticalAnchorColumn + 1}</span>
        <span>logical points: {g.vm.points.length}</span>
        <span>player: {g.vm.currentPlayer ?? 'none'}</span>
        <span>move: {g.vm.moveNumber}</span>
      </div>

      <div className="cube-2d-preview__viewport">
        <div className="cube-2d-stage">
          <Cube2DRenderer
            layout={g.layout}
            transition={g.transition ?? undefined}
            onVerticalAnchorColumnChange={g.moveAnchor}
            viewModel={g.vm}
            hoveredPointId={g.hoveredPoint}
            hoverStatus={g.hoverStatus}
            showMoveNumbers={g.showMoveNumbers}
            inputDisabled={
              Boolean(g.transition) || g.captureAnimating || g.vm.phase === 'finished'
            }
            onPointHover={g.hover}
            onPointActivate={(point) => void g.activate(point)}
          />
          <Cube2DVisualEffects
            layout={g.layout}
            finalScore={g.vm.finalScore}
            finalClassification={g.finalClassification}
            endgameGroups={g.groups}
            decisions={g.decisions}
            selectedGroupId={g.selectedGroup}
            hoveredGroupId={g.hoveredGroup}
            capturedStones={g.capturedEffects}
          />
        </div>
      </div>
    </main>
  );
}
