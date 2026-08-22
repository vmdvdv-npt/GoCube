import { describe, expect, it } from 'vitest';
import { cubePointId } from '../core/topology/CubeTopology';
import { Cube2DGameController } from './Cube2DGameController';
import { TorusGameController } from './TorusGameController';

describe('session-owned partial endgame review', () => {
  it('restores Torus decisions from the session snapshot and finishes without a UI decision object', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    const black = controller.endgameGroups().find((group) => group.color === 'black');
    const white = controller.endgameGroups().find((group) => group.color === 'white');
    expect(black).toBeDefined();
    expect(white).toBeDefined();

    await controller.setEndgameDecision(black!.id, 'dead');
    const snapshot = controller.snapshot();
    expect(snapshot.endgameReview?.groups.find((group) => group.points.includes('0,0'))?.status).toBe(
      'dead',
    );

    const restored = new TorusGameController({ snapshot });
    expect(restored.endgameDecisions()).toMatchObject({ [black!.id]: 'dead' });

    const restoredWhite = restored.endgameGroups().find((group) => group.color === 'white');
    expect(restoredWhite).toBeDefined();
    await restored.setEndgameDecision(restoredWhite!.id, 'alive');

    const finished = await restored.finishEndgame();
    expect(finished.viewModel.phase).toBe('finished');
    expect(restored.snapshot().endgameReview).toBeNull();
    expect(restored.snapshot().endgameClassification).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ points: black!.points, status: 'dead', source: 'user' }),
        expect.objectContaining({ points: restoredWhite!.points, status: 'alive', source: 'user' }),
      ]),
    );
  });

  it('restores Cube decisions from the session snapshot and finishes without a UI decision object', async () => {
    const controller = new Cube2DGameController({ size: 2 });
    const blackPoint = cubePointId('front', 0, 0);
    const whitePoint = cubePointId('back', 1, 1);
    await controller.placeStone(blackPoint);
    await controller.placeStone(whitePoint);
    await controller.pass();
    await controller.pass();

    const black = controller.endgameGroups().find((group) => group.color === 'black');
    const white = controller.endgameGroups().find((group) => group.color === 'white');
    expect(black).toBeDefined();
    expect(white).toBeDefined();

    await controller.setEndgameDecision(black!.id, 'alive');
    const snapshot = controller.snapshot();
    expect(
      snapshot.endgameReview?.groups.find((group) => group.points.includes(blackPoint))?.status,
    ).toBe('alive');

    const restored = new Cube2DGameController({ snapshot });
    expect(restored.endgameDecisions()).toMatchObject({ [black!.id]: 'alive' });

    const restoredWhite = restored.endgameGroups().find((group) => group.color === 'white');
    expect(restoredWhite).toBeDefined();
    await restored.setEndgameDecision(restoredWhite!.id, 'seki');

    const finished = await restored.finishEndgame();
    expect(finished.viewModel.phase).toBe('finished');
    expect(restored.snapshot().endgameReview).toBeNull();
    expect(restored.snapshot().endgameClassification).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ points: black!.points, status: 'alive', source: 'user' }),
        expect.objectContaining({ points: restoredWhite!.points, status: 'seki', source: 'user' }),
      ]),
    );
  });
});
