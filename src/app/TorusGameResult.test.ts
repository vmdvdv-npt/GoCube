import { describe, expect, it } from 'vitest';
import { TorusGameController } from './TorusGameController';

describe('TorusGameController result model', () => {
  it('exposes saved match statistics after manual classification and clears them after Undo', async () => {
    const controller = new TorusGameController({ size: 13, ruleSet: 'chinese', komi: 7.5 });
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    expect(controller.resultModel()).toBeNull();

    for (const group of controller.endgameGroups()) {
      await controller.setEndgameDecision(
        group.id,
        group.color === 'black' ? 'dead' : 'alive',
      );
    }
    await controller.finishEndgame();

    expect(controller.resultModel()).toMatchObject({
      statistics: {
        totalActions: 4,
        passes: 2,
        boardSize: 13,
        ruleSet: 'chinese',
        captures: { black: 0, white: 0 },
        deadStones: { black: 1, white: 0 },
        deadGroups: { black: 1, white: 0 },
      },
      score: {
        ruleSet: 'chinese',
        komi: 7.5,
      },
    });

    await controller.undo();
    expect(controller.resultModel()).toBeNull();
  });

  it('preserves Japanese scoring details for the result dialog', async () => {
    const controller = new TorusGameController({ ruleSet: 'japanese', komi: 6.5 });
    await controller.pass();
    await controller.pass();
    await controller.finishEndgame();

    expect(controller.resultModel()).toMatchObject({
      statistics: { totalActions: 2, passes: 2, ruleSet: 'japanese' },
      score: { ruleSet: 'japanese', komi: 6.5, prisoners: { black: 0, white: 0 } },
    });
  });
});
