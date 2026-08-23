import { describe, expect, it } from 'vitest';
import type { EndgameClassification } from '../endgame/EndgameClassifier';
import { resolveTerritory } from '../endgame/TerritoryResolver';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { ChineseScoring } from './ChineseScoring';
import { JapaneseScoring } from './JapaneseScoring';

const topology = new TorusTopology(9);
const noClassification = Object.freeze([]) as EndgameClassification;

const makeState = (
  fill: PointOccupancy,
  overrides: Record<PointId, PointOccupancy> = {},
  captures = { black: 0, white: 0 },
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = fill;
  Object.assign(board, overrides);

  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ ...captures }),
  });
};

describe('territory analysis through Topology', () => {
  it('counts fully enclosed black territory', () => {
    const score = new ChineseScoring(topology).score(
      makeState('black', { '4,4': 'empty' }),
      noClassification,
      0,
    );

    expect(score.territory.black).toBe(1);
    expect(score.territoryPoints.black).toEqual(['4,4']);
  });

  it('counts fully enclosed white territory', () => {
    const score = new ChineseScoring(topology).score(
      makeState('white', { '4,4': 'empty' }),
      noClassification,
      0,
    );

    expect(score.territory.white).toBe(1);
  });

  it('keeps an empty region neutral when it touches both colors', () => {
    const score = new ChineseScoring(topology).score(
      makeState('black', { '4,4': 'empty', '3,4': 'white' }),
      noClassification,
      0,
    );

    expect(score.territory.black).toBe(0);
    expect(score.territory.white).toBe(0);
    expect(score.territory.neutral).toBe(1);
  });

  it('counts multiple connected empty points as one owned region', () => {
    const score = new ChineseScoring(topology).score(
      makeState('black', { '4,4': 'empty', '5,4': 'empty' }),
      noClassification,
      0,
    );

    expect(score.territory.black).toBe(2);
    expect(new Set(score.territoryPoints.black)).toEqual(new Set(['4,4', '5,4']));
  });

  it('finds territory through torus wraparound', () => {
    const score = new ChineseScoring(topology).score(
      makeState('black', { '0,4': 'empty', '8,4': 'empty' }),
      noClassification,
      0,
    );

    expect(score.territory.black).toBe(2);
  });

  it('does not depend on torus coordinates or TorusTopology implementation details', () => {
    class OpaqueTopology implements Topology {
      readonly id = 'opaque';
      private readonly all = Object.freeze(['alpha', 'beta', 'gamma']);

      points(): readonly PointId[] {
        return this.all;
      }

      has(point: PointId): boolean {
        return this.all.includes(point);
      }

      neighbors(point: PointId): readonly PointId[] {
        if (point === 'alpha') return ['beta'];
        if (point === 'beta') return ['alpha', 'gamma'];
        if (point === 'gamma') return ['beta'];
        throw new Error(`Unknown point: ${point}`);
      }
    }

    const opaque = new OpaqueTopology();
    const state: GameState = Object.freeze({
      board: Object.freeze({ alpha: 'black', beta: 'empty', gamma: 'black' }),
      currentPlayer: 'black',
      moveNumber: 0,
      consecutivePasses: 2,
      phase: 'endgame',
      captures: Object.freeze({ black: 0, white: 0 }),
    });

    expect(new ChineseScoring(opaque).score(state, noClassification, 0).territory.black).toBe(1);
  });
});

describe('ChineseScoring', () => {
  it('uses area scoring: living stones plus territory', () => {
    const score = new ChineseScoring(topology).score(
      makeState('black', { '4,4': 'empty' }),
      noClassification,
      0,
    );

    expect(score.stonesOnBoard.black).toBe(80);
    expect(score.territory.black).toBe(1);
    expect(score.black).toBe(81);
  });

  it('does not add captures a second time', () => {
    const score = new ChineseScoring(topology).score(
      makeState('black', { '4,4': 'empty' }, { black: 9, white: 4 }),
      noClassification,
      0,
    );

    expect(score.black).toBe(81);
    expect(score.captures).toEqual({ black: 9, white: 4 });
    expect(score.prisoners).toBeNull();
  });
});

describe('JapaneseScoring', () => {
  it('does not score living stones by themselves', () => {
    const score = new JapaneseScoring(topology).score(
      makeState('black'),
      noClassification,
      0,
    );

    expect(score.stonesOnBoard.black).toBe(81);
    expect(score.black).toBe(0);
  });

  it('adds captures made during play to the prisoner component', () => {
    const score = new JapaneseScoring(topology).score(
      makeState('black', {}, { black: 3, white: 2 }),
      noClassification,
      0,
    );

    expect(score.prisoners).toEqual({ black: 3, white: 2 });
    expect(score.black).toBe(3);
    expect(score.white).toBe(2);
  });
});

