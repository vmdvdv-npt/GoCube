import { describe, expect, it } from 'vitest';
import { botCheckpointCompatibilityError } from './BotCheckpointDialog';
import type { AlphaZeroCheckpointDescriptor } from './AlphaZeroGateway';

const checkpoint: AlphaZeroCheckpointDescriptor = { id: 'm88', runName: 'torus9', iteration: 88, topology: 'torus', size: 9, ruleSet: 'chinese', komi: 0.5, lineageStatus: 'ACTIVE' };
const settings = { gameMode: 'torus-2d' as const, size: 9 as const, ruleSet: 'chinese' as const, komi: 0.5 };
describe('bot checkpoint compatibility', () => {
  it('accepts exact descriptor metadata', () => expect(botCheckpointCompatibilityError(checkpoint, settings)).toBeNull());
  it('rejects rules mismatch', () => expect(botCheckpointCompatibilityError({ ...checkpoint, ruleSet: 'japanese' }, settings)).toContain('rules'));
  it('rejects komi mismatch', () => expect(botCheckpointCompatibilityError({ ...checkpoint, komi: 6.5 }, settings)).toContain('komi'));
  it('rejects topology and size mismatch', () => { expect(botCheckpointCompatibilityError({ ...checkpoint, topology: 'cube' }, settings)).toContain('topology'); expect(botCheckpointCompatibilityError({ ...checkpoint, size: 13 }, settings)).toContain('size'); });
});
