import { describe, expect, it } from 'vitest';
import { TorusGameController } from './TorusGameController';

const occupancyAt = (
  controller: TorusGameController,
  logicalPointId: string,
): 'black' | 'white' | 'empty' | undefined =>
  controller
    .viewModel()
    .points.find((point) => point.logicalPointId === logicalPointId)?.occupancy;

describe('TorusGameController', () => {
  it('composes a default 9x9 Chinese game through GameSession and PresentationModel', () => {
    const controller = new TorusGameController();
    const viewModel = controller.viewModel();

    expect(controller.size).toBe(9);
    expect(viewModel.points).toHaveLength(81);
    expect(viewModel.points.every((point) => point.occupancy === 'empty')).toBe(true);
    expect(viewModel).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 0,
      consecutivePasses: 0,
      phase: 'playing',
      captures: { black: 0, white: 0 },
      ruleSet: 'chinese',
      komi: 7.5,
      finalScore: null,
    });
  });

  it('routes point selection through GameSession and returns the updated ViewModel', async () => {
    const controller = new TorusGameController();

    const move = await controller.placeStone('0,0');

    expect(move.accepted).toBe(true);
    expect(move.reason).toBeNull();
    expect(move.viewModel).toMatchObject({
      currentPlayer: 'white',
      moveNumber: 1,
      phase: 'playing',
    });
    expect(occupancyAt(controller, '0,0')).toBe('black');
  });

  it('keeps the presented state unchanged after an invalid occupied-point move', async () => {
    const controller = new TorusGameController();
    await controller.placeStone('0,0');
    const before = JSON.stringify(controller.viewModel());

    const rejected = await controller.placeStone('0,0');

    expect(rejected.accepted).toBe(false);
    expect(rejected.reason).toBe('occupied');
    expect(JSON.stringify(rejected.viewModel)).toBe(before);
    expect(rejected.viewModel.currentPlayer).toBe('white');
    expect(rejected.viewModel.moveNumber).toBe(1);
  });

  it('routes Undo through GameSession and restores presentation state', async () => {
    const controller = new TorusGameController();
    await controller.placeStone('3,4');

    const undo = await controller.undo();

    expect(undo.accepted).toBe(true);
    expect(undo.reason).toBeNull();
    expect(undo.viewModel).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 0,
      consecutivePasses: 0,
      phase: 'playing',
    });
    expect(occupancyAt(controller, '3,4')).toBe('empty');
  });

  it('reports a rejected Undo without inventing UI state', async () => {
    const controller = new TorusGameController();

    const undo = await controller.undo();

    expect(undo.accepted).toBe(false);
    expect(undo.reason).toBe('nothing-to-undo');
    expect(undo.viewModel.moveNumber).toBe(0);
  });

  it('supports Japanese configuration without changing the interaction adapter', async () => {
    const controller = new TorusGameController({
      size: 13,
      ruleSet: 'japanese',
      komi: 6.5,
    });

    const move = await controller.placeStone('12,12');

    expect(controller.size).toBe(13);
    expect(move.viewModel.points).toHaveLength(169);
    expect(move.viewModel.ruleSet).toBe('japanese');
    expect(move.viewModel.komi).toBe(6.5);
    expect(occupancyAt(controller, '12,12')).toBe('black');
  });

  it('rejects non-finite komi at the application composition boundary', () => {
    expect(() => new TorusGameController({ komi: Number.NaN })).toThrow(
      'Komi must be a finite number',
    );
  });
});
