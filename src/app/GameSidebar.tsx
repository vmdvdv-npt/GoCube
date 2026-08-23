import { useEffect, useMemo, type ReactNode } from 'react';
import type { GameViewModel } from '../presentation/PresentationModel';
import type { ReferenceStatus } from '../core/endgame/testlab/TestCase';
import { useLiveTestGeneratorControls } from './LiveTestGeneratorContext';
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

const referenceStatusLabel = (status: ReferenceStatus): string => {
  switch (status) {
    case 'alive':
      return 'Alive';
    case 'dead':
      return 'Dead';
    case 'seki':
      return 'Seki';
    case 'unresolved':
      return 'Unresolved';
    case 'unstable':
      return 'Unstable';
    case 'unavailable':
      return 'Unavailable';
    case 'unknown':
      return 'Unknown';
  }
};

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
  const developerGeneration = useLiveTestGeneratorControls();
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
        {!duplicateRegionsDisabled ? (
          <label>
            <input
              type="checkbox"
              checked={showDuplicateRegions}
              onChange={(event) => handleDuplicateRegionsChange(event.target.checked)}
            />
            Показывать дублирующие области
          </label>
        ) : null}
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
        {developerGeneration ? (
          <section
            className="live-test-generator-controls"
            data-testid="live-test-generator-controls"
            aria-label="Developer test cases"
          >
            <strong>Test cases</strong>
            <div className="live-test-generator-actions live-test-generator-actions--three">
              <button
                type="button"
                onClick={developerGeneration.onGenerateGame}
                disabled={developerGeneration.busy}
              >
                Generate game
              </button>
              <button
                type="button"
                onClick={developerGeneration.onGenerateEndgame}
                disabled={developerGeneration.busy}
              >
                Generate endgame
              </button>
              <button
                type="button"
                onClick={developerGeneration.onGenerateCorpus}
                disabled={developerGeneration.busy}
              >
                AI-verified case
              </button>
            </div>

            <label className="live-test-id-control">
              <span>Test ID</span>
              <input
                aria-label="Test ID"
                inputMode="numeric"
                pattern="[0-9]*"
                value={developerGeneration.testIdInput}
                onChange={(event) => developerGeneration.onTestIdInputChange(event.target.value)}
                placeholder="Test ID"
                disabled={developerGeneration.busy}
              />
              <button
                type="button"
                onClick={developerGeneration.onLoadTestId}
                disabled={developerGeneration.busy || developerGeneration.testIdInput.trim().length === 0}
              >
                Load
              </button>
            </label>

            <p className="live-test-generator-current" aria-live="polite">
              Current Test ID: {developerGeneration.current?.testId ?? '—'}
            </p>
            {developerGeneration.current ? (
              <p className="live-test-generator-current">
                {developerGeneration.current.identity.source === 'game-like'
                  ? 'Game-like'
                  : developerGeneration.current.identity.source === 'synthetic-endgame'
                    ? `Synthetic · ${developerGeneration.current.scenario}`
                    : `Corpus · ${developerGeneration.current.scenario}`}
              </p>
            ) : null}

            {developerGeneration.current?.diagnostics ? (
              <div className="live-test-diagnostics" aria-label="Differential results">
                <span>Source: {referenceStatusLabel(developerGeneration.current.diagnostics.sourceStatus)}</span>
                <span>KataGo: {referenceStatusLabel(developerGeneration.current.diagnostics.kataGoStatus)}</span>
                <span>Cube Go: {referenceStatusLabel(developerGeneration.current.diagnostics.cubeGoStatus)}</span>
                {developerGeneration.current.diagnostics.attention ? (
                  <strong className="live-test-diagnostics__mismatch">MISMATCH / REVIEW</strong>
                ) : null}
              </div>
            ) : null}

            {developerGeneration.feedback ? (
              <p className="live-test-generator-feedback" role="status">
                {developerGeneration.feedback}
              </p>
            ) : null}
          </section>
        ) : null}

        <button
          className="pass-control"
          type="button"
          onClick={onPass}
          disabled={passDisabled}
        >
          {viewModel.phase === 'playing' && viewModel.consecutivePasses === 1 ? 'Pass (1)' : 'Pass'}
        </button>
        <div className="history-controls" role="group" aria-label="Move history controls">
          <button type="button" onClick={onRedo} disabled={!canRedo}>
            Redo
          </button>
          <button type="button" onClick={onUndo} disabled={!canUndo}>
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
          disabled={newGameDisabled}
        >
          New game
        </button>
      </div>

      {feedback ? <p className="game-feedback">{feedback}</p> : null}
    </>
  );
}
