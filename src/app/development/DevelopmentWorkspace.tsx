import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnimationMode } from '../../presentation/AnimationMode';
import { Cube2DGame } from '../Cube2DGame';
import type { Cube2DGameActionResult } from '../Cube2DGameController';
import {
  type AlphaZeroCheckpointDescriptor,
  type AlphaZeroGateway,
  type AlphaZeroGeneratedGame,
  AlphaZeroGatewayError,
} from './AlphaZeroGateway';
import {
  DeveloperReplayCompatibilityError,
  DeveloperReplaySession,
} from './DeveloperReplaySession';
import { HttpAlphaZeroClient } from './HttpAlphaZeroClient';
import { ReplayControls, type ReplaySpeed } from './ReplayControls';
import './development-workspace.css';

export interface DevelopmentWorkspaceProps {
  readonly onBack: () => void;
  readonly gateway?: AlphaZeroGateway;
}

type ConnectionState = 'checking' | 'available' | 'unavailable';

type ExternalReplayAction = Readonly<{
  sequence: number;
  result: Cube2DGameActionResult;
}>;

type DevelopmentSettings = Readonly<{
  blackCheckpointId?: string;
  whiteCheckpointId?: string;
  mctsSimulations?: number;
}>;

const DEVELOPMENT_SETTINGS_KEY = 'gocube.development.alphazero.v1';

const readDevelopmentSettings = (): DevelopmentSettings => {
  try {
    const raw = window.localStorage.getItem(DEVELOPMENT_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(typeof parsed.blackCheckpointId === 'string'
        ? { blackCheckpointId: parsed.blackCheckpointId }
        : {}),
      ...(typeof parsed.whiteCheckpointId === 'string'
        ? { whiteCheckpointId: parsed.whiteCheckpointId }
        : {}),
      ...(Number.isSafeInteger(parsed.mctsSimulations) && Number(parsed.mctsSimulations) >= 1
        ? { mctsSimulations: Number(parsed.mctsSimulations) }
        : {}),
    };
  } catch {
    return {};
  }
};

const persistDevelopmentSettings = (patch: DevelopmentSettings): void => {
  try {
    const current = readDevelopmentSettings();
    window.localStorage.setItem(
      DEVELOPMENT_SETTINGS_KEY,
      JSON.stringify({ ...current, ...patch }),
    );
  } catch {
    // Development preferences are convenience only; storage failures must not block replay.
  }
};

const latestCubeCheckpoint = (
  checkpoints: readonly AlphaZeroCheckpointDescriptor[],
): AlphaZeroCheckpointDescriptor | undefined => {
  let latest: AlphaZeroCheckpointDescriptor | undefined;
  for (const checkpoint of checkpoints) {
    if (checkpoint.topology !== 'cube') continue;
    if (!latest || checkpoint.iteration > latest.iteration) latest = checkpoint;
  }
  return latest;
};

const checkpointLabel = (checkpoint: AlphaZeroCheckpointDescriptor): string =>
  `${checkpoint.runName} · iter ${checkpoint.iteration} · ${checkpoint.topology} ${checkpoint.size}×${checkpoint.size}`;

const checkpointCompatibilityError = (
  black: AlphaZeroCheckpointDescriptor | null,
  white: AlphaZeroCheckpointDescriptor | null,
): string | null => {
  if (!black || !white) return 'Select both Black and White checkpoints.';
  if (black.topology !== white.topology) return 'Checkpoint topology does not match.';
  if (black.size !== white.size) return 'Checkpoint board size does not match.';
  if (black.ruleSet !== white.ruleSet) return 'Checkpoint rules do not match.';
  if (black.komi !== white.komi) return 'Checkpoint komi does not match.';
  if (black.topology !== 'cube') return 'Development Workspace V1 replay currently requires Cube checkpoints.';
  return null;
};

