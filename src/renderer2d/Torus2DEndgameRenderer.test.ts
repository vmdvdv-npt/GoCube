import { describe, expect, it } from 'vitest';
import type { EndgamePresentationShape } from '../presentation/EndgamePresentation';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
import { buildEndgameContourPath } from './EndgameContourGeometry';
import {
  buildTorus2DScene,
  torus2DEndgameContourCells,
  type Torus2DSize,
} from './Torus2DRenderer';

const pointId = (x: number, y: number): string => `${x},${y}`;

const viewModel = (
  size: Torus2DSize,
  occupied: Readonly<Record<string, 'black' | 'white'>>,
): GameViewModel => {
  const points: GameViewPoint[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const logicalPointId = pointId(x, y);
      points.push({
        logicalPointId,
        occupancy: occupied[logicalPointId] ?? 'empty',
      });
    }
  }

  return {
    points,
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 0,
    phase: 'endgame',
    captures: { black: 0, white: 0 },
    ruleSet: 'chinese',
    komi: 7.5,
    finalScore: null,
  };
};

const shape = (points: readonly string[]): EndgamePresentationShape => ({
  points,
  edges: [],
});

const pathFor = (
  scene: ReturnType<typeof buildTorus2DScene>,
  points: readonly string[],
): string => buildEndgameContourPath(torus2DEndgameContourCells(scene, shape(points)), {
  originX: scene.padding,
  originY: scene.padding,
  spacing: scene.spacing,
});

const moveCount = (path: string): number => path.match(/M /g)?.length ?? 0;

describe('Torus2DRenderer endgame contour geometry', () => {
  it('maps one logical group to the current Torus scene cells without semantic styling', () => {
    const scene = buildTorus2DScene(
      viewModel(9, { '3,4': 'black', '4,4': 'black', '5,4': 'black' }),
      9,
    );

    expect(torus2DEndgameContourCells(scene, shape(['3,4', '4,4', '5,4']))).toEqual([
      { column: 3, row: 4 },
      { column: 4, row: 4 },
      { column: 5, row: 4 },
    ]);
    expect(moveCount(pathFor(scene, ['3,4', '4,4', '5,4']))).toBe(1);
  });

  it('cuts a horizontal wrap group at the current visual seam', () => {
    const scene = buildTorus2DScene(
      viewModel(9, { '0,4': 'black', '8,4': 'black' }),
      9,
    );

    expect(torus2DEndgameContourCells(scene, shape(['0,4', '8,4']))).toEqual([
      { column: 0, row: 4 },
      { column: 8, row: 4 },
    ]);
    expect(moveCount(pathFor(scene, ['0,4', '8,4']))).toBe(2);
  });

  it('cuts a vertical wrap group at the current visual seam', () => {
    const scene = buildTorus2DScene(
      viewModel(9, { '4,0': 'white', '4,8': 'white' }),
      9,
    );

    expect(torus2DEndgameContourCells(scene, shape(['4,0', '4,8']))).toEqual([
      { column: 4, row: 0 },
      { column: 4, row: 8 },
    ]);
    expect(moveCount(pathFor(scene, ['4,0', '4,8']))).toBe(2);
  });

  it('cuts a corner-wrapping logical group into the visible corner pieces', () => {
    const occupied = {
      '0,0': 'black',
      '8,0': 'black',
      '0,8': 'black',
      '8,8': 'black',
    } as const;
    const scene = buildTorus2DScene(viewModel(9, occupied), 9);
    const points = Object.keys(occupied);

    expect(torus2DEndgameContourCells(scene, shape(points))).toEqual([
      { column: 0, row: 0 },
      { column: 8, row: 0 },
      { column: 0, row: 8 },
      { column: 8, row: 8 },
    ]);
    expect(moveCount(pathFor(scene, points))).toBe(4);
  });

  it('keeps the same logical group while pan/view offsets change its scene geometry', () => {
    const source = viewModel(9, { '0,4': 'black', '8,4': 'black' });
    const initial = buildTorus2DScene(source, 9, { offsetX: 0, offsetY: 0 });
    const shifted = buildTorus2DScene(source, 9, { offsetX: 1, offsetY: 0 });
    const group = shape(['0,4', '8,4']);

    expect(torus2DEndgameContourCells(initial, group)).toEqual([
      { column: 0, row: 4 },
      { column: 8, row: 4 },
    ]);
    expect(torus2DEndgameContourCells(shifted, group)).toEqual([
      { column: 7, row: 4 },
      { column: 8, row: 4 },
    ]);
    expect(moveCount(pathFor(shifted, group.points))).toBe(1);
  });

  it('maps logical groups into every enabled wrapped duplicate copy', () => {
    const scene = buildTorus2DScene(
      viewModel(9, { '0,0': 'black' }),
      9,
      { offsetX: 0, offsetY: 0 },
      true,
    );
    const cells = torus2DEndgameContourCells(scene, shape(['0,0']));

    expect(cells).toHaveLength(4);
    expect(cells).toEqual(expect.arrayContaining([
      { column: 0, row: 0 },
      { column: 9, row: 0 },
      { column: 0, row: 9 },
      { column: 9, row: 9 },
    ]));
  });
});
