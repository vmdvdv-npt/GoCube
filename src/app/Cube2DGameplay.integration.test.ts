import { describe, expect, it } from 'vitest';
import { cubePointId } from '../core/topology/CubeTopology';
import { createCube2DLayout } from '../presentation/cube/Cube2DLayout';
import { CubeOrientation } from '../presentation/cube/CubeOrientation';
import { createCube2DRenderModel } from '../renderer2d/Cube2DRenderer';
import { Cube2DGameController } from './Cube2DGameController';

const play = async (controller: Cube2DGameController, point: string) => {
  const result = await controller.placeStone(point);
  expect(result.accepted).toBe(true);
  return result;
};

describe('Cube2D gameplay integration', () => {
  it('routes a visual logical PointId through GameSession and PresentationModel', async () => {
    const controller = new Cube2DGameController({ size: 3 });
    const point = cubePointId('front', 1, 2);

    expect(controller.moveAvailability(point)).toEqual({ allowed: true, reason: null });
    const result = await controller.placeStone(point);

    expect(result.accepted).toBe(true);
    expect(result.captured).toEqual([]);
    expect(result.viewModel.currentPlayer).toBe('white');
    expect(result.viewModel.moveNumber).toBe(1);
    expect(result.viewModel.lastMovePointId).toBe(point);
    expect(result.viewModel.points.find((candidate) => candidate.logicalPointId === point)).toMatchObject({
      occupancy: 'black',
      moveNumber: 1,
    });
    expect(controller.moveAvailability(point)).toEqual({ allowed: false, reason: 'occupied' });
  });

  it('keeps a placed stone bound to the same logical point after Cube 2D navigation', async () => {
    const controller = new Cube2DGameController({ size: 4 });
    const point = cubePointId('front', 0, 0);
    await play(controller, point);

    const initial = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), 4));
    const moved = createCube2DRenderModel(createCube2DLayout(new CubeOrientation().moveRight(), 4));
    const initialVisual = initial.boards.flatMap((board) => board.points).find((candidate) => candidate.pointId === point);
    const movedVisual = moved.boards.flatMap((board) => board.points).find((candidate) => candidate.pointId === point);

    expect(initialVisual?.pointId).toBe(point);
    expect(movedVisual?.pointId).toBe(point);
    expect(controller.viewModel().points.find((candidate) => candidate.logicalPointId === point)?.occupancy).toBe('black');
  });

  it('captures a group through a physical cube edge through the real GameSession path', async () => {
    const controller = new Cube2DGameController({ size: 3 });
    const frontEdge = cubePointId('front', 1, 2);
    const rightEdge = cubePointId('right', 1, 0);

    await play(controller, cubePointId('front', 1, 1));
    await play(controller, frontEdge);
    await play(controller, cubePointId('front', 0, 2));
    await play(controller, rightEdge);
    await play(controller, cubePointId('front', 2, 2));
    await play(controller, cubePointId('back', 1, 1));
    await play(controller, cubePointId('right', 0, 0));
    await play(controller, cubePointId('back', 0, 0));
    await play(controller, cubePointId('right', 2, 0));
    await play(controller, cubePointId('top', 1, 1));
    const capture = await play(controller, cubePointId('right', 1, 1));

    expect(new Set(capture.captured)).toEqual(new Set([frontEdge, rightEdge]));
    const occupancy = new Map(capture.viewModel.points.map((point) => [point.logicalPointId, point.occupancy]));
    expect(occupancy.get(frontEdge)).toBe('empty');
    expect(occupancy.get(rightEdge)).toBe('empty');
  });

  it('reports suicide through an edge as forbidden without changing GameState', async () => {
    const controller = new Cube2DGameController({ size: 3 });
    const target = cubePointId('front', 1, 2);

    await play(controller, cubePointId('back', 1, 1));
    await play(controller, cubePointId('front', 1, 1));
    await play(controller, cubePointId('back', 0, 0));
    await play(controller, cubePointId('front', 0, 2));
    await play(controller, cubePointId('back', 2, 2));
    await play(controller, cubePointId('front', 2, 2));
    await play(controller, cubePointId('top', 1, 1));
    await play(controller, cubePointId('right', 1, 0));

    const before = controller.viewModel();
    expect(controller.moveAvailability(target)).toEqual({ allowed: false, reason: 'suicide' });
    const rejected = await controller.placeStone(target);

    expect(rejected.accepted).toBe(false);
    expect(rejected.reason).toBe('suicide');
    expect(rejected.viewModel).toEqual(before);
  });

  it('applies the existing ko policy across a cube edge', async () => {
    const controller = new Cube2DGameController({ size: 3 });
    const frontEdge = cubePointId('front', 1, 2);
    const rightEdge = cubePointId('right', 1, 0);

    await play(controller, cubePointId('right', 1, 1));
    await play(controller, rightEdge);
    await play(controller, cubePointId('right', 0, 0));
    await play(controller, cubePointId('front', 1, 1));
    await play(controller, cubePointId('right', 2, 0));
    await play(controller, cubePointId('front', 0, 2));
    await play(controller, cubePointId('back', 1, 1));
    await play(controller, cubePointId('front', 2, 2));

    const capture = await play(controller, frontEdge);
    expect(capture.captured).toEqual([rightEdge]);
    expect(controller.moveAvailability(rightEdge)).toEqual({ allowed: false, reason: 'repetition' });

    const beforeRecapture = controller.viewModel();
    const recapture = await controller.placeStone(rightEdge);
    expect(recapture.accepted).toBe(false);
    expect(recapture.reason).toBe('repetition');
    expect(recapture.viewModel).toEqual(beforeRecapture);
  });
});
