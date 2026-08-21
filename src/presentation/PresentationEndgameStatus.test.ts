import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/game/types';
import { PresentationModel } from './PresentationModel';

const state = (phase: GameState['phase']): GameState => ({
  board: {
    a: 'black',
    b: 'white',
    c: 'empty',
  },
  currentPlayer: 'black',
  moveNumber: 2,
  consecutivePasses: phase === 'playing' ? 0 : 2,
  phase,
  captures: { black: 0, white: 0 },
});

describe('PresentationModel final endgame status', () => {
  it('exposes semantic dead/seki status only for a finished classified position', () => {
    const presentation = new PresentationModel();
    const classification = [
      { points: ['a'], status: 'dead' as const, source: 'user' as const },
      { points: ['b'], status: 'seki' as const, source: 'user' as const },
    ];

    const finished = presentation.create(state('finished'), {
      ruleSet: 'chinese',
      komi: 7.5,
      finalScore: null,
      endgameClassification: classification,
    });

    expect(finished.points.find((point) => point.logicalPointId === 'a')?.endgameStatus).toBe('dead');
    expect(finished.points.find((point) => point.logicalPointId === 'b')?.endgameStatus).toBe('seki');
    expect(finished.points.find((point) => point.logicalPointId === 'c')?.endgameStatus).toBeNull();

    const playing = presentation.create(state('playing'), {
      ruleSet: 'chinese',
      komi: 7.5,
      finalScore: null,
      endgameClassification: classification,
    });

    expect(playing.points.every((point) => !('endgameStatus' in point))).toBe(true);
  });
});