const generatedGameCompatibilityError = (
  game: AlphaZeroGeneratedGame,
  black: AlphaZeroCheckpointDescriptor,
  white: AlphaZeroCheckpointDescriptor,
  requestedSims: number,
): string | null => {
  if (game.blackCheckpoint !== black.id) return 'Generated game Black checkpoint does not match the request.';
  if (game.whiteCheckpoint !== white.id) return 'Generated game White checkpoint does not match the request.';
  if (game.topology !== black.topology) return 'Generated game topology does not match the selected checkpoints.';
  if (game.size !== black.size) return 'Generated game size does not match the selected checkpoints.';
  if (game.ruleSet !== black.ruleSet) return 'Generated game rules do not match the selected checkpoints.';
  if (game.komi !== black.komi) return 'Generated game komi does not match the selected checkpoints.';
  if (game.mctsSimulations !== requestedSims) return 'Generated game MCTS simulation count does not match the request.';
  return null;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof DeveloperReplayCompatibilityError) return error.message;
  if (error instanceof AlphaZeroGatewayError) {
    if (error.message.includes('generation_busy')) {
      return 'AlphaZero is already generating another game. Wait for it to finish, or restart ./dev to cancel the old generation.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Development operation failed.';
};

export function DevelopmentWorkspace({ onBack, gateway: providedGateway }: DevelopmentWorkspaceProps) {
  const gateway = useMemo(() => providedGateway ?? new HttpAlphaZeroClient(), [providedGateway]);
  const initialSettingsRef = useRef<DevelopmentSettings | undefined>(undefined);
  if (initialSettingsRef.current === undefined) {
    initialSettingsRef.current = readDevelopmentSettings();
  }
  const initialSettings = initialSettingsRef.current;

  const [connection, setConnection] = useState<ConnectionState>('checking');
  const [serviceLabel, setServiceLabel] = useState('Checking AlphaZero…');
  const [checkpoints, setCheckpoints] = useState<readonly AlphaZeroCheckpointDescriptor[]>([]);
  const [blackCheckpointId, setBlackCheckpointId] = useState(initialSettings.blackCheckpointId ?? '');
  const [whiteCheckpointId, setWhiteCheckpointId] = useState(initialSettings.whiteCheckpointId ?? '');
  const [mctsSimulations, setMctsSimulations] = useState(initialSettings.mctsSimulations ?? 100);
  const [generating, setGenerating] = useState(false);
  const [replay, setReplay] = useState<DeveloperReplaySession | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [externalAction, setExternalAction] = useState<ExternalReplayAction | null>(null);
  const [seekAnimationDisabled, setSeekAnimationDisabled] = useState(false);
  const actionSequenceRef = useRef(0);
  const operationInFlightRef = useRef(false);

  const blackCheckpoint = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.id === blackCheckpointId) ?? null,
    [blackCheckpointId, checkpoints],
  );
  const whiteCheckpoint = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.id === whiteCheckpointId) ?? null,
    [checkpoints, whiteCheckpointId],
  );
  const compatibilityError = checkpointCompatibilityError(blackCheckpoint, whiteCheckpoint);

  const checkConnection = async (): Promise<void> => {
    setConnection('checking');
    setServiceLabel('Checking AlphaZero…');
    setDiagnostic(null);
    try {
      const health = await gateway.health();
      const availableCheckpoints = await gateway.listCheckpoints();
      setConnection('available');
      setServiceLabel(`${health.service} ${health.version} · protocol v${health.protocolVersion}`);
      setCheckpoints(availableCheckpoints);
      const fallback = latestCubeCheckpoint(availableCheckpoints) ?? availableCheckpoints[0];
      if (fallback) {
        setBlackCheckpointId((current) =>
          availableCheckpoints.some(
            (checkpoint) => checkpoint.id === current && checkpoint.topology === 'cube',
          )
            ? current
            : fallback.id,
        );
        setWhiteCheckpointId((current) =>
          availableCheckpoints.some(
            (checkpoint) => checkpoint.id === current && checkpoint.topology === 'cube',
          )
            ? current
            : fallback.id,
        );
      } else {
        setBlackCheckpointId('');
        setWhiteCheckpointId('');
      }
    } catch (error) {
      setConnection('unavailable');
      setServiceLabel('AlphaZero unavailable');
      setCheckpoints([]);
      setBlackCheckpointId('');
      setWhiteCheckpointId('');
      setDiagnostic(errorMessage(error));
    }
  };

  useEffect(() => {
    void checkConnection();
    // The gateway instance is stable for the lifetime of this workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);

  const publishAction = (session: DeveloperReplaySession, result: Cube2DGameActionResult): void => {
    actionSequenceRef.current += 1;
    setExternalAction(Object.freeze({ sequence: actionSequenceRef.current, result }));
    setPosition(session.position);
  };

  const runReplayOperation = async (
    operation: (session: DeveloperReplaySession) => Promise<Cube2DGameActionResult>,
    options: { readonly pause: boolean; readonly disableAnimation: boolean },
  ): Promise<void> => {
    const session = replay;
    if (!session || operationInFlightRef.current) return;
    if (options.pause) setPlaying(false);
    if (options.disableAnimation) setSeekAnimationDisabled(true);
    operationInFlightRef.current = true;
    setDiagnostic(null);
    try {
      const result = await operation(session);
      publishAction(session, result);
    } catch (error) {
      setPlaying(false);
      setDiagnostic(errorMessage(error));
    } finally {
      operationInFlightRef.current = false;
      if (options.disableAnimation) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setSeekAnimationDisabled(false));
        });
      }
    }
  };

  const generate = async (): Promise<void> => {
    if (generating || compatibilityError || !blackCheckpoint || !whiteCheckpoint) return;
    if (!Number.isSafeInteger(mctsSimulations) || mctsSimulations < 1) {
      setDiagnostic('MCTS simulations must be a positive integer.');
      return;
    }

    setGenerating(true);
    setPlaying(false);
    setDiagnostic(null);
    setReplay(null);
    setPosition(0);
    setExternalAction(null);
    try {
      const game = await gateway.generateGame({
        blackCheckpointId: blackCheckpoint.id,
        whiteCheckpointId: whiteCheckpoint.id,
        mctsSimulations,
      });
      const metadataError = generatedGameCompatibilityError(
        game,
        blackCheckpoint,
        whiteCheckpoint,
        mctsSimulations,
      );
      if (metadataError) throw new Error(metadataError);
      const session = new DeveloperReplaySession(game);
      setReplay(session);
      setPosition(0);
      actionSequenceRef.current += 1;
      setExternalAction(Object.freeze({ sequence: actionSequenceRef.current, result: session.current() }));
    } catch (error) {
      setDiagnostic(errorMessage(error));
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!playing || !replay) return;
    if (position >= replay.totalMoves) {
      setPlaying(false);
      return;
    }

    const delayMs = Math.max(50, Math.round(1000 / speed));
    const timer = window.setTimeout(() => {
      if (operationInFlightRef.current) return;
      operationInFlightRef.current = true;
      void replay.next()
        .then((result) => {
          publishAction(replay, result);
          if (replay.position >= replay.totalMoves) setPlaying(false);
        })
        .catch((error: unknown) => {
          setPlaying(false);
          setDiagnostic(errorMessage(error));
        })
        .finally(() => {
          operationInFlightRef.current = false;
        });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [playing, position, replay, speed]);

  const animationMode: AnimationMode =
    seekAnimationDisabled || speed !== 1 ? 'disabled' : 'normal';
  const replayBusy = generating || operationInFlightRef.current;

  return (
    <main className="development-workspace" aria-label="Development Workspace">
      <header className="development-workspace__topbar">
        <div>
          <h1>Development Workspace</h1>
        </div>
        <button type="button" onClick={onBack}>Back to GoCube</button>
      </header>

      <div className="development-workspace__configuration">
        <section className="development-alpha-zero" aria-labelledby="development-alpha-zero-title">
          <h2 id="development-alpha-zero-title">AlphaZero</h2>
          <div className="development-alpha-zero__status">
            <span aria-live="polite">{serviceLabel}</span>
            <button type="button" disabled={connection === 'checking' || generating} onClick={() => void checkConnection()}>
              Retry connection
            </button>
          </div>

          <div className="development-alpha-zero__grid">
            <label>
              Black checkpoint
              <select
                value={blackCheckpointId}
                disabled={connection !== 'available' || generating}
                onChange={(event) => {
                  const value = event.target.value;
                  setBlackCheckpointId(value);
                  persistDevelopmentSettings({ blackCheckpointId: value });
                }}
              >
                <option value="">Select checkpoint</option>
                {checkpoints.map((checkpoint) => (
                  <option value={checkpoint.id} key={checkpoint.id}>{checkpointLabel(checkpoint)}</option>
                ))}
              </select>
            </label>

            <label>
              White checkpoint
              <select
                value={whiteCheckpointId}
                disabled={connection !== 'available' || generating}
                onChange={(event) => {
                  const value = event.target.value;
                  setWhiteCheckpointId(value);
                  persistDevelopmentSettings({ whiteCheckpointId: value });
                }}
              >
                <option value="">Select checkpoint</option>
                {checkpoints.map((checkpoint) => (
                  <option value={checkpoint.id} key={checkpoint.id}>{checkpointLabel(checkpoint)}</option>
                ))}
              </select>
            </label>

            <label>
              MCTS simulations
              <input
                type="number"
                min={1}
                step={1}
                value={mctsSimulations}
                disabled={generating}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setMctsSimulations(value);
                  if (Number.isSafeInteger(value) && value >= 1) {
                    persistDevelopmentSettings({ mctsSimulations: value });
                  }
                }}
              />
            </label>

            <p className="development-alpha-zero__metadata">
              {blackCheckpoint
                ? `${blackCheckpoint.topology} · ${blackCheckpoint.size}×${blackCheckpoint.size} · ${blackCheckpoint.ruleSet} · komi ${blackCheckpoint.komi}`
                : 'Topology and size follow the selected checkpoints.'}
            </p>

            {compatibilityError && connection === 'available' ? (
              <p className="development-alpha-zero__error">{compatibilityError}</p>
            ) : null}

            <button
              type="button"
              className="development-alpha-zero__generate"
              disabled={connection !== 'available' || generating || Boolean(compatibilityError)}
              onClick={() => void generate()}
            >
              {generating ? 'Generating…' : 'Generate game'}
            </button>
          </div>
        </section>

        <ReplayControls
          position={position}
          total={replay?.totalMoves ?? 0}
          playing={playing}
          speed={speed}
          disabled={!replay || replayBusy}
          onJumpStart={() => void runReplayOperation((session) => session.jumpToStart(), { pause: true, disableAnimation: true })}
          onPrevious={() => void runReplayOperation((session) => session.previous(), { pause: true, disableAnimation: true })}
          onTogglePlay={() => setPlaying((current) => !current)}
          onNext={() => void runReplayOperation((session) => session.next(), { pause: true, disableAnimation: true })}
          onJumpEnd={() => void runReplayOperation((session) => session.jumpToEnd(), { pause: true, disableAnimation: true })}
          onSeek={(target) => void runReplayOperation((session) => session.seek(target), { pause: true, disableAnimation: true })}
          onSpeedChange={setSpeed}
        />
      </div>

      {diagnostic ? (
        <p className="development-workspace__diagnostic" role="alert">{diagnostic}</p>
      ) : null}

      <section className="development-workspace__game" aria-label="Generated game replay">
        {replay ? (
          <Cube2DGame
            controller={replay.controller}
            onRequestNewGame={() => undefined}
            gameplayReadOnly
            newGameDisabled
            animationMode={animationMode}
            externalAction={externalAction}
          />
        ) : (
          <p className="startup-status">Generate a Cube game to replay it on the GoCube renderer.</p>
        )}
      </section>
    </main>
  );
}
