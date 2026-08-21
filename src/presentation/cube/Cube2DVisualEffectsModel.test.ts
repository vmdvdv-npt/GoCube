import { describe, expect, it } from 'vitest';
import type { EndgameClassification } from '../../core/endgame/EndgameClassifier';
import type { FinalScore } from '../../core/scoring/Scoring';
import {
  createCube2DVisualEffectsModel,
  type CapturedStoneEffect,
} from './Cube2DVisualEffectsModel';

const score = (overrides: Partial<FinalScore> = {}): FinalScore => ({
  ruleSet: 'chinese',
  black: 2,
  white: 1,
  komi: 0,
  territory: { black: 1, white: 1, neutral: 1, seki: 1 },
  territoryPoints: {
    black: ['front:0:0'],
    white: ['right:0:0'],
    neutral: ['top:0:0'],
    seki: ['bottom:0:0'],
  },
  stonesOnBoard: { black: 1, white: 0 },
  captures: { black: 0, white: 0 },
  prisoners: null,
  deadStones: { black: 0, white: 0 },
  winner: 'black',
  margin: 1,
  ...overrides,
});

describe('Cube2DVisualEffectsModel', () => {
  it('uses only black/white FinalScore territory for tinting', () => {
    const model = createCube2DVisualEffectsModel({ finalScore: score() });
    expect(model.territory.get('front:0:0')).toBe('black');
    expect(model.territory.get('right:0:0')).toBe('white');
    expect(model.territory.has('top:0:0')).toBe(false);
    expect(model.territory.has('bottom:0:0')).toBe(false);
  });

  it('projects final dead/seki classification by logical point id', () => {
    const classification: EndgameClassification = [
      { points: ['front:0:0', 'right:0:0'], status: 'dead', source: 'user' },
      { points: ['top:0:0'], status: 'seki', source: 'user' },
    ];
    const model = createCube2DVisualEffectsModel({
      finalScore: score(),
      finalClassification: classification,
    });
    expect(model.pointStatuses.get('front:0:0')?.groupStatus).toBe('dead');
    expect(model.pointStatuses.get('right:0:0')?.groupStatus).toBe('dead');
    expect(model.pointStatuses.get('top:0:0')?.groupStatus).toBe('seki');
  });

  it('keeps capture effects presentation-only and ordered', () => {
    const captured: readonly CapturedStoneEffect[] = [
      { id: 'a', pointId: 'front:0:0', color: 'white', order: 0 },
      { id: 'b', pointId: 'right:0:0', color: 'black', order: 1 },
    ];
    const model = createCube2DVisualEffectsModel({ finalScore: null, capturedStones: captured });
    expect(model.capturedStones).toEqual(captured);
    expect(model.capturedStones.map((effect) => effect.order)).toEqual([0, 1]);
  });
});
