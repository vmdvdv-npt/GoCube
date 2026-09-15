import { describe, expect, it } from 'vitest';
import { parseAlphaZeroGeneratedGame } from './AlphaZeroProtocol';

const base = {
  protocolVersion: 1,
  topology: 'torus',
  size: 9,
  ruleSet: 'chinese',
  komi: 0.5,
  blackCheckpoint: 'torus9-golden@17',
  whiteCheckpoint: 'torus9-golden@17',
  mctsSimulations: 100,
} as const;

const pass = (moveNumber: number, color: 'black' | 'white') => ({
  moveNumber,
  color,
  action: { type: 'pass' as const },
});

describe('AlphaZero Protocol V1 move numbering', () => {
  it('accepts a strict 1..N Torus sequence and canonical Torus PointIds', () => {
    const game = parseAlphaZeroGeneratedGame({
      ...base,
      moves: [
        { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
        pass(2, 'white'),
        { moveNumber: 3, color: 'black', action: { type: 'place', pointId: '8,8' }, captured: [] },
      ],
    });
    expect(game.moves.map((move) => move.moveNumber)).toEqual([1, 2, 3]);
  });

  it('rejects an incorrect first move number and reports the received number', () => {
    expect(() => parseAlphaZeroGeneratedGame({ ...base, moves: [pass(2, 'black')] }))
      .toThrow(/must be 1; received 2/i);
  });

  it('rejects a duplicate move number and reports the duplicated number', () => {
    expect(() => parseAlphaZeroGeneratedGame({
      ...base,
      moves: [pass(1, 'black'), pass(1, 'white')],
    })).toThrow(/must be 2; received 1/i);
  });

  it('rejects a skipped move number and reports the actual received number', () => {
    expect(() => parseAlphaZeroGeneratedGame({
      ...base,
      moves: [pass(1, 'black'), pass(3, 'white')],
    })).toThrow(/must be 2; received 3/i);
  });
});
