import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import { GameResultDialog } from './GameResultDialog';
import {
  Torus2DRenderer,
  type Torus2DPanDirection,
} from '../renderer2d/Torus2DRenderer';
import {
  TorusGameController,
  type TorusEndgameDecisions,
  type TorusEndgameGroup,
  type TorusGameActionResult,
} from './TorusGameController';

const ENDGAME_STATUSES: readonly GroupStatus[] = ['alive', 'dead', 'seki'];

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
  }
};

const statusLabel = (status: GroupStatus): string =>
  status === 'alive' ? 'Alive' : status === 'dead' ? 'Dead' : 'Seki';

export interface TorusGameProps {
  readonly controller: TorusGameController;
  readonly onRequestNewGame: () => void;
}

export function TorusGame({ controller, onRequestNewGame }: TorusGameProps) {
  const [viewModel, setViewModel] = useState(() => controller.viewModel());
  const [feedback, setFeedback] = useState<string | null>(null);
  const [endgameGroups, setEndgameGroups] = useState<readonly TorusEndgameGroup[]>(() =>
    controller.viewModel().phase === 'endgame' ? controller.endgameGroups() : [],
  );
  const [decisions, setDecisions] = useState<TorusEndgameDecisions>({});
  const [resultOpen, setResultOpen] = useState(
    () => controller.viewModel().phase === 'finished',
  );
  const [showDuplicateRegions, setShowDuplicateRegions] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<Torus2DRenderer | null>(null);
  const actionInFlight = useRef(false);

  useEffect(() => {
    rendererRef.current = null;
    const nextViewModel = controller.viewModel();
    setViewModel(nextViewModel);
    setFeedback(null);
    setDecisions({});
    setShowDuplicateRegions(false);
    setResultOpen(nextViewModel.phase === 'finished');
    setEndgameGroups(
      nextViewModel.phase === 'endgame' ? controller.endgameGroups() : [],
    );
  }, [controller]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || viewModel.points.length !== controller.size * controller.size) return;

    const renderer = rendererRef.current ?? new Torus2DRenderer(svg, controller.size);
    rendererRef.current = renderer;
    renderer.setDuplicateRegionsVisible(showDuplicateRegions);
    renderer.render(viewModel);
  }, [controller, showDuplicateRegions, viewModel]);

  const applyResult = (result: TorusGameActionResult): void => {
    setViewModel(result.viewModel);
    setFeedback(result.accepted ? null : rejectionLabel(result.reason));
    setResultOpen(result.viewModel.phase === 'finished' && Boolean(result.viewModel.finalScore));

    if (result.viewModel.phase === 'endgame') {
      setEndgameGroups(controller.endgameGroups());
    } else {
      setEndgameGroups([]);
      setDecisions({});
    }
  };

  const handleBoardClick = async (
    event: ReactMouseEvent<SVGSVGElement>,
  ): Promise<void> => {
    if (actionInFlight.current || viewModel.phase !== 'playing') return;

    const point = rendererRef.current?.pointFromClientPosition(
      event.clientX,
      event.clientY,
    );
    if (!point) return;

    actionInFlight.current = true;
    try {
      applyResult(await controller.placeStone(point));
    } finally {
      actionInFlight.current = false;
    }
  };

  const handlePan = (direction: Torus2DPanDirection): void => {
    rendererRef.current?.pan(direction);
  };

  const handlePass = async (): Promise<void> => {
    if (actionInFlight.current || viewModel.phase !== 'playing') return;

    actionInFlight.current = true;
    try {
      applyResult(await controller.pass());
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
          <span>Black captures {viewModel.captures.black}</span>
          <span>White captures {viewModel.captures.white}</span>
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
        <svg
          ref={svgRef}
          className={`torus-board${viewModel.phase === 'playing' ? '' : ' torus-board--inactive'}`}
          onClick={(event) => void handleBoardClick(event)}
        />
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

      <label className="torus-duplicates-control">
        <input
          type="checkbox"
          checked={showDuplicateRegions}
          onChange={(event) => setShowDuplicateRegions(event.target.checked)}
        />
        Показывать дублирующие области
      </label>

      <p className="torus-view-hint">
        {showDuplicateRegions
          ? 'Four wrapped rows and columns on every side are visual copies of the same logical points.'
          : `Duplicate regions are hidden. The board shows exactly ${controller.size}×${controller.size} intersections.`}
      </p>

      <div className="game-controls">
        <button
          type="button"
          onClick={() => void handlePass()}
          disabled={viewModel.phase !== 'playing'}
        >
          Pass
        </button>
        <button
          type="button"
          onClick={() => void handleUndo()}
          disabled={viewModel.moveNumber === 0}
        >
          Undo
        </button>
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
              Mark every stone group as alive, dead, or seki. Your decisions are final for scoring.
            </p>
          </div>

          {endgameGroups.length > 0 ? (
            <div className="endgame-groups">
              {endgameGroups.map((group, index) => (
                <div className="endgame-group" key={group.id}>
                  <div className="endgame-group__identity">
                    <span
                      className={`stone-chip stone-chip--${group.color}`}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>Group {index + 1}</strong>
                      <span>{group.points.join(' · ')}</span>
                    </div>
                  </div>
                  <div
                    className="endgame-statuses"
                    role="group"
                    aria-label={`Group ${index + 1} status`}
                  >
                    {ENDGAME_STATUSES.map((status) => (
                      <button
                        type="button"
                        key={status}
                        className={decisions[group.id] === status ? 'is-selected' : undefined}
                        aria-pressed={decisions[group.id] === status}
                        onClick={() => setGroupStatus(group, status)}
                      >
                        {statusLabel(status)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
