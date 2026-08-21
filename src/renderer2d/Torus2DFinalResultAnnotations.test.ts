import { describe, expect, it } from 'vitest';
import type { FinalScore } from '../core/scoring/Scoring';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  finalDeadStonePointIds,
  TORUS_DEAD_STONE_OPACITY,
  TORUS_FINAL_TERRITORY_OPACITY,
} from './Torus2DStoneAnnotations';

const score = (overrides: Partial<FinalScore> = {}): FinalScore => ({
  ruleSet: 'chinese',
  black: 3,
  white: 0,
  komi: 0,
  territory: { black: 2, white: 0, neutral: 1, seki: 0 },
  territoryPoints: {
    black: ['1,1', '1,2'],
    white: [],
    neutral: ['7,7'],
    seki: [],
  },
  stonesOnBoard: { black: 1, white: 0 },
  captures: { black: 0, white: 0 },
  prisoners: null,
  deadStones: { black: 0, white: 1 },
  winner: 'black',
  margin: 3,
  ...overrides,
});

const viewModel = (
  phase: GameViewModel['phase'],
  finalScore: FinalScore | null,
): GameViewModel => ({
  points: [
    { logicalPointId: '0,0', occupancy: 'black' },
    // Occupied in the authoritative final position, but scoring treated this point as empty.
    { logicalPointId: '1,1', occupancy: 'white' },
    { logicalPointId: '1,2', occupancy: 'empty' },
    { logicalPointId: '7,7', occupancy: 'empty' },
  ],
  currentPlayer: 'black',
  moveNumber: 12,
  consecutivePasses: phase === 'finished' ? 2 : 1,
  phase,
  captures: { black: 0, white: 0 },
  ruleSet: 'chinese',
  komi: 0,
  finalScore,
});

describe('Torus2D final-result presentation metadata', () => {
  it('derives dead stones from occupied points removed by scoring', () => {
    expect([...finalDeadStonePointIds(viewModel('finished', score()))]).toEqual(['1,1']);
  });

  it('does not mistake ordinary empty territory or neutral points for dead stones', () => {
    const dead = finalDeadStonePointIds(viewModel('finished', score()));
    expect(dead.has('1,2')).toBe(false);
    expect(dead.has('7,7')).toBe(false);
  });

  it('clears final dead-stone presentation when Undo returns to a pre-finish state', () => {
    expect(finalDeadStonePointIds(viewModel('playing', null)).size).toBe(0);
  });

  it('uses the requested subtle territory tint and a substantially stronger dead-stone mute', () => {
    expect(TORUS_FINAL_TERRITORY_OPACITY).toBe(0.2);
    expect(TORUS_DEAD_STONE_OPACITY).toBe(0.38);
    expect(TORUS_DEAD_STONE_OPACITY).toBeGreaterThan(TORUS_FINAL_TERRITORY_OPACITY);
  });
});
