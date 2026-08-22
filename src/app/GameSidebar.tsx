import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GameViewModel } from '../presentation/PresentationModel';
import { LocalStoragePreferencesStorage } from './persistence/LocalStoragePreferencesStorage';

export interface GameSidebarProps {
  readonly size: number;
  readonly viewModel: GameViewModel;
  readonly showMoveNumbers: boolean;
  readonly onShowMoveNumbersChange: (visible: boolean) => void;
  readonly showDuplicateRegions: boolean;
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
}

export function GameSidebar({
  size,
  viewModel,
  showMoveNumbers,
  onShowMoveNumbersChange,
  showDuplicateRegions,
  onShowDuplicateRegionsChange,
  duplicateRegionsDisabled = false,
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
}: GameSidebarProps) {
  const preferencesStorage = useMemo(() => new LocalStoragePreferencesStorage(), []);
  const [torusNavigationBusy, setTorusNavigationBusy] = useState(false);
  const stageLabel =
    viewModel.phase === 'playing'
      ? `${viewModel.currentPlayer === 'black' ? 'Black' : 'White'} to move`
      : viewModel.phase === 'endgame'
        ? 'Classify groups'
        : 'Game finished';

  useEffect(() => {
    if (duplicateRegionsDisabled || !onShowDuplicateRegionsChange) return;

    let cancelled = false;
    void preferencesStorage.loadPreferences().then((preferences) => {
      if (!cancelled) {
        onShowDuplicateRegionsChange(preferences.showTorusDuplicateRegions);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    duplicateRegionsDisabled,
    onShowDuplicateRegionsChange,
    preferencesStorage,
  ]);

  useEffect(() => {
    const board = document.querySelector<SVGSVGElement>('.torus-game .torus-board');
    if (!board) {
      setTorusNavigationBusy(false);
      return;
    }

    const syncNavigationState = (): void => {
      setTorusNavigationBusy(board.getAttribute('data-navigation-busy') === 'true');
    };
    syncNavigationState();

    const Observer = board.ownerDocument.defaultView?.MutationObserver;
    if (!Observer) return;

    const observer = new Observer(syncNavigationState);
    observer.observe(board, {
      attributes: true,
      attributeFilter: ['data-navigation-busy'],
    });
    return () => observer.disconnect();
  }, []);

  const handleDuplicateRegionsChange = (visible: boolean): void => {
    onShowDuplicateRegionsChange?.(visible);
    void preferencesStorage
      .loadPreferences()
      .then((current) =>
        preferencesStorage.savePreferences(
          Object.freeze({
            ...current,
            showTorusDuplicateRegions: visible,
          }),
        ),
      )
      .catch(() => {
        // A preference write failure must not block or revert the active game view.
      });
  };

  return (
    <>
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
          <span>{size}×{size}</span>
          <span>Move {viewModel.moveNumber}</span>
          <span
            className="capture-stat capture-stat--black"
            aria-label={`Black stones captured: ${viewModel.captures.white}`}
          >
            <i className="capture-stat__stone capture-stat__stone--black" aria-hidden="true" />
            <strong className="capture-stat__count">{viewModel.captures.white}</strong>
          </span>
          <span
            className="capture-stat capture-stat--white"
            aria-label={`White stones captured: ${viewModel.captures.black}`}
          >
            <i className="capture-stat__stone capture-stat__stone--white" aria-hidden="true" />
            <strong className="capture-stat__count">{viewModel.captures.black}</strong>
          </span>
          <span>{viewModel.ruleSet === 'chinese' ? 'Chinese' : 'Japanese'} rules</span>
          <span>Komi {viewModel.komi}</span>
        </div>
      </div>

      <div className="torus-duplicates-control" role="group" aria-label="Board display options">
        <label>
          <input
            type="checkbox"
            checked={showDuplicateRegions}
            disabled={duplicateRegionsDisabled}
            onChange={(event) => handleDuplicateRegionsChange(event.target.checked)}
          />
          Показывать дублирующие области
        </label>
        <label>
          <input
            type="checkbox"
            checked={showMoveNumbers}
            onChange={(event) => onShowMoveNumbersChange(event.target.checked)}
          />
          Номера ходов
        </label>
      </div>

      {endgame}

      <div className="game-controls">
        <button
          className="pass-control"
          type="button"
          onClick={onPass}
          disabled={passDisabled || torusNavigationBusy}
        >
          {viewModel.phase === 'playing' && viewModel.consecutivePasses === 1 ? 'Pass (1)' : 'Pass'}
        </button>
        <div className="history-controls" role="group" aria-label="Move history controls">
          <button type="button" onClick={onRedo} disabled={!canRedo || torusNavigationBusy}>
            Redo
          </button>
          <button type="button" onClick={onUndo} disabled={!canUndo || torusNavigationBusy}>
            Undo
          </button>
        </div>
        {gameResultAvailable ? (
          <button className="game-result-control" type="button" onClick={onOpenGameResult}>
            Game result
          </button>
        ) : null}
        <button
          className="new-game-control"
          type="button"
          onClick={onRequestNewGame}
          disabled={newGameDisabled || torusNavigationBusy}
        >
          New game
        </button>
      </div>

      {feedback ? <p className="game-feedback">{feedback}</p> : null}
    </>
  );
}