describe('endgame classification in scoring', () => {
  it('removes dead stones before territory calculation and credits them as Japanese prisoners', () => {
    const state = makeState('black', { '4,4': 'white' });
    const classification = Object.freeze([
      Object.freeze({
        points: Object.freeze(['4,4']),
        status: 'dead' as const,
        source: 'user' as const,
      }),
    ]);

    const chinese = new ChineseScoring(topology).score(state, classification, 0);
    const japanese = new JapaneseScoring(topology).score(state, classification, 0);

    expect(chinese.deadStones).toEqual({ black: 0, white: 1 });
    expect(chinese.territory.black).toBe(1);
    expect(chinese.stonesOnBoard.white).toBe(0);
    expect(chinese.black).toBe(81);

    expect(japanese.territory.black).toBe(1);
    expect(japanese.prisoners).toEqual({ black: 1, white: 0 });
    expect(japanese.black).toBe(2);
  });

  it('hands seki-neutral territory from TerritoryResolver to both scoring rules', () => {
    const state = makeState('black', { '4,4': 'empty' });
    const sekiGroup = topology.points().filter((point) => point !== '4,4');
    const classification = Object.freeze([
      Object.freeze({
        points: Object.freeze(sekiGroup),
        status: 'seki' as const,
        source: 'user' as const,
      }),
    ]);

    const [resolvedRegion] = resolveTerritory(state, classification, topology).regions;
    expect(resolvedRegion).toMatchObject({
      points: ['4,4'],
      borderingColors: ['black'],
      touchesSeki: true,
      owner: 'NEUTRAL',
    });

    const chinese = new ChineseScoring(topology).score(state, classification, 0);
    const japanese = new JapaneseScoring(topology).score(state, classification, 0);

    for (const score of [chinese, japanese]) {
      expect(score.territory.black).toBe(0);
      expect(score.territory.neutral).toBe(0);
      expect(score.territory.seki).toBe(1);
      expect(score.territoryPoints.seki).toEqual(['4,4']);
    }
  });

  it('hands ordinary dame to the neutral bucket rather than the seki bucket', () => {
    const state = makeState('black', { '4,4': 'empty', '3,4': 'white' });
    const [resolvedRegion] = resolveTerritory(state, noClassification, topology).regions;

    expect(resolvedRegion).toMatchObject({
      points: ['4,4'],
      borderingColors: ['black', 'white'],
      touchesSeki: false,
      owner: 'NEUTRAL',
    });

    const chinese = new ChineseScoring(topology).score(state, noClassification, 0);
    const japanese = new JapaneseScoring(topology).score(state, noClassification, 0);

    for (const score of [chinese, japanese]) {
      expect(score.territory.black).toBe(0);
      expect(score.territory.white).toBe(0);
      expect(score.territory.neutral).toBe(1);
      expect(score.territory.seki).toBe(0);
      expect(score.territoryPoints.neutral).toEqual(['4,4']);
    }
  });
});

describe('score result', () => {
  it('supports zero and fractional komi', () => {
    const state = makeState('black');

    expect(new JapaneseScoring(topology).score(state, noClassification, 0).white).toBe(0);
    expect(new JapaneseScoring(topology).score(state, noClassification, 7.5).white).toBe(7.5);
  });

  it('returns winner and absolute margin, including a draw', () => {
    const whiteWin = new JapaneseScoring(topology).score(
      makeState('black'),
      noClassification,
      7.5,
    );
    const draw = new JapaneseScoring(topology).score(
      makeState('black'),
      noClassification,
      0,
    );

    expect(whiteWin.winner).toBe('white');
    expect(whiteWin.margin).toBe(7.5);
    expect(draw.winner).toBe('draw');
    expect(draw.margin).toBe(0);
  });

  it('returns different results for the same classified position under Chinese and Japanese scoring', () => {
    const state = makeState('black', { '4,4': 'empty' }, { black: 2, white: 0 });

    const chinese = new ChineseScoring(topology).score(state, noClassification, 0.5);
    const japanese = new JapaneseScoring(topology).score(state, noClassification, 0.5);

    expect(chinese.black).toBe(81);
    expect(japanese.black).toBe(3);
    expect(chinese.black).not.toBe(japanese.black);
  });

  it('does not mutate GameState or EndgameClassification', () => {
    const state = makeState('black', { '4,4': 'white' }, { black: 2, white: 1 });
    const classification = Object.freeze([
      Object.freeze({
        points: Object.freeze(['4,4']),
        status: 'dead' as const,
        source: 'user' as const,
      }),
    ]);
    const stateBefore = JSON.stringify(state);
    const classificationBefore = JSON.stringify(classification);

    new ChineseScoring(topology).score(state, classification, 6.5);
    new JapaneseScoring(topology).score(state, classification, 6.5);

    expect(JSON.stringify(state)).toBe(stateBefore);
    expect(JSON.stringify(classification)).toBe(classificationBefore);
  });
});
