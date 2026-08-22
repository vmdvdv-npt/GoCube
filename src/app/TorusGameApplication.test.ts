import { describe, expect, it } from 'vitest';
import type { GameRepository, SavedGame } from '../core/persistence/GameRepository';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import {
  CURRENT_GAME_ID,
  TorusGameApplication,
} from './TorusGameApplication';

class MemoryRepository implements GameRepository<GameSessionSnapshot> {
  saved: SavedGame<GameSessionSnapshot> | null = null;
  saves = 0;
  removes = 0;

  async save(game: SavedGame<GameSessionSnapshot>): Promise<void> {
    this.saved = JSON.parse(JSON.stringify(game)) as SavedGame<GameSessionSnapshot>;
    this.saves += 1;
  }

  async load(id: string): Promise<SavedGame<GameSessionSnapshot> | null> {
    if (!this.saved || this.saved.id !== id) return null;
    return JSON.parse(JSON.stringify(this.saved)) as SavedGame<GameSessionSnapshot>;
  }

  async remove(id: string): Promise<void> {
    if (this.saved?.id === id) this.saved = null;
    this.removes += 1;
  }
}

describe('TorusGameApplication New Game and restore', () => {
  it('creates a configured game in the application layer and persists its initial snapshot', async () => {
    const repository = new MemoryRepository();
    const application = new TorusGameApplication(
      repository,
      () => '2026-08-20T20:00:00.000Z',
    );

    const controller = await application.createNewGame({
      size: 13,
      ruleSet: 'japanese',
      komi: 6.5,
    });

    expect(controller.size).toBe(13);
    expect(controller.viewModel()).toMatchObject({
      ruleSet: 'japanese',
      komi: 6.5,
      moveNumber: 0,
      currentPlayer: 'black',
    });
    expect(repository.saved).toMatchObject({
      id: CURRENT_GAME_ID,
      savedAt: '2026-08-20T20:00:00.000Z',
      state: {
        version: 1,
        boardSize: 13,
        ruleSet: 'japanese',
        komi: 6.5,
        finalScore: null,
      },
    });
    expect(repository.saved?.state.history).toHaveLength(1);
  });

  it('autosaves actions and restores the exact unfinished session for continuation', async () => {
    const repository = new MemoryRepository();
    const application = new TorusGameApplication(repository);
    const controller = await application.createNewGame({
      size: 19,
      ruleSet: 'chinese',
      komi: 7.5,
    });

    await controller.placeStone('0,0');
    await controller.pass();

    expect(repository.saved?.state.history).toHaveLength(3);
    expect(repository.saved?.state.history.at(-1)).toMatchObject({
      currentPlayer: 'black',
      moveNumber: 2,
      consecutivePasses: 1,
      phase: 'playing',
    });

    const reopened = new TorusGameApplication(repository);
    await expect(reopened.findUnfinishedGame()).resolves.toMatchObject({
      size: 19,
      ruleSet: 'chinese',
      komi: 7.5,
      moveNumber: 2,
      phase: 'playing',
    });

    const restored = await reopened.restoreUnfinishedGame();
    expect(restored).not.toBeNull();
    expect(restored?.size).toBe(19);
    expect(restored?.viewModel()).toEqual(controller.viewModel());

    const undo = await restored!.undo();
    expect(undo.accepted).toBe(true);
    expect(undo.viewModel).toMatchObject({
      moveNumber: 1,
      currentPlayer: 'white',
      consecutivePasses: 0,
    });
    expect(repository.saved?.state.history).toHaveLength(2);
  });

  it('restores a saved manual-endgame state instead of losing the second Pass', async () => {
    const repository = new MemoryRepository();
    const application = new TorusGameApplication(repository);
    const controller = await application.createNewGame({
      size: 9,
      ruleSet: 'chinese',
      komi: 7.5,
    });

    await controller.placeStone('0,0');
    await controller.placeStone('4,4');
    await controller.pass();
    await controller.pass();

    expect(repository.saved?.state.history.at(-1)).toMatchObject({
      moveNumber: 4,
      consecutivePasses: 2,
      phase: 'endgame',
    });

    const restored = await new TorusGameApplication(repository).restoreUnfinishedGame();
    expect(restored?.viewModel().phase).toBe('endgame');
    expect(restored?.endgameGroups()).toEqual(controller.endgameGroups());
  });

  it('does not offer a finished saved game for continuation', async () => {
    const repository = new MemoryRepository();
    const application = new TorusGameApplication(repository);
    const controller = await application.createNewGame({
      size: 9,
      ruleSet: 'chinese',
      komi: 0,
    });

    await controller.pass();
    await controller.pass();
    await controller.finishEndgame();

    expect(repository.saved?.state.finalScore).not.toBeNull();
    expect(repository.saved?.state.history.at(-1)?.phase).toBe('finished');
    await expect(application.findUnfinishedGame()).resolves.toBeNull();
    await expect(application.restoreUnfinishedGame()).resolves.toBeNull();
  });

  it('removes a structurally corrupted save and boots as if no save existed', async () => {
    const repository = new MemoryRepository();
    repository.saved = {
      id: CURRENT_GAME_ID,
      savedAt: 'broken',
      state: {
        version: 1,
        boardSize: 17,
        ruleSet: 'chinese',
        komi: 7.5,
        history: [],
        finalScore: null,
      } as unknown as GameSessionSnapshot,
    };

    const application = new TorusGameApplication(repository);

    await expect(application.findUnfinishedGame()).resolves.toBeNull();
    expect(repository.saved).toBeNull();
    expect(repository.removes).toBe(1);
  });
});
