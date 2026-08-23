import './new-game.css';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { externalCorpusCaseCount } from '../core/endgame/testlab/ExternalCorpusImporter';
import type { ReplayableTestCase, TestCaseSource } from '../core/endgame/testlab/TestCase';
import type { RuleSet } from '../core/game/types';
import { TORUS_SIZES } from '../core/topology/TorusTopology';
import { CUBE_UI_SIZES } from './CubeGameConfig';
import { Cube2DGame } from './Cube2DGame';
import {
  GameApplication,
  type ActiveGame,
  type GameMode,
  type GameSize,
  type NewGameSettings,
  type SavedGameSummary,
  type TestCaseActiveGame,
} from './GameApplication';
import {
  LiveTestGeneratorProvider,
  type LiveTestGeneratorControls,
} from './LiveTestGeneratorContext';
import { LocalStoragePreferencesStorage } from './persistence/LocalStoragePreferencesStorage';
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from './persistence/PreferencesStorage';
import { TorusGame } from './TorusGame';

declare const __BUILD_PR__: string;

type AppScreen = 'loading' | 'resume' | 'settings' | 'game';
type TopologyPreviewDirection = 'left' | 'right';
type TopologyPreviewTransition = Readonly<{
  id: number;
  from: GameMode;
  to: GameMode;
  direction: TopologyPreviewDirection;
}>;

const DEFAULT_KOMI = 7.5;
const LIVE_TEST_CONTROLS_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_LIVE_TEST_GENERATORS === '1';
let fallbackRandomCounter = 0;

const sizesForMode = (mode: GameMode): readonly GameSize[] =>
  mode === 'cube-2d' ? CUBE_UI_SIZES : TORUS_SIZES;

const defaultSizeForMode = (mode: GameMode): GameSize =>
  mode === 'cube-2d' ? 4 : 9;

const preferredGameMode = (preferences: UserPreferences): GameMode =>
  preferences.lastGameMode ?? 'torus-2d';

const preferredSizeForMode = (
  mode: GameMode,
  preferences: UserPreferences,
): GameSize =>
  mode === 'cube-2d'
    ? preferences.lastCubeSize ?? defaultSizeForMode(mode)
    : preferences.lastTorusSize ?? defaultSizeForMode(mode);

const preferredKomi = (preferences: UserPreferences): number =>
  preferences.lastKomi ?? DEFAULT_KOMI;

const modeLabel = (mode: GameMode): string =>
  mode === 'cube-2d' ? 'Cube 2D' : 'Torus 2D';

const topologyLabel = (mode: GameMode): string =>
  mode === 'cube-2d' ? 'Cube' : 'Torus';

const topologyPreviewSrc = (mode: GameMode): string =>
  mode === 'cube-2d' ? '/assets/board/cube.svg' : '/assets/board/torus.svg';

const topologyPreviewAlt = (mode: GameMode): string =>
  `${mode === 'cube-2d' ? 'Cube' : 'Torus'} topology preview`;

const normalizeKomi = (value: number): number => Math.floor(value) + 0.5;

const randomUint32 = (): number => {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const words = new Uint32Array(1);
    globalThis.crypto.getRandomValues(words);
    return words[0] ?? 0;
  }

  fallbackRandomCounter += 1;
  return (Date.now() + fallbackRandomCounter) >>> 0;
};

const settingsForActiveGame = (activeGame: ActiveGame): NewGameSettings => {
  const view = activeGame.controller.viewModel();
  return Object.freeze({
    gameMode: activeGame.gameMode,
    size: activeGame.controller.size as GameSize,
    ruleSet: view.ruleSet,
    komi: view.komi,
  });
};

