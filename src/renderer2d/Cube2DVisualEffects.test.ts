import { describe, expect, it } from 'vitest';
import type { FinalScore } from '../core/scoring/Scoring';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
import { createCube2DLayout } from '../presentation/cube/Cube2DLayout';
import { CubeOrientation } from '../presentation/cube/CubeOrientation';
import {
  CUBE_2D_CAPTURE_FLIGHT_STAGGER_MS,
  CUBE_2D_OVERLAY_WIDTH,
  buildCube2DCaptureEffects,
  buildCube2DEndgameSegments,
  buildCube2DTerritoryCells,
} from './Cube2DVisualEffects';

const layout = createCube2DLayout(new CubeOrientation(), 3, 1);

const score = (territoryPoints: FinalScore['territoryPoints']): FinalScore => ({
  ruleSet: 'chinese',
  black: 0,
  white: 7.5,
  komi: 7.5,
  territory: {
    black: territoryPoints.black.length,
    white: territoryPoints.white.length,
    neutral: territoryPoints.neutral.length,
    seki: territoryPoints.seki.length,
  },
  territoryPoints,
  stonesOnBoard: { black: 0, white: 0 },
  captures: { black: 0, white: 0 },
  prisoners: null,
  deadStones: { black: 0, white: 0 },
  winner: 'white',
  margin: 7.5,
});

const viewModel = (
  points: readonly GameViewPoint[],
  finalScore: FinalScore | null = null,
): GameViewModel => ({
  points,
  currentPlayer: 'black',
  moveNumber: 12,
  consecutivePasses: 0,
  phase: finalScore ? 'finished' : 'playing',
  captures: { black: 0, white: 0 },
  ruleSet: 'chinese',
  komi: 7.5,
  finalScore,
});

describe('Cube2D visual effects', () => {
  it('flies captured white stones right and black stones left with 150 ms stagger', () => {
    const previous = viewModel([
      { logicalPointId: 'front:1:2', occupancy: 'white' },
      { logicalPointId: 'right:1:0', occupancy: 'black' },
    ]);

    const effects = buildCube2DCaptureEffects(
      previous,
      ['front:1:2', 'right:1:0'],
      layout,
    );

    expect(effects).toHaveLength(2);
    expect(effects.map((effect) => effect.delayMs)).toEqual([
      0,
      CUBE_2D_CAPTURE_FLIGHT_STAGGER_MS,
    ]);
    expect(effects[0]).toMatchObject({
      logicalPointId: 'front:1:2',
      color: 'white',
    });
    expect(effects[0]!.targetX).toBeGreaterThan(CUBE_2D_OVERLAY_WIDTH);
    expect(effects[0]!.targetY).toBeLessThan(effects[0]!.y);
    expect(effects[1]).toMatchObject({
      logicalPointId: 'right:1:0',
      color: 'black',
    });
    expect(effects[1]!.targetX).toBeLessThan(0);
  });

  it('uses only FinalScore black/white territory points and leaves neutral/seki untinted', () => {
    const finalScore = score({
      black: ['front:1:1'],
      white: ['right:1:1'],
      neutral: ['front:0:0'],
      seki: ['right:0:0'],
    });

    const cells = buildCube2DTerritoryCells(viewModel([], finalScore), layout);

    expect(cells).toHaveLength(2);
    expect(cells.map((cell) => [cell.pointId, cell.owner])).toEqual([
      ['front:1:1', 'black'],
      ['right:1:1', 'white'],
    ]);
  });

  it('draws a logical endgame group continuously across the visible FRONT/RIGHT seam', () => {
    const front = layout.cells.find((cell) => cell.face === 'front')!;
    const right = layout.cells.find((cell) => cell.face === 'right')!;
    const from = front.pointIds[1]![2]!;
    const to = right.pointIds[1]![0]!;

    const segments = buildCube2DEndgameSegments(
      [
        {
          id: 'cross-edge',
          points: [from, to],
          color: 'black',
          edges: [{ from, to }],
          status: 'dead',
        },
      ],
      layout,
      null,
      'cross-edge',
    );

    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.groupId === 'cross-edge')).toBe(true);
    expect(segments.every((segment) => segment.status === 'dead')).toBe(true);
    expect(segments.every((segment) => segment.selected)).toBe(true);
    expect(new Set(segments.map((segment) => segment.face))).toEqual(new Set(['front', 'right']));
    expect(segments.every((segment) =>
      Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1) <= (100 / layout.size) / 2 + 0.001,
    )).toBe(true);
  });
});
