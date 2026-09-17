import { describe, expect, it } from 'vitest';
import type { AlphaZeroCheckpointDescriptor, AlphaZeroGeneratedGame } from './AlphaZeroGateway';
import {
  ALL_BOARDS_FILTER,
  boardFilterOptionsFromCheckpoints,
  checkpointCompatibilityError,
  checkpointIdWithFallback,
  generatedGameCompatibilityError,
  visibleCheckpointsForFilters,
  visibleCheckpointsForLifecycle,
} from './DevelopmentWorkspace';

const checkpoint = (
  overrides: Partial<AlphaZeroCheckpointDescriptor> = {},
): AlphaZeroCheckpointDescriptor => ({
  id: 'cube-current',
  runName: 'current',
  iteration: 17,
  topology: 'cube',
  size: 4,
  ruleSet: 'chinese',
  komi: 0.5,
  lineageStatus: 'ACTIVE',
  ...overrides,
});

const generatedGame = (
  source: AlphaZeroCheckpointDescriptor,
  overrides: Partial<AlphaZeroGeneratedGame> = {},
): AlphaZeroGeneratedGame => ({
  protocolVersion: 1,
  topology: source.topology,
  size: source.size,
  ruleSet: source.ruleSet,
  komi: source.komi,
  blackCheckpoint: source.id,
  whiteCheckpoint: source.id,
  mctsSimulations: 100,
  moves: [],
  ...overrides,
});

describe('Development Workspace checkpoint compatibility', () => {
  it('shows only active lineages by default and all statuses when closed lineages are enabled', () => {
    const checkpoints = [
      checkpoint({ id: 'active', lineageStatus: 'ACTIVE' }),
      checkpoint({ id: 'archived', lineageStatus: 'ARCHIVED' }),
      checkpoint({ id: 'discarded', lineageStatus: 'DISCARDED' }),
    ];

    expect(visibleCheckpointsForLifecycle(checkpoints, false).map((item) => item.id)).toEqual(['active']);
    expect(visibleCheckpointsForLifecycle(checkpoints, true).map((item) => item.id)).toEqual([
      'active',
      'archived',
      'discarded',
    ]);
  });

  it('builds unique board filter options from loaded checkpoints', () => {
    const checkpoints = [
      checkpoint({ id: 'cube-4-a', topology: 'cube', size: 4 }),
      checkpoint({ id: 'cube-4-b', topology: 'cube', size: 4 }),
      checkpoint({ id: 'torus-9', topology: 'torus', size: 9 }),
      checkpoint({ id: 'cube-5', topology: 'cube', size: 5 }),
    ];

    expect(boardFilterOptionsFromCheckpoints(checkpoints)).toEqual([
      { value: ALL_BOARDS_FILTER, label: 'All boards' },
      { value: 'cube:4', label: 'Cube 4×4' },
      { value: 'torus:9', label: 'Torus 9×9' },
      { value: 'cube:5', label: 'Cube 5×5' },
    ]);
  });

  it('filters checkpoints by board topology and size', () => {
    const checkpoints = [
      checkpoint({ id: 'cube-4', topology: 'cube', size: 4 }),
      checkpoint({ id: 'torus-9-a', topology: 'torus', size: 9 }),
      checkpoint({ id: 'torus-9-b', topology: 'torus', size: 9 }),
    ];

    expect(visibleCheckpointsForFilters(checkpoints, true, 'torus:9').map((item) => item.id)).toEqual([
      'torus-9-a',
      'torus-9-b',
    ]);
  });

  it('combines closed-lineage visibility with the board filter', () => {
    const checkpoints = [
      checkpoint({ id: 'torus-active', topology: 'torus', size: 9, lineageStatus: 'ACTIVE' }),
      checkpoint({ id: 'torus-archived', topology: 'torus', size: 9, lineageStatus: 'ARCHIVED' }),
      checkpoint({ id: 'cube-active', topology: 'cube', size: 4, lineageStatus: 'ACTIVE' }),
    ];

    expect(visibleCheckpointsForFilters(checkpoints, false, 'torus:9').map((item) => item.id)).toEqual([
      'torus-active',
    ]);
    expect(visibleCheckpointsForFilters(checkpoints, true, 'torus:9').map((item) => item.id)).toEqual([
      'torus-active',
      'torus-archived',
    ]);
  });

  it('falls back to the last visible checkpoint when the current selection is filtered out', () => {
    const visible = [
      checkpoint({ id: 'torus-9-a', topology: 'torus', size: 9 }),
      checkpoint({ id: 'torus-9-b', topology: 'torus', size: 9 }),
    ];

    expect(checkpointIdWithFallback('cube-hidden', visible)).toBe('torus-9-b');
    expect(checkpointIdWithFallback('torus-9-a', visible)).toBe('torus-9-a');
    expect(checkpointIdWithFallback('anything', [])).toBe('');
  });

  it('accepts compatible Cube/Cube checkpoints', () => {
    const black = checkpoint({ id: 'cube-black' });
    const white = checkpoint({ id: 'cube-white' });
    expect(checkpointCompatibilityError(black, white)).toBeNull();
  });

  it('accepts compatible Torus/Torus checkpoints', () => {
    const black = checkpoint({
      id: 'torus-black',
      topology: 'torus',
      size: 9,
      komi: 0.5,
    });
    const white = checkpoint({
      id: 'torus-white',
      topology: 'torus',
      size: 9,
      komi: 0.5,
    });
    expect(checkpointCompatibilityError(black, white)).toBeNull();
  });

  it('rejects Cube/Torus topology mismatch', () => {
    expect(
      checkpointCompatibilityError(
        checkpoint(),
        checkpoint({ id: 'torus', topology: 'torus', size: 9 }),
      ),
    ).toMatch(/topology/i);
  });

  it('rejects size, rules, and komi mismatches', () => {
    const base = checkpoint();
    expect(checkpointCompatibilityError(base, checkpoint({ id: 'size', size: 5 }))).toMatch(/size/i);
    expect(
      checkpointCompatibilityError(base, checkpoint({ id: 'rules', ruleSet: 'japanese' })),
    ).toMatch(/rules/i);
    expect(checkpointCompatibilityError(base, checkpoint({ id: 'komi', komi: 6.5 }))).toMatch(/komi/i);
  });

  it('rejects generated metadata that differs from the selected compatible checkpoints', () => {
    const black = checkpoint({ id: 'torus-black', topology: 'torus', size: 9 });
    const white = checkpoint({ id: 'torus-white', topology: 'torus', size: 9 });
    const base = generatedGame(black, { whiteCheckpoint: white.id });

    expect(generatedGameCompatibilityError(base, black, white, 100)).toBeNull();
    expect(
      generatedGameCompatibilityError({ ...base, size: 13 }, black, white, 100),
    ).toMatch(/size/i);
    expect(
      generatedGameCompatibilityError({ ...base, komi: 6.5 }, black, white, 100),
    ).toMatch(/komi/i);
  });
});
