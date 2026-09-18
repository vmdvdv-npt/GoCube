import { useState } from 'react';
import type { StoneColor } from '../core/game/types';
import type { NewGameSettings } from './GameApplication';
import type { AlphaZeroCheckpointDescriptor, AlphaZeroGateway } from './development/AlphaZeroGateway';
import { BotCheckpointDialog } from './development/BotCheckpointDialog';

export type HumanColorChoice = StoneColor | 'random';
export function PlayVsBotLauncher({ settings, gateway, onStart }: { settings: NewGameSettings; gateway: AlphaZeroGateway; onStart: (options: { humanColor: StoneColor; checkpoint: AlphaZeroCheckpointDescriptor; mctsSimulations: number }) => void }) {
  const [humanColor, setHumanColor] = useState<HumanColorChoice>('black');
  const [mcts, setMcts] = useState('128');
  const [dialogOpen, setDialogOpen] = useState(false);
  const parsedMcts = Number(mcts);
  const mctsValid = Number.isSafeInteger(parsedMcts) && parsedMcts > 0;
  const resolvedKomi = settings.komi;
  return <>
    <section className="startup-card play-vs-bot-card" aria-labelledby="play-vs-bot-title">
      <h2 id="play-vs-bot-title">Play vs bot</h2>
      <fieldset><legend>Your color</legend><div className="board-size-options">{(['black', 'white', 'random'] as const).map((color) => <button type="button" key={color} className={humanColor === color ? 'is-selected' : undefined} aria-pressed={humanColor === color} onClick={() => setHumanColor(color)}>{color[0].toUpperCase() + color.slice(1)}</button>)}</div></fieldset>
      <label>MCTS simulations<input aria-label="MCTS simulations" type="number" min={1} step={1} value={mcts} onChange={(event) => setMcts(event.target.value)} /></label>
      {!mctsValid ? <p className="game-feedback">MCTS simulations must be a positive integer.</p> : null}
      <button type="button" disabled={!mctsValid} onClick={() => setDialogOpen(true)}>Choose model…</button>
    </section>
    {dialogOpen ? <BotCheckpointDialog gateway={gateway} gameMode={settings.gameMode} size={settings.size} ruleSet={settings.ruleSet} komi={resolvedKomi} onCancel={() => setDialogOpen(false)} onStart={(checkpoint) => { const resolved: StoneColor = humanColor === 'random' ? (Math.random() < 0.5 ? 'black' : 'white') : humanColor; setDialogOpen(false); onStart({ humanColor: resolved, checkpoint, mctsSimulations: parsedMcts }); }} /> : null}
  </>;
}
