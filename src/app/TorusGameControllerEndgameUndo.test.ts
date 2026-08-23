import { describe, expect, it } from 'vitest';
import { TorusGameController } from './TorusGameController';

describe('TorusGameController endgame Undo', () => {
  it('cancels an auto-resolved review and restores the state before the second Pass', async () => {
    const controller = new TorusGameController();

    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    expect(controller.viewModel()).toMatchObject({
      phase: 'endgame',
      moveNumber: 4,
      consecutivePasses: 2,
    });
    expect(controller.endgameManualGroupIds()).toEqual([]);
    expect(controller.nextUnresolvedEndgameGroupId()).toBeNull();

    const undo = await controller.undo();

    expect(undo.accepted).toBe(true);
    expect(controller.viewModel()).toMatchObject({
      phase: 'playing',
      currentPlayer: 'white',
      moveNumber: 3,
      consecutivePasses: 1,
      finalScore: null,
    });
    expect(controller.endgameGroups()).toEqual([]);

    const secondPassAgain = await controller.pass();
    expect(secondPassAgain.accepted).toBe(true);
    expect(controller.viewModel().phase).toBe('endgame');
    expect(controller.nextUnresolvedEndgameGroupId()).toBeNull();

    await controller.setEndgameDecision('["0,0"]', 'alive');
    await controller.setEndgameDecision('["4,4"]', 'alive');
    expect(controller.viewModel().phase).toBe('endgame');

    const finished = await controller.finishEndgame();
    expect(finished.viewModel.phase).toBe('finished');
  });
});
