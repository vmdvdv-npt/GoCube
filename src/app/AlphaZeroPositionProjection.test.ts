import { describe, expect, it } from 'vitest';
import { Cube2DGameController } from './Cube2DGameController';
import { TorusGameController } from './TorusGameController';
import { projectGameSessionToAlphaZeroPosition } from './AlphaZeroPositionProjection';

const projectTorus = (controller: TorusGameController) =>
  projectGameSessionToAlphaZeroPosition(controller.snapshot(), { topology: 'torus', size: 9 });

const projectCube = (controller: Cube2DGameController) =>
  projectGameSessionToAlphaZeroPosition(controller.snapshot(), {
    topology: 'cube',
    size: controller.size,
  });

describe('projectGameSessionToAlphaZeroPosition', () => {
  it('projects an empty GameSession as empty history', () => {
    const controller = new TorusGameController({ size: 9, ruleSet: 'japanese', komi: 6.5 });

    expect(projectTorus(controller)).toEqual({
      topology: 'torus',
      size: 9,
      ruleSet: 'japanese',
      komi: 6.5,
      moves: [],
    });
  });

  it('projects placements and Pass with authoritative move numbers and colors', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('0,0');
    await controller.pass();
    await controller.placeStone('1,0');

    expect(projectTorus(controller).moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
      { moveNumber: 2, color: 'white', action: { type: 'pass' } },
      { moveNumber: 3, color: 'black', action: { type: 'place', pointId: '1,0' } },
    ]);
  });

  it('identifies the placed point even when the same transition captures stones', async () => {
    const controller = new TorusGameController({ size: 9 });
    for (const point of ['1,0', '1,1', '0,1', '8,8', '2,1', '7,7', '1,2'] as const) {
      const result = await controller.placeStone(point);
      expect(result.accepted).toBe(true);
    }

    const position = projectTorus(controller);
    expect(position.moves.at(-1)).toEqual({
      moveNumber: 7,
      color: 'black',
      action: { type: 'place', pointId: '1,2' },
    });
    expect(controller.snapshot().history.at(-1)!.board['1,1']).toBe('empty');
  });

  it('preserves canonical Torus PointId values without conversion', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('8,7');

    expect(projectTorus(controller).moves[0]!.action).toEqual({
      type: 'place',
      pointId: '8,7',
    });
  });

  it('preserves canonical Cube PointId values without conversion', async () => {
    const controller = new Cube2DGameController({ size: 4 });
    await controller.placeStone('right:3:2');

    expect(projectCube(controller).moves[0]!.action).toEqual({
      type: 'place',
      pointId: 'right:3:2',
    });
  });
});
