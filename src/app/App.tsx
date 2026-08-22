import './new-game.css';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { RuleSet } from '../core/game/types';
import { TORUS_SIZES } from '../core/topology/TorusTopology';
import { CUBE_UI_SIZES } from './CubeGameConfig';
import { Cube2DGame } from './Cube2DGame';
import {
  GameApplication,
  type ActiveGame,
  type GameMode,
  type GameSize,
  type SavedGameSummary,
} from './GameApplication';
import { LocalStoragePreferencesStorage } from './persistence/LocalStoragePreferencesStorage';
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from './persistence/PreferencesStorage';
import { TorusGame } from './TorusGame';

type AppScreen = 'loading' | 'resume' | 'settings' | 'game';

const sizesForMode = (mode: GameMode): readonly GameSize[] =>
  mode === 'cube-2d' ? CUBE_UI_SIZES : TORUS_SIZES;

const defaultSizeForMode = (mode: GameMode): GameSize =>
  mode === 'cube-2d' ? 4 : 9;

const preferredSizeForMode = (
  mode: GameMode,
  preferences: UserPreferences,
): GameSize =>
  mode === 'cube-2d'
    ? preferences.lastCubeSize ?? defaultSizeForMode(mode)
    : preferences.lastTorusSize ?? defaultSizeForMode(mode);

const modeLabel = (mode: GameMode): string =>
  mode === 'cube-2d' ? 'Cube 2D' : 'Torus 2D';

const normalizeKomi = (value: number): number => Math.floor(value) + 0.5;

