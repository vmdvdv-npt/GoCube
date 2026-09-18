import { useState } from 'react';
import type { StoneColor } from '../core/game/types';
import type { NewGameSettings } from './GameApplication';
import type {
  AlphaZeroCheckpointDescriptor,
  AlphaZeroGateway,
} from './development/AlphaZeroGateway';
import { BotCheckpointDialog } from './development/BotCheckpointDialog';

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const parsedMcts = parseMctsSimulations(mcts);

  return (
    <>
      <section className="startup-card play-vs-bot-card" aria-labelledby="play-vs-bot-title">
        <h2 id="play-vs-bot-title">Play vs bot</h2>
        <fieldset>
          <legend>Your color</legend>
          <div className="board-size-options">
            {(['black', 'white', 'random'] as const).map((color) => (
              <button
                type="button"
                key={color}
                className={humanColor === color ? 'is-selected' : undefined}
                aria-pressed={humanColor === color}
                onClick={() => setHumanColor(color)}
              >
                {color[0].toUpperCase() + color.slice(1)}
              </button>
            ))}
          </div>
        </fieldset>

        <label>
          MCTS simulations
          <input
            aria-label="MCTS simulations"
            type="number"
            min={1}
            step={1}
            value={mcts}
            onChange={(event) => setMcts(event.target.value)}
          />
        </label>

        {parsedMcts === null ? (
          <p className="game-feedback">MCTS simulations must be a positive integer.</p>
        ) : null}

        <button
          type="button"
          disabled={parsedMcts === null}
          onClick={() => setDialogOpen(true)}
        >
          Choose model…
        </button>
      </section>

      {dialogOpen && parsedMcts !== null ? (
        <BotCheckpointDialog
          gateway={gateway}
          gameMode={settings.gameMode}
          size={settings.size}
          ruleSet={settings.ruleSet}
          komi={settings.komi}
          onCancel={() => setDialogOpen(false)}
          onStart={(checkpoint) => {
            const resolved = resolveHumanColor(humanColor);
            setDialogOpen(false);
            onStart({
              humanColor: resolved,
              checkpoint,
              mctsSimulations: parsedMcts,
            });
          }}
        />
      ) : null}
    </>
  );
}
