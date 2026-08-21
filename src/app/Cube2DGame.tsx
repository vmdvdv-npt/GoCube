import type { WheelEvent } from 'react';
import { Cube2DRenderer } from '../renderer2d/Cube2DRenderer';
import { Cube2DGameController } from './Cube2DGameController';
import { Cube2DVisualEffects } from './Cube2DVisualEffects';
import { GameResultDialog } from './GameResultDialog';
import { GameSidebar } from './GameSidebar';
import { CUBE_ENDGAME_STATUSES, cubeEndgameStatusLabel, useCube2DGame } from './useCube2DGame';
import './manual-endgame.css';
import './cube2d-preview.css';
import './cube2d-game-flow.css';
import './cube2d-game.css';

export interface Cube2DGameProps {
  readonly controller: Cube2DGameController;
  readonly onRequestNewGame: () => void;
}

export function Cube2DGame({ controller, onRequestNewGame }: Cube2DGameProps) {
  const g = useCube2DGame(controller);

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
        passDisabled={g.vm.phase !== 'playing' || g.passGuarded || Boolean(g.transition)}
        canRedo={!g.transition && controller.canRedo()}
        canUndo={!g.transition && controller.canUndo()}
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
        <button
          className="torus-pan torus-pan--up"
          type="button"
          aria-label="Move cube up"
          disabled={Boolean(g.transition)}
          onClick={() => g.navigate('up')}
        >
          ↑
        </button>
        <button
          className="torus-pan torus-pan--left"
          type="button"
          aria-label="Move cube left"
          disabled={Boolean(g.transition)}
          onClick={() => g.navigate('left')}
        >
          ←
        </button>

        <div
          className="cube-2d-game__viewport"
          data-view-zoom={g.zoom.toFixed(3)}
          onWheel={handleWheel}
        >
          <div
            className="cube-2d-game__scaled-stage"
            style={{ width: `${760 * g.zoom}px`, height: `${570 * g.zoom}px` }}
          >
            <div
              className="cube-2d-stage cube-2d-game__stage"
              style={{ transform: `scale(${g.zoom})` }}
            >
              <Cube2DRenderer
                layout={g.layout}
                transition={g.transition ?? undefined}
                onVerticalAnchorColumnChange={g.moveAnchor}
                viewModel={g.vm}
                hoveredPointId={g.hoveredPoint}
                hoverStatus={g.hoverStatus}
                showMoveNumbers={g.showMoveNumbers}
                inputDisabled={Boolean(g.transition) || g.vm.phase === 'finished'}
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
                capturedStones={[]}
              />
            </div>
          </div>
        </div>

        <button
          className="torus-pan torus-pan--right"
          type="button"
          aria-label="Move cube right"
          disabled={Boolean(g.transition)}
          onClick={() => g.navigate('right')}
        >
          →
        </button>
        <button
          className="torus-pan torus-pan--down"
          type="button"
          aria-label="Move cube down"
          disabled={Boolean(g.transition)}
          onClick={() => g.navigate('down')}
        >
          ↓
        </button>
      </div>

      {g.result && g.resultOpen ? (
        <GameResultDialog result={g.result} onClose={() => g.setResultOpen(false)} />
      ) : null}
    </section>
  );
}
