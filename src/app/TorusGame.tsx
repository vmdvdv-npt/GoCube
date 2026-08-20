import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Torus2DRenderer } from '../renderer2d/Torus2DRenderer';
import {
  TorusGameController,
  type TorusGameActionResult,
} from './TorusGameController';

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

export function TorusGame() {
  const controller = useMemo(() => new TorusGameController(), []);
  const [viewModel, setViewModel] = useState(() => controller.viewModel());
  const [feedback, setFeedback] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rendererRef = useRef<Torus2DRenderer | null>(null);
  const actionInFlight = useRef(false);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const renderer = rendererRef.current ?? new Torus2DRenderer(svg, controller.size);
    rendererRef.current = renderer;
    renderer.render(viewModel);
  }, [controller, viewModel]);

  const applyResult = (result: TorusGameActionResult): void => {
    setViewModel(result.viewModel);
    setFeedback(result.accepted ? null : rejectionLabel(result.reason));
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

  const handleUndo = async (): Promise<void> => {
    if (actionInFlight.current) return;

    actionInFlight.current = true;
    try {
      applyResult(await controller.undo());
    } finally {
      actionInFlight.current = false;
    }
  };

  return (
    <section className="torus-game" aria-label="Torus 2D game">
      <div className="game-summary" aria-live="polite">
        <div className="turn-indicator">
          <span
            className={`stone-chip stone-chip--${viewModel.currentPlayer}`}
            aria-hidden="true"
          />
          <strong>{viewModel.currentPlayer === 'black' ? 'Black' : 'White'} to move</strong>
        </div>
        <div className="game-statistics">
          <span>Move {viewModel.moveNumber}</span>
          <span>Black captures {viewModel.captures.black}</span>
          <span>White captures {viewModel.captures.white}</span>
          <span>{viewModel.ruleSet === 'chinese' ? 'Chinese' : 'Japanese'} rules</span>
          <span>Komi {viewModel.komi}</span>
        </div>
      </div>

      <svg
        ref={svgRef}
        className="torus-board"
        onClick={(event) => void handleBoardClick(event)}
      />

      <div className="game-controls">
        <button
          type="button"
          onClick={() => void handleUndo()}
          disabled={viewModel.moveNumber === 0}
        >
          Undo
        </button>
        <p className="game-stage-note">
          Pass and manual endgame classification are intentionally deferred to the next UI stage.
        </p>
      </div>

      {feedback ? <p className="game-feedback">{feedback}</p> : null}
    </section>
  );
}
