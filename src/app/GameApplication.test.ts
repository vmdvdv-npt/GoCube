import { describe, expect, it } from 'vitest';
import type { GameRepository, SavedGame } from '../core/persistence/GameRepository';
import { GameApplication, type ApplicationSavedState } from './GameApplication';

class MemoryRepo implements GameRepository<ApplicationSavedState> {
  saved: SavedGame<ApplicationSavedState> | null = null;
  removes = 0;
  async save(game: SavedGame<ApplicationSavedState>) { this.saved = structuredClone(game); }
  async load(id: string) { return this.saved?.id === id ? structuredClone(this.saved) : null; }
  async remove(id: string) { if (this.saved?.id === id) this.saved = null; this.removes += 1; }
}

describe('GameApplication 0.2 modes', () => {
  it.each([2, 3, 4, 5] as const)('creates Cube 2D %d×%d and persists gameMode', async (size) => {
    const repo = new MemoryRepo(); const app = new GameApplication(repo, () => '2026-08-21T16:00:00.000Z');
    const active = await app.createNewGame({ gameMode: 'cube-2d', size, ruleSet: 'japanese', komi: 7.5 });
    expect(active.gameMode).toBe('cube-2d');
    if (active.gameMode !== 'cube-2d') throw new Error('Cube expected');
    expect(active.controller.size).toBe(size); expect(repo.saved?.state.gameMode).toBe('cube-2d'); expect(repo.saved?.state.snapshot.boardSize).toBe(size);
  });

  it.each([9, 13, 19] as const)('keeps Torus 2D %d×%d available', async (size) => {
    const active = await new GameApplication(new MemoryRepo()).createNewGame({ gameMode: 'torus-2d', size, ruleSet: 'chinese', komi: 6.5 });
    expect(active.gameMode).toBe('torus-2d'); if (active.gameMode !== 'torus-2d') throw new Error('Torus expected'); expect(active.controller.size).toBe(size);
  });

  it('rejects mixed mode/size combinations', async () => {
    const app = new GameApplication(new MemoryRepo());
    await expect(app.createNewGame({ gameMode: 'cube-2d', size: 19, ruleSet: 'japanese', komi: 7.5 })).rejects.toThrow('Unsupported cube-2d size');
    await expect(app.createNewGame({ gameMode: 'torus-2d', size: 4, ruleSet: 'japanese', komi: 7.5 })).rejects.toThrow('Unsupported torus-2d size');
  });

  it('autosaves and restores the exact Cube session', async () => {
    const repo = new MemoryRepo(); const app = new GameApplication(repo);
    const active = await app.createNewGame({ gameMode: 'cube-2d', size: 3, ruleSet: 'japanese', komi: 7.5 });
    if (active.gameMode !== 'cube-2d') throw new Error('Cube expected');
    await active.controller.placeStone('front:1:1'); await active.controller.placeStone('right:1:1'); await active.controller.pass();
    const before = active.controller.snapshot(); expect(repo.saved?.state.gameMode).toBe('cube-2d'); expect(repo.saved?.state.snapshot.history).toHaveLength(4);
    await expect(app.findSavedGame()).resolves.toMatchObject({ gameMode: 'cube-2d', size: 3, moveNumber: 3, ruleSet: 'japanese', komi: 7.5 });
    const restored = await new GameApplication(repo).restoreSavedGame(); expect(restored?.gameMode).toBe('cube-2d');
    if (!restored || restored.gameMode !== 'cube-2d') throw new Error('Cube restore failed'); expect(restored.controller.snapshot()).toEqual(before);
  });

  it('restores Torus through the same lifecycle', async () => {
    const repo = new MemoryRepo(); const app = new GameApplication(repo); const active = await app.createNewGame({ gameMode: 'torus-2d', size: 9, ruleSet: 'chinese', komi: 0 });
    if (active.gameMode !== 'torus-2d') throw new Error('Torus expected'); await active.controller.placeStone('0,0');
    const restored = await new GameApplication(repo).restoreSavedGame(); expect(restored?.gameMode).toBe('torus-2d');
    if (!restored || restored.gameMode !== 'torus-2d') throw new Error('Torus restore failed'); expect(restored.controller.viewModel()).toEqual(active.controller.viewModel());
  });
});
