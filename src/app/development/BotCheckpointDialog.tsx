import { useEffect, useMemo, useState } from 'react';
import type { RuleSet } from '../../core/game/types';
import type { GameMode, GameSize } from '../GameApplication';
import type { AlphaZeroCheckpointDescriptor, AlphaZeroGateway } from './AlphaZeroGateway';
import {
  boardFilterOptionsFromCheckpoints,
  checkpointIdWithFallback,
  checkpointLabel,
  visibleCheckpointsForFilters,
  type BoardFilterValue,
} from './AlphaZeroCheckpointSelection';

export interface BotCheckpointDialogProps {
  gateway: AlphaZeroGateway;
  gameMode: GameMode;
  size: GameSize;
  ruleSet: RuleSet;
  komi: number;
  onCancel: () => void;
  onStart: (checkpoint: AlphaZeroCheckpointDescriptor) => void;
  onSelectionChange?: (checkpoint: AlphaZeroCheckpointDescriptor | null) => void;
}

const topologyForMode = (mode: GameMode) => mode === 'cube-2d' ? 'cube' : 'torus';

export const botCheckpointCompatibilityError = (
  checkpoint: AlphaZeroCheckpointDescriptor | null,
  settings: Pick<BotCheckpointDialogProps, 'gameMode' | 'size' | 'ruleSet' | 'komi'>,
): string | null => {
  if (!checkpoint) return 'Choose an AlphaZero checkpoint.';
  if (checkpoint.topology !== topologyForMode(settings.gameMode)) return 'Checkpoint topology does not match the selected Board Shape.';
  if (checkpoint.size !== settings.size) return 'Checkpoint board size does not match the selected Board Size.';
  if (checkpoint.ruleSet !== settings.ruleSet) return 'Checkpoint rules do not match the selected Rules.';
  if (checkpoint.komi !== settings.komi) return 'Checkpoint komi does not match the selected Komi.';
  return null;
};

export function BotCheckpointDialog(props: BotCheckpointDialogProps) {
  const {
    gateway,
    gameMode,
    size,
    ruleSet,
    komi,
    onCancel,
    onStart,
    onSelectionChange,
  } = props;
  const preferredFilter = `${topologyForMode(gameMode)}:${size}` as BoardFilterValue;
  const [connection, setConnection] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [capable, setCapable] = useState(false);
  const [checkpoints, setCheckpoints] = useState<readonly AlphaZeroCheckpointDescriptor[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [boardFilter, setBoardFilter] = useState<BoardFilterValue>(preferredFilter);
  const [checkpointId, setCheckpointId] = useState('');
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  const boardOptions = useMemo(() => boardFilterOptionsFromCheckpoints(checkpoints), [checkpoints]);
  const visible = useMemo(
    () => visibleCheckpointsForFilters(checkpoints, showClosed, boardFilter),
    [checkpoints, showClosed, boardFilter],
  );
  const selected = checkpoints.find((checkpoint) => checkpoint.id === checkpointId) ?? null;
  const compatibility = botCheckpointCompatibilityError(selected, { gameMode, size, ruleSet, komi });

  const publishSelection = (
    nextId: string,
    available: readonly AlphaZeroCheckpointDescriptor[] = checkpoints,
    selectMoveAvailable = connection === 'available' && capable,
  ): void => {
    setCheckpointId(nextId);
    const checkpoint = available.find((candidate) => candidate.id === nextId) ?? null;
    onSelectionChange?.(selectMoveAvailable ? checkpoint : null);
  };

  const refresh = async () => {
    setConnection('checking');
    setDiagnostic(null);
    try {
      const [health, available] = await Promise.all([gateway.health(), gateway.listCheckpoints()]);
      const selectMoveAvailable = health.capabilities?.selectMove === true;
      setConnection('available');
      setCapable(selectMoveAvailable);
      setCheckpoints(available);
      const options = boardFilterOptionsFromCheckpoints(available);
      const nextFilter = options.some((option) => option.value === preferredFilter) ? preferredFilter : 'all';
      setBoardFilter(nextFilter);
      const filtered = visibleCheckpointsForFilters(available, showClosed, nextFilter);
      publishSelection(
        checkpointIdWithFallback(checkpointId, filtered),
        available,
        selectMoveAvailable,
      );
      if (!selectMoveAvailable) {
        setDiagnostic('Interactive move selection is not supported by this AlphaZero service.');
      }
    } catch (error) {
      setConnection('unavailable');
      setCapable(false);
      setCheckpoints([]);
      publishSelection('', [], false);
      setDiagnostic(error instanceof Error ? error.message : 'AlphaZero unavailable');
    }
  };

  useEffect(() => { void refresh(); }, [gateway, preferredFilter]);

  const updateFilter = (nextShowClosed: boolean, nextFilter: BoardFilterValue) => {
    const filtered = visibleCheckpointsForFilters(checkpoints, nextShowClosed, nextFilter);
    publishSelection(checkpointIdWithFallback(checkpointId, filtered));
  };

  return (
    <div className="confirmation-backdrop" role="presentation">
      <section className="confirmation-card bot-checkpoint-dialog" role="dialog" aria-modal="true" aria-labelledby="bot-checkpoint-title">
        <div className="development-alpha-zero__heading">
          <h2 id="bot-checkpoint-title">AlphaZero</h2>
          <span>{connection === 'available' ? 'Connected' : connection === 'checking' ? 'Checking' : 'Offline'}</span>
        </div>
        <button type="button" disabled={connection === 'checking'} onClick={() => void refresh()}>Retry</button>
        <label><input type="checkbox" checked={showClosed} disabled={connection !== 'available'} onChange={(event) => { setShowClosed(event.target.checked); updateFilter(event.target.checked, boardFilter); }} /> Show closed lineages</label>
        <label>Board filter<select value={boardFilter} disabled={connection !== 'available'} onChange={(event) => { const value = event.target.value as BoardFilterValue; setBoardFilter(value); updateFilter(showClosed, value); }}>{boardOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Bot checkpoint<select value={checkpointId} disabled={connection !== 'available'} onChange={(event) => publishSelection(event.target.value)}><option value="">Select checkpoint</option>{visible.map((checkpoint) => <option key={checkpoint.id} value={checkpoint.id}>{checkpointLabel(checkpoint)}</option>)}</select></label>
        <p className="development-alpha-zero__metadata">{selected ? `${selected.topology} · ${selected.size}×${selected.size} · ${selected.ruleSet} · komi ${selected.komi}` : 'Choose a model compatible with the current New Game settings.'}</p>
        {diagnostic ?? compatibility ? <p className="development-alpha-zero__error" role="alert">{diagnostic ?? compatibility}</p> : null}
        <div className="startup-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" className="start-game-button" disabled={connection !== 'available' || !capable || Boolean(compatibility)} onClick={() => selected && onStart(selected)}>Start game</button></div>
      </section>
    </div>
  );
}
