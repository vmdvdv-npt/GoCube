import { describe, expect, it } from 'vitest';
import type { GameViewModel } from '../presentation/PresentationModel';
import { Cube2DGameController } from './Cube2DGameController';
import { TorusGameController } from './TorusGameController';

type ActionLike = Readonly<{
  accepted: boolean;
  viewModel: GameViewModel;
}>;

interface SharedController {
  viewModel(): GameViewModel;
  pass(): Promise<ActionLike>;
  finishEndgame(): Promise<ActionLike>;
  resultModel(): unknown;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): Promise<ActionLike>;
  redo(): Promise<ActionLike>;
  endgameGroups(): readonly unknown[];
  endgameManualGroupIds(): readonly string[];
  nextUnresolvedEndgameGroupId(): string | null;
  endgameReviewReady(): boolean;
  canFinishEndgame(): boolean;
  subscribeEndgameReviewReady(listener: () => void): () => void;
  dispose(): void;
}

const cases: readonly [string, () => SharedController][] = [
  ['torus', () => new TorusGameController({ size: 9, komi: 0 })],
  ['cube', () => new Cube2DGameController({ size: 4, komi: 0 })],
];

describe.each(cases)('%s controller shared gameplay lifecycle', (_name, createController) => {
  it('keeps pass, endgame, result, undo/redo, and disposal semantics aligned', async () => {
    const controller = createController();

    expect(controller.viewModel().phase).toBe('playing');

    const firstPass = await controller.pass();
    expect(firstPass.accepted).toBe(true);
    expect(firstPass.viewModel.phase).toBe('playing');

    const secondPass = await controller.pass();
    expect(secondPass.accepted).toBe(true);
    expect(secondPass.viewModel.phase).toBe('endgame');
    expect(controller.endgameReviewReady()).toBe(true);
    expect(controller.endgameGroups()).toEqual([]);
    expect(controller.endgameManualGroupIds()).toEqual([]);
    expect(controller.nextUnresolvedEndgameGroupId()).toBeNull();
    expect(controller.canFinishEndgame()).toBe(true);

    const finished = await controller.finishEndgame();
    expect(finished.accepted).toBe(true);
    expect(finished.viewModel.phase).toBe('finished');
    expect(controller.resultModel()).not.toBeNull();
    expect(controller.canUndo()).toBe(true);

    const undone = await controller.undo();
    expect(undone.accepted).toBe(true);
    expect(undone.viewModel.phase).toBe('playing');
    expect(controller.canRedo()).toBe(true);

    const redone = await controller.redo();
    expect(redone.accepted).toBe(true);
    expect(redone.viewModel.phase).toBe('finished');
    expect(controller.resultModel()).not.toBeNull();

    expect(() => controller.dispose()).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
  });

  it('treats endgame as pending until the async review exists', async () => {
    const controller = createController();
    await controller.pass();

    let readyNotifications = 0;
    const unsubscribe = controller.subscribeEndgameReviewReady(() => {
      readyNotifications += 1;
    });

    const secondPass = controller.pass();

    expect(controller.viewModel().phase).toBe('endgame');
    expect(controller.endgameReviewReady()).toBe(false);
    expect(controller.canFinishEndgame()).toBe(false);
    expect(readyNotifications).toBe(0);

    const completed = await secondPass;
    expect(completed.accepted).toBe(true);
    expect(completed.viewModel.phase).toBe('endgame');
    expect(controller.endgameReviewReady()).toBe(true);
    expect(controller.canFinishEndgame()).toBe(true);
    expect(readyNotifications).toBe(1);

    let lateReadyNotifications = 0;
    const unsubscribeLate = controller.subscribeEndgameReviewReady(() => {
      lateReadyNotifications += 1;
    });
    expect(lateReadyNotifications).toBe(1);

    unsubscribeLate();
    unsubscribe();
    controller.dispose();
  });
});
