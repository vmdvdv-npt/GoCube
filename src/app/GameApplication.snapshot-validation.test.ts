import { describe, expect, it } from 'vitest';
import type { GameRepository, SavedGame } from '../core/persistence/GameRepository';
import { GameApplication, type ApplicationSavedState } from './GameApplication';

class MemoryRepository implements GameRepository<ApplicationSavedState> {
  saved: SavedGame<ApplicationSavedState> | null = null;
  removes = 0;

  async save(game: SavedGame<ApplicationSavedState>): Promise<void> {
    this.saved = structuredClone(game);
  }

  async load(id: string): Promise<SavedGame<ApplicationSavedState> | null> {
    return this.saved?.id === id ? structuredClone(this.saved) : null;
  }

  async remove(id: string): Promise<void> {
    if (this.saved?.id === id) this.saved = null;
    this.removes += 1;
  }
}

type MutableSavedState = {
  state: {
    snapshot: {
      history: Array<Record<string, unknown>>;
    };
  };
};

const currentStateOf = (repo: MemoryRepository): Record<string, unknown> => {
  if (!repo.saved) throw new Error('Expected saved game');
  const mutable = repo.saved as unknown as MutableSavedState;
  const current = mutable.state.snapshot.history.at(-1);
  if (!current) throw new Error('Expected current state');
  return current;
};

const boardOf = (state: Record<string, unknown>): Record<string, unknown> => {
  const board = state.board;
  if (typeof board !== 'object' || board === null || Array.isArray(board)) {
    throw new Error('Expected board object');
  }
  return board as Record<string, unknown>;
};

describe('GameApplication saved GameState trust boundary', () => {
  it('does not expose Continue when the saved board schema is corrupted', async () => {
    const repo = new MemoryRepository();
    const app = new GameApplication(repo);
    await app.createNewGame({
      gameMode: 'torus-2d',
      size: 9,
      ruleSet: 'japanese',
      komi: 7.5,
    });

    currentStateOf(repo).board = null;

    await expect(new GameApplication(repo).findSavedGame()).resolves.toBeNull();
    expect(repo.saved).toBeNull();
    expect(repo.removes).toBe(1);
  });

  it('rejects a board whose point set or occupancy does not match the saved topology', async () => {
    const repo = new MemoryRepository();
    const app = new GameApplication(repo);
    await app.createNewGame({
      gameMode: 'cube-2d',
      size: 3,
      ruleSet: 'chinese',
      komi: 6.5,
    });

    boardOf(currentStateOf(repo))['front:0:0'] = 'corrupted';

    await expect(new GameApplication(repo).restoreSavedGame()).resolves.toBeNull();
    expect(repo.saved).toBeNull();
    expect(repo.removes).toBe(1);
  });

  it('rejects invalid rule-relevant scalar state before building a save summary', async () => {
    const repo = new MemoryRepository();
    const app = new GameApplication(repo);
    await app.createNewGame({
      gameMode: 'torus-2d',
      size: 9,
      ruleSet: 'chinese',
      komi: 0,
    });

    const current = currentStateOf(repo);
    current.currentPlayer = 'green';
    current.moveNumber = Number.NaN;
    current.captures = { black: 0, white: -1 };

    await expect(new GameApplication(repo).findSavedGame()).resolves.toBeNull();
    expect(repo.saved).toBeNull();
    expect(repo.removes).toBe(1);
  });
});
