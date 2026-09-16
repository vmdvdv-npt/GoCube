import { describe, expect, it } from 'vitest';
import type { AlphaZeroCheckpointDescriptor, AlphaZeroGeneratedGame } from './AlphaZeroGateway';
import {
  checkpointCompatibilityError,
  generatedGameCompatibilityError,
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
