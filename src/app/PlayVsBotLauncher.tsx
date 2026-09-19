import { useState } from 'react';
import type { StoneColor } from '../core/game/types';
import type { NewGameSettings } from './GameApplication';
import type {
  AlphaZeroCheckpointDescriptor,
  AlphaZeroGateway,
} from './development/AlphaZeroGateway';
import {
  BotCheckpointDialog,
  botCheckpointCompatibilityError,
} from './development/BotCheckpointDialog';

export type HumanColorChoice = StoneColor | 'random';

export const parseMctsSimulations = (value: string | number): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const resolveHumanColor = (
  choice: HumanColorChoice,
  random: () => number = Math.random,
): StoneColor => {
  if (choice !== 'random') return choice;
  return random() < 0.5 ? 'black' : 'white';
};

const modelSummary = (checkpoint: AlphaZeroCheckpointDescriptor): string => {
  const topology = checkpoint.topology[0].toUpperCase() + checkpoint.topology.slice(1);
  return `M${checkpoint.iteration} · ${topology} ${checkpoint.size}×${checkpoint.size}`;
};

export interface PlayVsBotLauncherProps {
  readonly settings: NewGameSettings;
  readonly gateway: AlphaZeroGateway;
  readonly onStart: (options: {
    humanColor: StoneColor;
    checkpoint: AlphaZeroCheckpointDescriptor;
    mctsSimulations: number;
  }) => void;
}

export function PlayVsBotLauncher({
  settings,
  gateway,
  onStart,
}: PlayVsBotLauncherProps) {
  const [humanColor, setHumanColor] = useState<HumanColorChoice>('black');
  const [mcts, setMcts] = useState('128');
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<AlphaZeroCheckpointDescriptor | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const parsedMcts = parseMctsSimulations(mcts);
  const compatibleCheckpoint =
    selectedCheckpoint &&
    botCheckpointCompatibilityError(selectedCheckpoint, {
      gameMode: settings.gameMode,
      size: settings.size,
      ruleSet: settings.ruleSet,
      komi: settings.komi,
    }) === null
      ? selectedCheckpoint
      : null;

  const startBotGame = (checkpoint: AlphaZeroCheckpointDescriptor): void => {
    if (parsedMcts === null) return;
    onStart({
      humanColor: resolveHumanColor(humanColor),
      checkpoint,
      mctsSimulations: parsedMcts,
    });
  };

  return (
    <>
      <section className="startup-card play-vs-bot-card" aria-labelledby="play-vs-bot-title">
        <h2 id="play-vs-bot-title" className="play-vs-bot-sr-only">
          Play vs bot
        </h2>

        <div className="play-vs-bot-section play-vs-bot-section--color">
          <div className="play-vs-bot-section__heading">
            <h3>Play as</h3>
            <p>Choose your stone</p>
          </div>
          <div className="play-vs-bot-color-options" role="group" aria-label="Play as">
            {(['black', 'white', 'random'] as const).map((color) => (
              <button
                type="button"
                key={color}
                className={`play-vs-bot-color-option${humanColor === color ? ' is-selected' : ''}`}
                aria-pressed={humanColor === color}
                onClick={() => setHumanColor(color)}
              >
                <span
                  className={`play-vs-bot-stone play-vs-bot-stone--${color}`}
                  aria-hidden="true"
                >
                  {color === 'random' ? '☯' : null}
                </span>
                <span>{color[0].toUpperCase() + color.slice(1)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="play-vs-bot-section play-vs-bot-section--difficulty">
          <div className="play-vs-bot-section__heading">
            <h3>Difficulty</h3>
            <p>Game strength</p>
          </div>
          <input
            className={`play-vs-bot-field${parsedMcts === null ? ' is-invalid' : ''}`}
            aria-label="MCTS simulations"
            type="number"
            min={1}
            step={1}
            value={mcts}
            onChange={(event) => setMcts(event.target.value)}
          />
          {parsedMcts === null ? (
            <p className="play-vs-bot-error" role="alert">
              MCTS simulations must be a positive integer.
            </p>
          ) : null}
        </div>

        <div className="play-vs-bot-section play-vs-bot-section--model">
          <div className="play-vs-bot-section__heading">
            <h3>Model</h3>
            <p>Choose AI model</p>
          </div>
          <button
            className="play-vs-bot-model-button"
            type="button"
            disabled={parsedMcts === null}
            title={compatibleCheckpoint?.id}
            onClick={() => setDialogOpen(true)}
          >
            {compatibleCheckpoint ? modelSummary(compatibleCheckpoint) : 'Choose model'}
          </button>
        </div>

        <div className="play-vs-bot-section play-vs-bot-section--start">
          <button
            className="start-game-button play-vs-bot-start-button"
            type="button"
            disabled={parsedMcts === null || compatibleCheckpoint === null}
            onClick={() => compatibleCheckpoint && startBotGame(compatibleCheckpoint)}
          >
            Play vs AI
          </button>
        </div>
      </section>

      {dialogOpen && parsedMcts !== null ? (
        <BotCheckpointDialog
          gateway={gateway}
          gameMode={settings.gameMode}
          size={settings.size}
          ruleSet={settings.ruleSet}
          komi={settings.komi}
          initialCheckpointId={selectedCheckpoint?.id}
          onCancel={() => setDialogOpen(false)}
          onConfirm={(checkpoint) => {
            setSelectedCheckpoint(checkpoint);
            setDialogOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
