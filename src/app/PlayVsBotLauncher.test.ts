import { describe, expect, it, vi } from 'vitest';
import { parseMctsSimulations, resolveHumanColor } from './PlayVsBotLauncher';

describe('PlayVsBotLauncher helpers', () => {
  it('resolves explicit colors without consulting randomness', () => {
    const random = vi.fn(() => 0.25);

    expect(resolveHumanColor('black', random)).toBe('black');
    expect(resolveHumanColor('white', random)).toBe('white');
    expect(random).not.toHaveBeenCalled();
  });

  it('resolves Random exactly once for one game start', () => {
    const random = vi.fn(() => 0.75);

    expect(resolveHumanColor('random', random)).toBe('white');
    expect(random).toHaveBeenCalledTimes(1);
  });

  it('accepts only positive safe-integer MCTS simulation counts', () => {
    expect(parseMctsSimulations('1')).toBe(1);
    expect(parseMctsSimulations('230')).toBe(230);
    expect(parseMctsSimulations('0')).toBeNull();
    expect(parseMctsSimulations('-1')).toBeNull();
    expect(parseMctsSimulations('1.5')).toBeNull();
    expect(parseMctsSimulations('not-a-number')).toBeNull();
    expect(parseMctsSimulations(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});