export function App() {
  const application = useMemo(() => new GameApplication(), []);
  const preferencesStorage = useMemo(() => new LocalStoragePreferencesStorage(), []);
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_USER_PREFERENCES);
  const [screen, setScreen] = useState<AppScreen>('loading');
  const [savedGame, setSavedGame] = useState<SavedGameSummary | null>(null);
  const [activeGame, setActiveGame] = useState<ActiveGame | null>(null);
  const [gameInstanceKey, setGameInstanceKey] = useState(0);
  const [confirmNewGame, setConfirmNewGame] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('torus-2d');
  const [topologyPreviewTransition, setTopologyPreviewTransition] =
    useState<TopologyPreviewTransition | null>(null);
  const topologyPreviewTargetRef = useRef<GameMode>('torus-2d');
  const topologyPreviewTransitionIdRef = useRef(0);
  const [size, setSize] = useState<GameSize>(9);
  const [ruleSet, setRuleSet] = useState<RuleSet>('japanese');
  const [komi, setKomi] = useState(String(DEFAULT_KOMI));
  const [error, setError] = useState<string | null>(null);
  const [currentTestCase, setCurrentTestCase] = useState<ReplayableTestCase | null>(null);
  const [testIdInput, setTestIdInput] = useState('');
  const [testCaseBusy, setTestCaseBusy] = useState(false);
  const [testCaseFeedback, setTestCaseFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      application.findSavedGame(),
      preferencesStorage.loadPreferences(),
    ]).then(([summary, storedPreferences]) => {
      if (cancelled) return;
      const hydratedPreferences: UserPreferences =
        storedPreferences.lastGameMode === null && summary
          ? Object.freeze({ ...storedPreferences, lastGameMode: summary.gameMode })
          : storedPreferences;
      const initialGameMode = preferredGameMode(hydratedPreferences);
      setPreferences(hydratedPreferences);
      topologyPreviewTargetRef.current = initialGameMode;
      setTopologyPreviewTransition(null);
      setGameMode(initialGameMode);
      setSize(preferredSizeForMode(initialGameMode, hydratedPreferences));
      setKomi(String(preferredKomi(hydratedPreferences)));
      setSavedGame(summary);
      setScreen(summary ? 'resume' : 'settings');
    });

    return () => {
      cancelled = true;
    };
  }, [application, preferencesStorage]);

  const resetTestCaseState = (): void => {
    setCurrentTestCase(null);
    setTestIdInput('');
    setTestCaseFeedback(null);
    setTestCaseBusy(false);
  };

  const continueSavedGame = async (): Promise<void> => {
    setScreen('loading');
    setError(null);
    const restored = await application.restoreSavedGame();
    if (!restored) {
      setSavedGame(null);
      setScreen('settings');
      return;
    }

    resetTestCaseState();
    setActiveGame(restored);
    setGameInstanceKey((current) => current + 1);
    setScreen('game');
  };

  const discardAndChooseSettings = async (): Promise<void> => {
    setError(null);
    try {
      await application.discardSavedGame();
      const nextGameMode = preferredGameMode(preferences);
      resetTestCaseState();
      setActiveGame(null);
      setSavedGame(null);
      setConfirmNewGame(false);
      topologyPreviewTargetRef.current = nextGameMode;
      setTopologyPreviewTransition(null);
      setGameMode(nextGameMode);
      setSize(preferredSizeForMode(nextGameMode, preferences));
      setRuleSet('japanese');
      setKomi(String(preferredKomi(preferences)));
      setScreen('settings');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reset saved game.');
    }
  };

  const chooseMode = (nextMode: GameMode) => {
    const fromMode = topologyPreviewTargetRef.current;
    if (fromMode === nextMode) return;

    topologyPreviewTargetRef.current = nextMode;
    const transitionId = ++topologyPreviewTransitionIdRef.current;
    setTopologyPreviewTransition({
      id: transitionId,
      from: fromMode,
      to: nextMode,
      direction: nextMode === 'torus-2d' ? 'left' : 'right',
    });
    setGameMode(nextMode);
    setSize(preferredSizeForMode(nextMode, preferences));
  };

  const finishTopologyPreviewTransition = (transitionId: number) => {
    setTopologyPreviewTransition((current) =>
      current?.id === transitionId ? null : current,
    );
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
        lastGameMode: gameMode,
        lastCubeSize:
          gameMode === 'cube-2d'
            ? (size as UserPreferences['lastCubeSize'])
            : storedPreferences.lastCubeSize,
        lastTorusSize:
          gameMode === 'torus-2d'
            ? (size as UserPreferences['lastTorusSize'])
            : storedPreferences.lastTorusSize,
        lastKomi: normalizedKomi,
      });
      setPreferences(nextPreferences);
      try {
        await preferencesStorage.savePreferences(nextPreferences);
      } catch {
        setError('Game started, but preferences could not be saved.');
      }

      resetTestCaseState();
      setActiveGame(next);
      setGameInstanceKey((current) => current + 1);
      setScreen('game');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start a new game.');
    }
  };

  const applyTestCase = (loaded: TestCaseActiveGame): void => {
    setActiveGame(loaded.activeGame);
    setCurrentTestCase(loaded.testCase);
    setTestIdInput(loaded.testCase.testId);
    setGameInstanceKey((current) => current + 1);
    const diagnostics = loaded.testCase.diagnostics;
    setTestCaseFeedback(
      diagnostics?.attention
        ? diagnostics.attentionReason ?? 'This differential case requires review.'
        : diagnostics
          ? 'Source / KataGo / Cube Go diagnostics have no detected mismatch.'
          : `${loaded.testCase.scenario} loaded.`,
    );
  };

  const generateTestCase = async (
    source: Exclude<TestCaseSource, 'corpus'>,
  ): Promise<void> => {
    if (!activeGame || testCaseBusy) return;
    setTestCaseBusy(true);
    setTestCaseFeedback(null);
    try {
      applyTestCase(
        await application.createGeneratedTestCase(
          settingsForActiveGame(activeGame),
          source,
          randomUint32(),
        ),
      );
    } catch (caught) {
      setTestCaseFeedback(
        caught instanceof Error ? caught.message : 'Could not generate test case.',
      );
    } finally {
      setTestCaseBusy(false);
    }
  };

  const generateCorpusTestCase = async (): Promise<void> => {
    if (!activeGame || testCaseBusy) return;
    setTestCaseBusy(true);
    setTestCaseFeedback(null);
    try {
      const catalogCount = externalCorpusCaseCount();
      if (catalogCount < 1) throw new Error('No eligible external corpus cases are installed.');
      const catalogIndex = randomUint32() % catalogCount;
      const transformCount = activeGame.gameMode === 'cube-2d' ? 48 : 8;
      const transform = randomUint32() % transformCount;
      applyTestCase(
        await application.createCorpusTestCase(
          settingsForActiveGame(activeGame),
          catalogIndex,
          transform,
        ),
      );
    } catch (caught) {
      setTestCaseFeedback(
        caught instanceof Error ? caught.message : 'Could not load an AI-verified corpus case.',
      );
    } finally {
      setTestCaseBusy(false);
    }
  };

  const loadTestId = async (): Promise<void> => {
    if (!activeGame || testCaseBusy) return;
    const normalized = testIdInput.trim();
    if (normalized.length === 0) return;
    setTestCaseBusy(true);
    setTestCaseFeedback(null);
    try {
      const view = activeGame.controller.viewModel();
      applyTestCase(
        await application.loadTestCaseById(normalized, {
          ruleSet: view.ruleSet,
          komi: view.komi,
        }),
      );
    } catch (caught) {
      setTestCaseFeedback(caught instanceof Error ? caught.message : 'Could not load Test ID.');
    } finally {
      setTestCaseBusy(false);
    }
  };

  const liveTestControls: LiveTestGeneratorControls | null =
    LIVE_TEST_CONTROLS_ENABLED && screen === 'game' && activeGame
      ? Object.freeze({
          current: currentTestCase,
          testIdInput,
          busy: testCaseBusy,
          feedback: testCaseFeedback,
          onTestIdInputChange: setTestIdInput,
          onGenerateGame: () => void generateTestCase('game-like'),
          onGenerateEndgame: () => void generateTestCase('synthetic-endgame'),
          onGenerateCorpus: () => void generateCorpusTestCase(),
          onLoadTestId: () => void loadTestId(),
        })
      : null;

  const sizes = sizesForMode(gameMode);

  return (
    <LiveTestGeneratorProvider value={liveTestControls}>
      <main className={`app-shell${screen === 'game' ? ' app-shell--game' : ''}`}>
        {screen !== 'game' ? (
          <header className="app-header">
            <p className="app-kicker">Game Cube Go · 0.2.0 · {__BUILD_PR__}</p>
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
            <div className="new-game-settings-grid" data-testid="new-game-settings-grid">
              <fieldset
                className="board-size-fieldset surface-fieldset new-game-settings-column new-game-settings-column--shape"
                data-testid="new-game-shape-column"
                aria-label="Board Shape"
              >
                <div className="topology-preview" data-testid="topology-preview">
                  {topologyPreviewTransition ? (
                    <>
                      <img
                        className={`topology-preview__image topology-preview__image--exit-${topologyPreviewTransition.direction}`}
                        src={topologyPreviewSrc(topologyPreviewTransition.from)}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                      />
                      <img
                        key={topologyPreviewTransition.id}
                        className={`topology-preview__image topology-preview__image--enter-from-${topologyPreviewTransition.direction === 'left' ? 'right' : 'left'}`}
                        data-testid="topology-preview-image"
                        src={topologyPreviewSrc(topologyPreviewTransition.to)}
                        alt={topologyPreviewAlt(topologyPreviewTransition.to)}
                        draggable={false}
                        onAnimationEnd={() =>
                          finishTopologyPreviewTransition(topologyPreviewTransition.id)
                        }
                      />
                    </>
                  ) : (
                    <img
                      className="topology-preview__image"
                      data-testid="topology-preview-image"
                      src={topologyPreviewSrc(gameMode)}
                      alt={topologyPreviewAlt(gameMode)}
                      draggable={false}
                    />
                  )}
                </div>
                <span className="new-game-control-label">Board Shape</span>
                <div className="board-size-options surface-options">
                  {(['cube-2d', 'torus-2d'] as const).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      className={gameMode === mode ? 'is-selected' : undefined}
                      aria-pressed={gameMode === mode}
                      onClick={() => chooseMode(mode)}
                    >
                      {topologyLabel(mode)}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div
                className="new-game-column-divider"
                data-testid="new-game-column-divider"
                aria-hidden="true"
              />

              <div
                className="new-game-settings-column new-game-settings-column--details"
                data-testid="new-game-details-column"
              >
                <fieldset className="board-size-fieldset">
                  <legend>Board Size</legend>
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

                <div className="new-game-rules-komi">
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
                </div>

                <button className="start-game-button" type="submit">Start game</button>
              </div>
            </div>
          </form>
        ) : null}

        {screen === 'game' && activeGame?.gameMode === 'torus-2d' ? (
          <TorusGame
            key={`torus-${String(gameInstanceKey)}`}
            controller={activeGame.controller}
            onRequestNewGame={() => setConfirmNewGame(true)}
          />
        ) : null}

        {screen === 'game' && activeGame?.gameMode === 'cube-2d' ? (
          <Cube2DGame
            key={`cube-${String(gameInstanceKey)}`}
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
    </LiveTestGeneratorProvider>
  );
}
