import { describe, expect, it } from 'vitest';
import { TorusGameController } from './TorusGameController';

const markAllAlive = async (controller: TorusGameController): Promise<void> => {
  for (const group of controller.endgameGroups()) {
    if (controller.nextUnresolvedEndgameGroupId() === null) break;
    await controller.setEndgameDecision(group.id, 'alive');
  }
};

describe('TorusGameController assisted endgame flow', () => {
  it('finishes automatically after two consecutive passes when no groups require review', async () => {
    const controller = new TorusGameController();

    const first = await controller.pass();
    expect(first.accepted).toBe(true);
    expect(first.viewModel.phase).toBe('playing');
    expect(first.viewModel.moveNumber).toBe(1);
    expect(first.viewModel.consecutivePasses).toBe(1);
    expect(first.viewModel.currentPlayer).toBe('white');

    const second = await controller.pass();
    expect(second.accepted).toBe(true);
    expect(second.viewModel.phase).toBe('finished');
    expect(second.viewModel.moveNumber).toBe(2);
    expect(second.viewModel.consecutivePasses).toBe(2);
    expect(second.viewModel.finalScore).not.toBeNull();
    expect(controller.endgameGroups()).toEqual([]);
  });

  it('exposes deterministic stone groups and their topology edges for assisted review', async () => {
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
        edges: [],
      },
      {
        id: '["4,4"]',
        points: ['4,4'],
        color: 'white',
        edges: [],
      },
    ]);
    expect(controller.nextUnresolvedEndgameGroupId()).toBe('["0,0"]');
  });

  it('exposes a seam-connected group as one logical group with one topology edge', async () => {
    const controller = new TorusGameController();
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.placeStone('8,0');
    await controller.pass();
    await controller.pass();

    const black = controller.endgameGroups().find((group) => group.color === 'black');
    expect(black).toMatchObject({
      points: ['0,0', '8,0'],
      edges: [{ from: '0,0', to: '8,0' }],
    });
  });

  it('requires a manual decision for every unresolved group', async () => {
    const controller = new TorusGameController();
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    await controller.setEndgameDecision('["0,0"]', 'alive');
    await expect(controller.finishEndgame()).rejects.toThrow(
      'Missing manual endgame decision',
    );

    expect(controller.viewModel().phase).toBe('endgame');
    expect(controller.endgameGroups()).toHaveLength(2);
    expect(controller.nextUnresolvedEndgameGroupId()).toBe('["4,4"]');
  });

  it('validates manual decisions and completes Chinese scoring through GameSession', async () => {
    const controller = new TorusGameController({ ruleSet: 'chinese', komi: 7.5 });
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    await markAllAlive(controller);
    const finished = await controller.finishEndgame();

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

    await markAllAlive(controller);
    const finished = await controller.finishEndgame();

    expect(finished.viewModel.finalScore?.ruleSet).toBe('japanese');
    expect(finished.viewModel.finalScore?.black).toBe(0);
    expect(finished.viewModel.finalScore?.white).toBe(6.5);
  });

  it('allows Undo after a completed endgame and restores the first-pass state', async () => {
    const controller = new TorusGameController();
    await controller.pass();
    await controller.pass();
    const finished = await controller.finishEndgame();

    expect(finished.viewModel.phase).toBe('finished');

    const undone = await controller.undo();
    expect(undone.accepted).toBe(true);
    expect(undone.viewModel.phase).toBe('playing');
    expect(undone.viewModel.moveNumber).toBe(1);
    expect(undone.viewModel.consecutivePasses).toBe(1);
    expect(undone.viewModel.finalScore).toBeNull();
  });

  it('blocks move/Pass while unresolved assisted review is pending but allows Undo', async () => {
    const controller = new TorusGameController();
    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    expect(controller.viewModel().phase).toBe('endgame');

    const place = await controller.placeStone('1,1');
    const pass = await controller.pass();

    expect(place).toMatchObject({ accepted: false, reason: 'not-playing' });
    expect(pass).toMatchObject({ accepted: false, reason: 'not-playing' });

    const undo = await controller.undo();
    expect(undo).toMatchObject({
      accepted: true,
      reason: null,
      viewModel: {
        phase: 'playing',
        moveNumber: 3,
        consecutivePasses: 1,
        currentPlayer: 'white',
      },
    });
  });
});
