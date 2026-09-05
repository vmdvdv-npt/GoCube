import { useEffect, useState, type ReactNode } from 'react';
import type { FinalProofSearchProgress } from '../core/endgame/FinalProofSearch';
import type { FinalProofSearchProgressSource } from '../core/endgame/FinalProofSearchRunController';
import type { GameViewModel } from '../presentation/PresentationModel';

export interface GameSidebarProps {
  readonly size: number;
  readonly viewModel: GameViewModel;
  readonly showMoveNumbers: boolean;
  readonly onShowMoveNumbersChange: (visible: boolean) => void;
  /** Legacy renderer plumbing retained for caller compatibility; not exposed by the main UI. */
  readonly showDuplicateRegions?: boolean;
  readonly onShowDuplicateRegionsChange?: (visible: boolean) => void;
  readonly duplicateRegionsDisabled?: boolean;
  readonly passDisabled: boolean;
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly onPass: () => void;
  readonly onRedo: () => void;
  readonly onUndo: () => void;
  readonly gameResultAvailable: boolean;
  readonly onOpenGameResult: () => void;
  readonly onRequestNewGame: () => void;
  readonly newGameDisabled?: boolean;
  readonly endgame?: ReactNode;
  readonly feedback?: string | null;
  readonly finalAnalysisProgressSource?: FinalProofSearchProgressSource;
}

export function GameSidebar({
  size,
  viewModel,
  showMoveNumbers,
  onShowMoveNumbersChange,
  passDisabled,
  canRedo,
  canUndo,
  onPass,
  onRedo,
  onUndo,
  gameResultAvailable,
  onOpenGameResult,
  onRequestNewGame,
  newGameDisabled = false,
  endgame = null,
  feedback = null,
  finalAnalysisProgressSource,
}: GameSidebarProps) {
  const [finalAnalysisProgress, setFinalAnalysisProgress] = useState<FinalProofSearchProgress | null>(
    () => finalAnalysisProgressSource?.current() ?? null,
  );

  useEffect(() => {
    setFinalAnalysisProgress(finalAnalysisProgressSource?.current() ?? null);
    if (!finalAnalysisProgressSource) return undefined;
    return finalAnalysisProgressSource.subscribe(setFinalAnalysisProgress);
  }, [finalAnalysisProgressSource]);

  const stageLabel = finalAnalysisProgress
    ? 'Analyzing final position…'
    : viewModel.phase === 'playing'
      ? `${viewModel.currentPlayer === 'black' ? 'Black' : 'White'} to move`
      : viewModel.phase === 'endgame'
        ? 'Classify groups'
        : 'Game finished';

  const analysisDetail = finalAnalysisProgress
    ? finalAnalysisProgress.groupsTotal > 0
      ? `Analyzed ${finalAnalysisProgress.groupsCompleted} of ${finalAnalysisProgress.groupsTotal} groups · ${finalAnalysisProgress.currentTierName.replaceAll('-', ' ')} · ${finalAnalysisProgress.exploredNodes.toLocaleString()} nodes`
      : 'Static proofs resolved the position; final verification is completing.'
    : null;

  return (
    <>
      <div className="game-summary" aria-live="polite">
        <div className="turn-indicator">
          {viewModel.phase === 'playing' && !finalAnalysisProgress ? (
            <span className={`stone-chip stone-chip--${viewModel.currentPlayer}`} aria-hidden="true" />
          ) : null}
          <strong>{stageLabel}</strong>
        </div>
        <div className="game-statistics">
          <span>{size}×{size}</span>
          <span>Move {viewModel.moveNumber}</span>
          <span className="capture-stat capture-stat--black" aria-label={`Black stones captured: ${viewModel.captures.white}`}>
            <i className="capture-stat__stone capture-stat__stone--black" aria-hidden="true" />
            <strong className="capture-stat__count">{viewModel.captures.white}</strong>
          </span>
          <span className="capture-stat capture-stat--white" aria-label={`White stones captured: ${viewModel.captures.black}`}>
            <i className="capture-stat__stone capture-stat__stone--white" aria-hidden="true" />
            <strong className="capture-stat__count">{viewModel.captures.black}</strong>
          </span>
          <span>{viewModel.ruleSet === 'chinese' ? 'Chinese' : 'Japanese'} rules</span>
          <span>Komi {viewModel.komi}</span>
        </div>
      </div>

      <div className="torus-duplicates-control" role="group" aria-label="Board display options">
        <label>
          <input type="checkbox" checked={showMoveNumbers} onChange={(event) => onShowMoveNumbersChange(event.target.checked)} />
          Show move number
        </label>
      </div>

      {analysisDetail ? (
        <p className="game-feedback final-proof-progress" role="status" aria-live="polite">
          {analysisDetail}
        </p>
      ) : null}

      {endgame}

      <div className="game-controls">
        <button className="pass-control" type="button" onClick={onPass} disabled={passDisabled || Boolean(finalAnalysisProgress)}>
          {viewModel.phase === 'playing' && viewModel.consecutivePasses === 1 ? 'Pass (1)' : 'Pass'}
        </button>
        <div className="history-controls" role="group" aria-label="Move history controls">
          <button type="button" onClick={onRedo} disabled={!canRedo || Boolean(finalAnalysisProgress)}>Redo</button>
          <button type="button" onClick={onUndo} disabled={!canUndo || Boolean(finalAnalysisProgress)}>Undo</button>
        </div>
        {gameResultAvailable ? (
          <button className="game-result-control" type="button" onClick={onOpenGameResult}>Game result</button>
        ) : null}
        <button className="new-game-control" type="button" onClick={onRequestNewGame} disabled={newGameDisabled || Boolean(finalAnalysisProgress)}>
          New game
        </button>
      </div>

      {feedback ? <p className="game-feedback">{feedback}</p> : null}
    </>
  );
}
