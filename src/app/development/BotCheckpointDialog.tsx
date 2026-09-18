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
import './bot-checkpoint-dialog.css';

export interface BotCheckpointDialogProps {
  gateway: AlphaZeroGateway;
  gameMode: GameMode;
  size: GameSize;
  ruleSet: RuleSet;
  komi: number;
  initialCheckpointId?: string | null;
  onCancel: () => void;
  onConfirm: (checkpoint: AlphaZeroCheckpointDescriptor) => void;
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
    initialCheckpointId,
    onCancel,
    onConfirm,
  } = props;
  const preferredFilter = `${topologyForMode(gameMode)}:${size}` as BoardFilterValue;
  const [connection, setConnection] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [capable, setCapable] = useState(false);
  const [serviceSummary, setServiceSummary] = useState('AlphaZero service · protocol v1');
  const [checkpoints, setCheckpoints] = useState<readonly AlphaZeroCheckpointDescriptor[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [boardFilter, setBoardFilter] = useState<BoardFilterValue>(preferredFilter);
  const [checkpointId, setCheckpointId] = useState(initialCheckpointId ?? '');
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  const boardOptions = useMemo(() => boardFilterOptionsFromCheckpoints(checkpoints), [checkpoints]);
  const visible = useMemo(
    () => visibleCheckpointsForFilters(checkpoints, showClosed, boardFilter),
    [checkpoints, showClosed, boardFilter],
  );
  const selected = checkpoints.find((checkpoint) => checkpoint.id === checkpointId) ?? null;
  const compatibility = botCheckpointCompatibilityError(selected, { gameMode, size, ruleSet, komi });
  const statusLabel = connection === 'available' ? 'CONNECTED' : connection === 'checking' ? 'CHECKING' : 'OFFLINE';
  const visibleMessage = diagnostic ?? (connection === 'available' ? compatibility : null);

  const refresh = async () => {
    setConnection('checking');
    setDiagnostic(null);
    try {
      const [health, available] = await Promise.all([gateway.health(), gateway.listCheckpoints()]);
      const selectMoveAvailable = health.capabilities?.selectMove === true;
      setConnection('available');
      setCapable(selectMoveAvailable);
      setServiceSummary(`${health.service} · protocol v${health.protocolVersion}`);
      setCheckpoints(available);
      const options = boardFilterOptionsFromCheckpoints(available);
      const nextFilter = options.some((option) => option.value === preferredFilter) ? preferredFilter : 'all';
      setBoardFilter(nextFilter);
      const filtered = visibleCheckpointsForFilters(available, showClosed, nextFilter);
      setCheckpointId(
        checkpointIdWithFallback(checkpointId || initialCheckpointId || '', filtered),
      );
      if (!selectMoveAvailable) {
        setDiagnostic('Interactive move selection is not supported by this AlphaZero service.');
      }
    } catch (error) {
      setConnection('unavailable');
      setCapable(false);
      setCheckpoints([]);
      setCheckpointId('');
      setServiceSummary('AlphaZero service · protocol v1');
      setDiagnostic(error instanceof Error ? error.message : 'AlphaZero unavailable');
    }
  };

  useEffect(() => { void refresh(); }, [gateway, preferredFilter]);

  const updateFilter = (nextShowClosed: boolean, nextFilter: BoardFilterValue) => {
    const filtered = visibleCheckpointsForFilters(checkpoints, nextShowClosed, nextFilter);
    setCheckpointId(checkpointIdWithFallback(checkpointId, filtered));
  };

  return (
    <div className="confirmation-backdrop bot-checkpoint-backdrop" role="presentation">
      <section
        className="confirmation-card bot-checkpoint-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-checkpoint-title"
      >
        <div className="bot-checkpoint-dialog__heading">
          <h2 id="bot-checkpoint-title">AlphaZero</h2>
          <span className={`bot-checkpoint-dialog__status bot-checkpoint-dialog__status--${connection}`}>
            {statusLabel}
          </span>
        </div>

        <div className="bot-checkpoint-dialog__service-row">
          <span className="bot-checkpoint-dialog__service" title={serviceSummary}>
            {serviceSummary}
          </span>
          <button
            className="bot-checkpoint-dialog__retry"
            type="button"
            disabled={connection === 'checking'}
            onClick={() => void refresh()}
          >
            Retry
          </button>
        </div>

        <label className="bot-checkpoint-dialog__closed-row">
          <input
            type="checkbox"
            checked={showClosed}
            disabled={connection !== 'available'}
            onChange={(event) => {
              setShowClosed(event.target.checked);
              updateFilter(event.target.checked, boardFilter);
            }}
          />
          <span>Show closed lineages</span>
        </label>

        <div className="bot-checkpoint-dialog__fields">
          <label className="bot-checkpoint-dialog__field">
            <span>Board filter</span>
            <select
              value={boardFilter}
              disabled={connection !== 'available'}
              onChange={(event) => {
                const value = event.target.value as BoardFilterValue;
                setBoardFilter(value);
                updateFilter(showClosed, value);
              }}
            >
              {boardOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="bot-checkpoint-dialog__field">
            <span>Bot checkpoint</span>
            <select
              value={checkpointId}
              disabled={connection !== 'available'}
              onChange={(event) => setCheckpointId(event.target.value)}
            >
              <option value="">Select checkpoint</option>
              {visible.map((checkpoint) => (
                <option key={checkpoint.id} value={checkpoint.id}>{checkpointLabel(checkpoint)}</option>
              ))}
            </select>
          </label>
        </div>

        <p
          className="bot-checkpoint-dialog__metadata"
          title={selected ? `${selected.topology} · ${selected.size}×${selected.size} · ${selected.ruleSet} · komi ${selected.komi}` : undefined}
        >
          {selected
            ? `${selected.topology} · ${selected.size}×${selected.size} · ${selected.ruleSet} · komi ${selected.komi}`
            : 'Choose a model compatible with the current New Game settings.'}
        </p>

        {visibleMessage ? (
          <p className="bot-checkpoint-dialog__error" role="alert">{visibleMessage}</p>
        ) : null}

        <div className="startup-actions bot-checkpoint-dialog__actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="bot-checkpoint-dialog__confirm"
            disabled={connection !== 'available' || !capable || Boolean(compatibility)}
            onClick={() => selected && onConfirm(selected)}
          >
            OK
          </button>
        </div>
      </section>
    </div>
  );
}
