import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { boardsEqual, SimpleKoPolicy } from './RepetitionPolicy';

const gameState = (board: Record<string, PointOccupancy>): GameState => ({ board });

describe('boardsEqual', () => {
  it('compares logical occupancy rather than object identity or key order', () => {
    const left = { a: 'black', b: 'empty', c: 'white' } as const;
    const right = { c: 'white', a: 'black', b: 'empty' } as const;

    expect(left).not.toBe(right);
    expect(boardsEqual(left, right)).toBe(true);
  });

  it('detects different occupancy and different point sets', () => {
    expect(boardsEqual({ a: 'black' }, { a: 'white' })).toBe(false);
    expect(boardsEqual({ a: 'black' }, { a: 'black', b: 'empty' })).toBe(false);
  });
});

describe('SimpleKoPolicy', () => {
  const policy = new SimpleKoPolicy();

  it('allows a candidate when fewer than two prior states are available', () => {
    const current = gameState({ p: 'black' });
    const candidate = gameState({ p: 'white' });

    expect(policy.isAllowed({ states: [current] }, candidate)).toBe(true);
  });

  it('rejects only an immediate recreation of the position before the previous move', () => {
    const beforeOpponentMove = gameState({ a: 'black', b: 'empty' });
    const current = gameState({ a: 'empty', b: 'white' });
    const candidate = gameState({ a: 'black', b: 'empty' });

    expect(
      policy.isAllowed({ states: [beforeOpponentMove, current] }, candidate),
    ).toBe(false);
  });

  it('does not accidentally implement superko for an older matching position', () => {
    const oldPosition = gameState({ a: 'black', b: 'empty' });
    const previous = gameState({ a: 'white', b: 'empty' });
    const current = gameState({ a: 'empty', b: 'white' });
    const candidate = gameState({ a: 'black', b: 'empty' });

    expect(
      policy.isAllowed({ states: [oldPosition, previous, current] }, candidate),
    ).toBe(true);
  });
});