export function App() {
  const application = useMemo(() => new GameApplication(), []);
  const preferencesStorage = useMemo(() => new LocalStoragePreferencesStorage(), []);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [screen, setScreen] = useState<AppScreen>('loading');
  const [savedGame, setSavedGame] = useState<SavedGameSummary | null>(null);
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(null);
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('torus-2d');
  const [size, setSize] = useState<GameSize>(9);
  const [ruleSet, setRuleSet] = useState<RuleSet>('japanese');
  const [komi, setKomi] = useState('7.5');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      application.findSavedGame(),
      preferencesStorage.loadPreferences(),
    ]).then(([summary, storedPreferences]) => {
      if (cancelled) return;
      setPreferences(storedPreferences);
      setSize(preferredSizeForMode('torus-2d', storedPreferences));
      setSavedGame(summary);
      setScreen(summary ? 'resume' : 'settings');
    });

    return () => {
      cancelled = true;
    };
  }, [application, preferencesStorage]);

  const continueSavedGame = async (): Promise<void> => {
    setScreen('loading');
    setError(null);
    const restored = await application.restoreSavedGame();
    if (!restored) {
      setSavedGame(null);
      setScreen('settings');
      return;
    }

    setActiveGame(restored);
    setScreen('game');
  };

  const discardAndChooseSettings = async (): Promise<void> => {
    setError(null);
    try {
      await application.discardSavedGame();
      setActiveGame(null);
      setSavedGame(null);
      setConfirmNewGame(false);
      setGameMode('torus-2d');
      setSize(preferredSizeForMode('torus-2d', preferences));
      setRuleSet('japanese');
      setKomi('7.5');
      setScreen('settings');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset saved game.');
    }
  };

  const chooseMode = (nextMode: GameMode) => {
    setGameMode(nextMode);
    setSize(preferredSizeForMode(nextMode, preferences));
  };

  const startNewGame = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);

    const parsedKomi = Number(komi);
    if (!Number.isFinite(parsedKomi)) {
      setError('Komi must be a finite number.');
      return;
    }
    const normalizedKomi = normalizeKomi(parsedKomi);

    try {
      const next = await application.createNewGame({
        gameMode,
        size,
        ruleSet,
        komi: normalizedKomi,
      });

      const storedPreferences = await preferencesStorage
        .loadPreferences()
        .catch(() => preferences);
      const nextPreferences: UserPreferences = Object.freeze({
        ...storedPreferences,
        lastCubeSize:
          gameMode === 'cube-2d'
            ? (size as UserPreferences['lastCubeSize'])
            : storedPreferences.lastCubeSize,
        lastTorusSize:
          gameMode === 'torus-2d'
            ? (size as UserPreferences['lastTorusSize'])
            : storedPreferences.lastTorusSize,
      });
      setPreferences(nextPreferences);
      try {
        await preferencesStorage.savePreferences(nextPreferences);
      } catch {
        setError('Game started, but preferences could not be saved.');
      }

      setActiveGame(next);
      setScreen('game');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start a new game.');
    }
  };

  const sizes = sizesForMode(gameMode);

  return (
    <main className={`app-shell${screen === 'game' ? ' app-shell--game' : ''}`}>
      {screen !== 'game' ? (
        <header className="app-header">
          <p className="app-kicker">Game Cube Go · 0.2.0</p>
          <h1>GoCube</h1>
          <p>Two surface modes · local save/load · Chinese and Japanese scoring.</p>
        </header>
      ) : null}

      {screen === 'loading' ? <p className="startup-status">Loading local game…</p> : null}

      {screen === 'resume' && savedGame ? (
        <section className="startup-card" aria-labelledby="resume-title">
          <h2 id="resume-title">Continue saved game?</h2>
          <p>
            {modeLabel(savedGame.gameMode)} · {savedGame.size}×{savedGame.size} ·{' '}
            {savedGame.ruleSet === 'chinese' ? 'Chinese' : 'Japanese'} · Komi{' '}
            {savedGame.komi} · Move {savedGame.moveNumber}
            {savedGame.phase === 'finished' ? ' · Finished' : ''}
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
            <p>Choose the surface, board size, scoring rules, and komi.</p>
          </div>

          <fieldset className="board-size-fieldset surface-fieldset">
            <legend>Board</legend>
            <div className="board-size-options surface-options">
              {(['cube-2d', 'torus-2d'] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={gameMode === mode ? 'is-selected' : undefined}
                  aria-pressed={gameMode === mode}
                  onClick={() => chooseMode(mode)}
                >
                  {modeLabel(mode)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="board-size-fieldset">
            <legend>Board size</legend>
            <div className="board-size-options">
              {sizes.map((option) => (
                <button
                  type="button"
                  key={option}
                  className={size === option ? 'is-selected' : undefined}
                  aria-pressed={size === option}
                  onClick={() => setSize(option)}
                >
                  {option}×{option}
                </button>
              ))}
            </div>
            <select
              className="board-size-native-select"
              aria-label="Board size"
              value={size}
              onChange={(event) => setSize(Number(event.target.value) as GameSize)}
              tabIndex={-1}
            >
              {sizes.map((option) => (
                <option value={option} key={option}>
                  {option}×{option}
                </option>
              ))}
            </select>
          </fieldset>

          <label>
            Rules
            <select
              value={ruleSet}
              onChange={(event) => setRuleSet(event.target.value as RuleSet)}
            >
              <option value="japanese">Japanese</option>
              <option value="chinese">Chinese</option>
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

          <button className="start-game-button" type="submit">Start game</button>
        </form>
      ) : null}

      {screen === 'game' && activeGame?.gameMode === 'torus-2d' ? (
        <TorusGame
          controller={activeGame.controller}
          onRequestNewGame={() => setConfirmNewGame(true)}
        />
      ) : null}

      {screen === 'game' && activeGame?.gameMode === 'cube-2d' ? (
        <Cube2DGame
          controller={activeGame.controller}
          onRequestNewGame={() => setConfirmNewGame(true)}
        />
      ) : null}

      {confirmNewGame ? (
        <div className="confirmation-backdrop" role="presentation">
          <section
            className="confirmation-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-game-confirm-title"
          >
            <h2 id="new-game-confirm-title">Start a new game?</h2>
            <p>The current game and its local autosave will be discarded.</p>
            <div className="startup-actions">
              <button type="button" onClick={() => setConfirmNewGame(false)}>
                Cancel
              </button>
              <button type="button" onClick={() => void discardAndChooseSettings()}>
                New Game
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {error ? <p className="game-feedback">{error}</p> : null}
    </main>
  );
}
