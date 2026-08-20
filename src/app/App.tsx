import './new-game.css';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { RuleSet } from '../core/game/types';
import { TORUS_SIZES, type TorusSize } from '../core/topology/TorusTopology';
import { TorusGame } from './TorusGame';
import {
  TorusGameApplication,
  type SavedGameSummary,
} from './TorusGameApplication';
import type { TorusGameController } from './TorusGameController';

type AppScreen = 'loading' | 'resume' | 'settings' | 'game';

export function App() {
  const application = useMemo(() => new TorusGameApplication(), []);
  const [screen, setScreen] = useState<AppScreen>('loading');
  const [savedGame, setSavedGame] = useState<SavedGameSummary | null>(null);
  const [controller, setController] = useState<TorusGameController | null>(null);
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const [size, setSize] = useState<TorusSize>(9);
  const [ruleSet, setRuleSet] = useState<RuleSet>('chinese');
  const [komi, setKomi] = useState('7.5');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void application.findUnfinishedGame().then((summary) => {
      if (cancelled) return;
      setSavedGame(summary);
      setScreen(summary ? 'resume' : 'settings');
    });

    return () => {
      cancelled = true;
    };
  }, [application]);

  const continueSavedGame = async (): Promise<void> => {
    setScreen('loading');
    setError(null);
    const restored = await application.restoreUnfinishedGame();
    if (!restored) {
      setSavedGame(null);
      setScreen('settings');
      return;
    }

    setController(restored);
    setScreen('game');
  };

  const discardAndChooseSettings = async (): Promise<void> => {
    setError(null);
    try {
      await application.discardSavedGame();
      setController(null);
      setSavedGame(null);
      setConfirmNewGame(false);
      setScreen('settings');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset saved game.');
    }
  };

  const startNewGame = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    const parsedKomi = Number(komi);
    if (!Number.isFinite(parsedKomi)) {
      setError('Komi must be a finite number.');
      return;
    }

    try {
      const next = await application.createNewGame({ size, ruleSet, komi: parsedKomi });
      setController(next);
      setScreen('game');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start a new game.');
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="app-kicker">Game Cube Go · 0.1.17</p>
        <h1>GoCube</h1>
        <p>Torus 2D · local save/load · Chinese and Japanese scoring.</p>
      </header>

      {screen === 'loading' ? <p className="startup-status">Loading local game…</p> : null}

      {screen === 'resume' && savedGame ? (
        <section className="startup-card" aria-labelledby="resume-title">
          <h2 id="resume-title">Continue saved game?</h2>
          <p>
            {savedGame.size}×{savedGame.size} ·{' '}
            {savedGame.ruleSet === 'chinese' ? 'Chinese' : 'Japanese'} · Komi{' '}
            {savedGame.komi} · Move {savedGame.moveNumber}
          </p>
          <div className="startup-actions">
            <button type="button" onClick={() => void continueSavedGame()}>
              Continue
            </button>
            <button type="button" onClick={() => void discardAndChooseSettings()}>
              New game
            </button>
          </div>
        </section>
      ) : null}

      {screen === 'settings' ? (
        <form className="startup-card new-game-form" onSubmit={(event) => void startNewGame(event)}>
          <div>
            <h2>New game</h2>
            <p>Choose the board size, scoring rules, and komi.</p>
          </div>

          <label>
            Board size
            <select
              value={size}
              onChange={(event) => setSize(Number(event.target.value) as TorusSize)}
            >
              {TORUS_SIZES.map((option) => (
                <option value={option} key={option}>
                  {option}×{option}
                </option>
              ))}
            </select>
          </label>

          <label>
            Rules
            <select
              value={ruleSet}
              onChange={(event) => setRuleSet(event.target.value as RuleSet)}
            >
              <option value="chinese">Chinese</option>
              <option value="japanese">Japanese</option>
            </select>
          </label>

          <label>
            Komi
            <input
              type="number"
              step="any"
              value={komi}
              onChange={(event) => setKomi(event.target.value)}
            />
          </label>

          <button type="submit">Start game</button>
        </form>
      ) : null}

      {screen === 'game' && controller ? (
        <TorusGame controller={controller} onRequestNewGame={() => setConfirmNewGame(true)} />
      ) : null}

      {confirmNewGame ? (
        <div className="confirmation-backdrop" role="presentation">
          <section className="confirmation-card" role="dialog" aria-modal="true" aria-labelledby="new-game-confirm-title">
            <h2 id="new-game-confirm-title">Start a new game?</h2>
            <p>The current game and its local autosave will be discarded.</p>
            <div className="startup-actions">
              <button type="button" onClick={() => setConfirmNewGame(false)}>
                Cancel
              </button>
              <button type="button" onClick={() => void discardAndChooseSettings()}>
                Choose settings
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {error ? <p className="game-feedback">{error}</p> : null}
    </main>
  );
}
