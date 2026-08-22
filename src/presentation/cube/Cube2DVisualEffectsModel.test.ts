import { describe, expect, it } from 'vitest';
import type { EndgameClassification } from '../../core/endgame/EndgameClassifier';
import type { FinalScore } from '../../core/scoring/Scoring';
import {
  buildCube2DCaptureEffects,
  createCube2DVisualEffectsModel,
  type CapturedStoneEffect,
  type Cube2DCaptureSource,
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

const captureSource = (
  pointId: string,
  color: 'black' | 'white',
  stageX: number,
): Cube2DCaptureSource => ({
  pointId,
  color,
  face: 'front',
  layoutRow: 1,
  layoutColumn: 1,
  localX: stageX - 100,
  localY: 50,
  stageX,
  stageY: 150,
  radius: 8,
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
    const sources = new Map<string, Cube2DCaptureSource>([
      ['front:0:0', captureSource('front:0:0', 'white', 150)],
      ['right:0:0', captureSource('right:0:0', 'black', 250)],
    ]);
    const captured = buildCube2DCaptureEffects({
      generation: 4,
      capturedPointIds: ['front:0:0', 'right:0:0'],
      previousSources: sources,
      stageWidth: 400,
    });
    const model = createCube2DVisualEffectsModel({ finalScore: null, capturedStones: captured });
    expect(model.capturedStones).toEqual(captured);
    expect(model.capturedStones.map((effect) => effect.order)).toEqual([0, 1]);
  });

  it('flies white left and black right from the preserved previous-stage coordinates', () => {
    const white = captureSource('front:0:0', 'white', 175);
    const black = captureSource('front:0:1', 'black', 225);
    const effects = buildCube2DCaptureEffects({
      generation: 7,
      capturedPointIds: [white.pointId, black.pointId],
      previousSources: new Map([
        [white.pointId, white],
        [black.pointId, black],
      ]),
      stageWidth: 400,
    });

    expect(effects).toHaveLength(2);
    expect(effects[0]).toMatchObject({ ...white, id: '7:front:0:0', order: 0 });
    expect(effects[0]!.targetStageX).toBeLessThan(0);
    expect(effects[0]!.targetStageY).toBeLessThan(effects[0]!.stageY);
    expect(effects[1]).toMatchObject({ ...black, id: '7:front:0:1', order: 1 });
    expect(effects[1]!.targetStageX).toBeGreaterThan(400);
  });

  it('creates at most one capture effect per captured PointId and ignores missing previous sources', () => {
    const source = captureSource('front:1:1', 'white', 180);
    const effects: readonly CapturedStoneEffect[] = buildCube2DCaptureEffects({
      generation: 9,
      capturedPointIds: [source.pointId, 'right:2:2'],
      previousSources: new Map([[source.pointId, source]]),
      stageWidth: 400,
    });

    expect(effects).toHaveLength(1);
    expect(effects[0]!.pointId).toBe(source.pointId);
  });
});
