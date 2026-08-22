import { describe, expect, it } from 'vitest';
import { TorusGameController } from './TorusGameController';

describe('TorusGameController endgame Undo', () => {
  it('cancels pending manual classification and restores the state before the second Pass', async () => {
    const controller = new TorusGameController();

    await controller.pass();
    await controller.pass();

    expect(controller.viewModel()).toMatchObject({
      phase: 'endgame',
      moveNumber: 2,
      consecutivePasses: 2,
    });

    const undo = await controller.undo();

    expect(undo.accepted).toBe(true);
    expect(controller.viewModel()).toMatchObject({
      phase: 'playing',
      currentPlayer: 'white',
      moveNumber: 1,
      consecutivePasses: 1,
      finalScore: null,
    });

    const secondPassAgain = await controller.pass();
    expect(secondPassAgain.accepted).toBe(true);
    expect(controller.viewModel().phase).toBe('endgame');

    await controller.finishEndgame();
    expect(controller.viewModel().phase).toBe('finished');
  });
});
