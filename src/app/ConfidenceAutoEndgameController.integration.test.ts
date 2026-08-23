import { describe, expect, it } from 'vitest';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import { cubePointId } from '../core/topology/CubeTopology';
import { Cube2DGameController } from './Cube2DGameController';
import { TorusGameController } from './TorusGameController';

const differentStatus = (status: GroupStatus): GroupStatus =>
  status === 'alive' ? 'dead' : 'alive';

describe('E2-12d controller/application integration', () => {
  it('wires Torus to confidence auto-selection, including seam identity, player override and reload', async () => {
    const controller = new TorusGameController({ size: 9, ruleSet: 'chinese', komi: 6.5 });
    await controller.placeStone('0,4');
    await controller.placeStone('4,4');
    await controller.placeStone('8,4');
    await controller.pass();
    await controller.pass();

    expect(controller.viewModel().phase).toBe('endgame');
    const groups = controller.endgameGroups();
    const black = groups.find((group) => group.color === 'black');
    const white = groups.find((group) => group.color === 'white');
    expect(black?.points).toEqual(['0,4', '8,4']);
    expect(white).toBeDefined();
    expect(controller.endgameManualGroupIds()).toEqual([]);
    expect(controller.nextUnresolvedEndgameGroupId()).toBeNull();

    const automatic = controller.endgameDecisions();
    expect(Object.keys(automatic)).toHaveLength(groups.length);
    const blackAutomatic = automatic[black!.id];
    expect(blackAutomatic).toBeDefined();
    const override = differentStatus(blackAutomatic!);
    await controller.setEndgameDecision(black!.id, override);
    expect(controller.endgameDecisions()[black!.id]).toBe(override);

    const snapshot = controller.snapshot();
    const blackSnapshot = snapshot.endgameReview?.groups.find((group) => group.points.includes('0,4'));
    expect(blackSnapshot?.proposal?.status).toBe(blackAutomatic);
    expect(blackSnapshot?.proposal?.evidence).toMatchObject({
      algorithm: 'engine2-confidence-auto-select-v1',
      adapterAlgorithm: 'engine2-confidence-auto-endgame-classifier-v1',
    });
    expect(blackSnapshot?.userDecision).toBe(override);

    const restored = new TorusGameController({ snapshot });
    expect(restored.endgameDecisions()[black!.id]).toBe(override);
    expect(restored.nextUnresolvedEndgameGroupId()).toBeNull();
    await restored.finishEndgame();

    expect(restored.snapshot().endgameClassification).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ points: black!.points, status: override, source: 'user' }),
        expect.objectContaining({ points: white!.points, source: 'automatic' }),
      ]),
    );
  });

  it('wires Cube to the same confidence policy across a face-edge group and honors overrides', async () => {
    const controller = new Cube2DGameController({ size: 5, ruleSet: 'japanese', komi: 7.5 });
    const blackFront = cubePointId('front', 2, 4);
    const whiteBack = cubePointId('back', 2, 2);
    const blackRight = cubePointId('right', 2, 0);

    await controller.placeStone(blackFront);
    await controller.placeStone(whiteBack);
    await controller.placeStone(blackRight);
    await controller.pass();
    await controller.pass();

    expect(controller.viewModel().phase).toBe('endgame');
    const groups = controller.endgameGroups();
    const black = groups.find((group) => group.color === 'black');
    expect(black?.points).toEqual([blackFront, blackRight].sort());
    expect(controller.endgameManualGroupIds()).toEqual([]);
    expect(controller.nextUnresolvedEndgameGroupId()).toBeNull();

    const automatic = controller.endgameDecisions();
    expect(Object.keys(automatic)).toHaveLength(groups.length);
    const original = automatic[black!.id];
    expect(original).toBeDefined();
    const override = differentStatus(original!);
    await controller.setEndgameDecision(black!.id, override);
    expect(controller.endgameDecisions()[black!.id]).toBe(override);

    await controller.finishEndgame();
    expect(controller.viewModel().phase).toBe('finished');
    expect(controller.snapshot().endgameClassification).toContainEqual(
      expect.objectContaining({ points: black!.points, status: override, source: 'user' }),
    );
  });
});
