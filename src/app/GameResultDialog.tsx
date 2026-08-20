import { useEffect, useRef } from 'react';
import type { GameResultViewModel } from '../presentation/GameResultModel';
import './result-dialog.css';

export interface GameResultDialogProps {
  readonly result: GameResultViewModel;
  readonly onClose: () => void;
}

const winnerLabel = (result: GameResultViewModel): string => {
  const { score } = result;
  if (score.winner === 'draw') return 'Draw';
  return `${score.winner === 'black' ? 'Black' : 'White'} wins by ${score.margin}`;
};

const rulesLabel = (result: GameResultViewModel): string =>
  result.statistics.ruleSet === 'chinese' ? 'Chinese' : 'Japanese';

const groupCount = (value: number | undefined): string =>
  value === undefined ? '—' : String(value);

export function GameResultDialog({ result, onClose }: GameResultDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const { score, statistics } = result;

  useEffect(() => {
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const prisoners = score.prisoners ?? { black: 0, white: 0 };
  const chineseArea = {
    black: score.stonesOnBoard.black + score.territory.black,
    white: score.stonesOnBoard.white + score.territory.white,
  };
  const japaneseSubtotal = {
    black: score.territory.black + prisoners.black,
    white: score.territory.white + prisoners.white,
  };

  return (
    <div className="result-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="result-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-result-title"
        tabIndex={-1}
      >
        <header className="result-dialog__header">
          <div>
            <p className="result-dialog__eyebrow">Final result</p>
            <h2 id="game-result-title">{winnerLabel(result)}</h2>
            <p>
              Black {score.black} · White {score.white}
            </p>
          </div>
          <button
            className="result-dialog__close"
            type="button"
            aria-label="Close game result"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <section className="result-dialog__section" aria-labelledby="score-breakdown-title">
          <h3 id="score-breakdown-title">Score breakdown</h3>
          <div className="result-score-table" role="table" aria-label="Final score breakdown">
            <div className="result-score-table__row result-score-table__header" role="row">
              <span role="columnheader">Component</span>
              <strong role="columnheader">Black</strong>
              <strong role="columnheader">White</strong>
            </div>

            {score.ruleSet === 'chinese' ? (
              <>
                <div className="result-score-table__row" role="row">
                  <span role="cell">Stones on board</span>
                  <span role="cell">{score.stonesOnBoard.black}</span>
                  <span role="cell">{score.stonesOnBoard.white}</span>
                </div>
                <div className="result-score-table__row" role="row">
                  <span role="cell">Territory</span>
                  <span role="cell">{score.territory.black}</span>
                  <span role="cell">{score.territory.white}</span>
                </div>
                <div className="result-score-table__row" role="row">
                  <span role="cell">Area subtotal</span>
                  <span role="cell">{chineseArea.black}</span>
                  <span role="cell">{chineseArea.white}</span>
                </div>
              </>
            ) : (
              <>
                <div className="result-score-table__row" role="row">
                  <span role="cell">Territory</span>
                  <span role="cell">{score.territory.black}</span>
                  <span role="cell">{score.territory.white}</span>
                </div>
                <div className="result-score-table__row" role="row">
                  <span role="cell">Prisoners</span>
                  <span role="cell">{prisoners.black}</span>
                  <span role="cell">{prisoners.white}</span>
                </div>
                <div className="result-score-table__row" role="row">
                  <span role="cell">Subtotal</span>
                  <span role="cell">{japaneseSubtotal.black}</span>
                  <span role="cell">{japaneseSubtotal.white}</span>
                </div>
              </>
            )}

            <div className="result-score-table__row" role="row">
              <span role="cell">Komi</span>
              <span role="cell">0</span>
              <span role="cell">{score.komi}</span>
            </div>
            <div className="result-score-table__row result-score-table__total" role="row">
              <strong role="cell">Final score</strong>
              <strong role="cell">{score.black}</strong>
              <strong role="cell">{score.white}</strong>
            </div>
          </div>
          {score.ruleSet === 'chinese' ? (
            <p className="result-dialog__note">
              Captures are shown below as match statistics and are not added again to Chinese area scoring.
            </p>
          ) : null}
        </section>

        <section className="result-dialog__section" aria-labelledby="match-statistics-title">
          <h3 id="match-statistics-title">Game statistics</h3>
          <dl className="result-statistics-grid">
            <div>
              <dt>Actions</dt>
              <dd>{statistics.totalActions}</dd>
            </div>
            <div>
              <dt>Passes</dt>
              <dd>{statistics.passes}</dd>
            </div>
            <div>
              <dt>Board</dt>
              <dd>{statistics.boardSize ? `${statistics.boardSize}×${statistics.boardSize}` : '—'}</dd>
            </div>
            <div>
              <dt>Rules</dt>
              <dd>{rulesLabel(result)}</dd>
            </div>
            <div>
              <dt>White stones captured by Black</dt>
              <dd>{statistics.captures.black}</dd>
            </div>
            <div>
              <dt>Black stones captured by White</dt>
              <dd>{statistics.captures.white}</dd>
            </div>
            <div>
              <dt>Dead Black stones</dt>
              <dd>{statistics.deadStones.black}</dd>
            </div>
            <div>
              <dt>Dead White stones</dt>
              <dd>{statistics.deadStones.white}</dd>
            </div>
            <div>
              <dt>Dead Black groups</dt>
              <dd>{groupCount(statistics.deadGroups?.black)}</dd>
            </div>
            <div>
              <dt>Dead White groups</dt>
              <dd>{groupCount(statistics.deadGroups?.white)}</dd>
            </div>
          </dl>
        </section>

        <footer className="result-dialog__footer">
          <button type="button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
