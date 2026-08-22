import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { boardsEqual, SimpleKoPolicy } from './SimpleKoPolicy';

const gameState = (board: Record<string, PointOccupancy>): GameState => ({
  board,
  currentPlayer: 'black',
  moveNumber: 0,
  consecutivePasses: 0,
  phase: 'playing',
  captures: { black: 0, white: 0 },
});

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

  it('allows any candidate when there is no previous board to compare', () => {
    const candidate = gameState({ p: 'white' });
    expect(policy.isAllowed({ previousBoard: null }, candidate)).toBe(true);
  });

  it('rejects immediate recreation of the board before the previous accepted action', () => {
    const previousBoard = { a: 'black', b: 'empty' } as const;
    const candidate = gameState({ a: 'black', b: 'empty' });

    expect(policy.isAllowed({ previousBoard }, candidate)).toBe(false);
  });

  it('allows a candidate whenever the immediate comparison board differs', () => {
    const oldMatchingBoard = { a: 'black', b: 'empty' } as const;
    const immediateComparisonBoard = { a: 'white', b: 'empty' } as const;
    const candidate = gameState(oldMatchingBoard);

    expect(policy.isAllowed({ previousBoard: immediateComparisonBoard }, candidate)).toBe(true);
  });
});
