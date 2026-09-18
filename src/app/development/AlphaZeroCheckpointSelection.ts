import type { AlphaZeroCheckpointDescriptor } from './AlphaZeroGateway';

export const ALL_BOARDS_FILTER = 'all' as const;
export type BoardFilterValue = typeof ALL_BOARDS_FILTER | `${AlphaZeroCheckpointDescriptor['topology']}:${number}`;
export type BoardFilterOption = Readonly<{ value: BoardFilterValue; label: string }>;

export const visibleCheckpointsForLifecycle = (
  checkpoints: readonly AlphaZeroCheckpointDescriptor[],
  showClosedLineages: boolean,
): readonly AlphaZeroCheckpointDescriptor[] => showClosedLineages
  ? checkpoints
  : checkpoints.filter((checkpoint) => (checkpoint.lineageStatus ?? 'ACTIVE') === 'ACTIVE');

export const boardFilterValueForCheckpoint = (
  checkpoint: Pick<AlphaZeroCheckpointDescriptor, 'topology' | 'size'>,
): BoardFilterValue => `${checkpoint.topology}:${checkpoint.size}` as BoardFilterValue;

export const boardFilterOptionsFromCheckpoints = (
  checkpoints: readonly AlphaZeroCheckpointDescriptor[],
): readonly BoardFilterOption[] => {
  const seen = new Set<BoardFilterValue>();
  const options: BoardFilterOption[] = [{ value: ALL_BOARDS_FILTER, label: 'All boards' }];
  for (const checkpoint of checkpoints) {
    const value = boardFilterValueForCheckpoint(checkpoint);
    if (seen.has(value)) continue;
    seen.add(value);
    const topology = checkpoint.topology[0].toUpperCase() + checkpoint.topology.slice(1);
    options.push({ value, label: `${topology} ${checkpoint.size}×${checkpoint.size}` });
  }
  return Object.freeze(options.map((option) => Object.freeze(option)));
};

export const visibleCheckpointsForFilters = (
  checkpoints: readonly AlphaZeroCheckpointDescriptor[],
  showClosedLineages: boolean,
  boardFilter: BoardFilterValue,
): readonly AlphaZeroCheckpointDescriptor[] => visibleCheckpointsForLifecycle(checkpoints, showClosedLineages).filter(
  (checkpoint) => boardFilter === ALL_BOARDS_FILTER || boardFilterValueForCheckpoint(checkpoint) === boardFilter,
);

export const checkpointIdWithFallback = (
  currentId: string,
  visibleCheckpoints: readonly AlphaZeroCheckpointDescriptor[],
): string => visibleCheckpoints.some((checkpoint) => checkpoint.id === currentId)
  ? currentId
  : visibleCheckpoints.at(-1)?.id ?? '';

export const checkpointLabel = (checkpoint: AlphaZeroCheckpointDescriptor): string => {
  const lifecycleStatus = checkpoint.lineageStatus ?? 'ACTIVE';
  const status = lifecycleStatus === 'ACTIVE' ? '' : ` · ${lifecycleStatus}`;
  return `${checkpoint.runName} · iter ${checkpoint.iteration} · ${checkpoint.topology} ${checkpoint.size}×${checkpoint.size}${status}`;
};
