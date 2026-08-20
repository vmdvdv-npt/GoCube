import { describe, expect, it } from 'vitest';
import { TorusGameController } from './TorusGameController';

const allAlive = (controller: TorusGameController) =>
  Object.fromEntries(
    controller.endgameGroups().map((group) => [group.id, 'alive' as const]),
  );

describe('TorusGameController manual endgame flow', () => {
  it('exposes Pass and enters manual endgame after two consecutive passes', async () => {
    const controller = new TorusGameController();

    const first = await controller.pass();
    expect(first.accepted).toBe(true);
    expect(first.viewModel.phase).toBe('playing');
    expect(first.viewModel.moveNumber).toBe(1);
    expect(first.viewModel.consecutivePasses).toBe(1);
    expect(first.viewModel.currentPlayer).toBe('white');

    const second = await controller.pass();
    expect(second.accepted).toBe(true);
    expect(second.viewModel.phase).toBe('endgame');
    expect(second.viewModel.moveNumber).toBe(2);
    expect(second.viewModel.consecutivePasses).toBe(2);
    expect(second.viewModel.finalScore).toBeNull();
    expect(controller.endgameGroups()).toEqual([]);
  });

  it('exposes deterministic stone groups for explicit alive/dead/seki decisions', async () => {
    const controller = new TorusGameController();
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    const endgame = await controller.pass();

    expect(endgame.viewModel.phase).toBe('endgame');
    expect(controller.endgameGroups()).toEqual([
      {
        id: '["0,0"]',
        points: ['0,0'],
        color: 'black',
      },
      {
        id: '["4,4"]',
        points: ['4,4'],
        color: 'white',
      },
    ]);
  });

  it('requires a manual decision for every requested group', async () => {
    const controller = new TorusGameController();
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    await expect(
      controller.finishEndgame({ '["0,0"]': 'alive' }),
    ).rejects.toThrow('Missing manual endgame decision');

    expect(controller.viewModel().phase).toBe('endgame');
    expect(controller.endgameGroups()).toHaveLength(2);
  });

  it('validates manual decisions and completes Chinese scoring through GameSession', async () => {
    const controller = new TorusGameController({ ruleSet: 'chinese', komi: 7.5 });
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    const finished = await controller.finishEndgame(allAlive(controller));

    expect(finished.accepted).toBe(true);
    expect(finished.viewModel.phase).toBe('finished');
    expect(finished.viewModel.finalScore).not.toBeNull();
    expect(finished.viewModel.finalScore?.ruleSet).toBe('chinese');
    expect(finished.viewModel.finalScore?.black).toBe(1);
    expect(finished.viewModel.finalScore?.white).toBe(8.5);
    expect(finished.viewModel.finalScore?.winner).toBe('white');
    expect(finished.viewModel.finalScore?.margin).toBe(7.5);
    expect(controller.endgameGroups()).toEqual([]);
  });

  it('uses the configured Japanese scoring strategy after manual classification', async () => {
    const controller = new TorusGameController({ ruleSet: 'japanese', komi: 6.5 });
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    const finished = await controller.finishEndgame(allAlive(controller));

    expect(finished.viewModel.finalScore?.ruleSet).toBe('japanese');
    expect(finished.viewModel.finalScore?.black).toBe(0);
    expect(finished.viewModel.finalScore?.white).toBe(6.5);
  });

  it('allows Undo after a completed endgame and restores the first-pass state', async () => {
    const controller = new TorusGameController();
    await controller.pass();
    await controller.pass();
    const finished = await controller.finishEndgame({});

    expect(finished.viewModel.phase).toBe('finished');

    const undone = await controller.undo();
    expect(undone.accepted).toBe(true);
    expect(undone.viewModel.phase).toBe('playing');
    expect(undone.viewModel.moveNumber).toBe(1);
    expect(undone.viewModel.consecutivePasses).toBe(1);
    expect(undone.viewModel.finalScore).toBeNull();
  });

  it('does not allow concurrent game commands while manual classification is pending', async () => {
    const controller = new TorusGameController();
    await controller.pass();
    await controller.pass();

    const place = await controller.placeStone('0,0');
    const pass = await controller.pass();
    const undo = await controller.undo();

    expect(place).toMatchObject({ accepted: false, reason: 'not-playing' });
    expect(pass).toMatchObject({ accepted: false, reason: 'not-playing' });
    expect(undo).toMatchObject({ accepted: false, reason: 'not-playing' });
  });
});
