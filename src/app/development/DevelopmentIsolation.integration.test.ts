import { describe, expect, it } from 'vitest';
import type { GameRepository, SavedGame } from '../../core/persistence/GameRepository';
import { GameApplication, type ApplicationSavedState } from '../GameApplication';
import type { AlphaZeroGeneratedGame } from './AlphaZeroGateway';
import { DeveloperReplaySession } from './DeveloperReplaySession';

class RecordingRepo implements GameRepository<ApplicationSavedState> {
  saved: SavedGame<ApplicationSavedState> | null = null;
  saves = 0;
  removes = 0;

  async save(game: SavedGame<ApplicationSavedState>) {
    this.saved = structuredClone(game);
    this.saves += 1;
  }

  async load() {
    return this.saved ? structuredClone(this.saved) : null;
  }

  async remove() {
    this.saved = null;
    this.removes += 1;
  }
}

const generatedGame: AlphaZeroGeneratedGame = Object.freeze({
  protocolVersion: 1,
  topology: 'cube',
  size: 4,
  ruleSet: 'chinese',
  komi: 7.5,
  blackCheckpoint: 'cube4-current',
  whiteCheckpoint: 'cube4-current',
  mctsSimulations: 100,
  moves: Object.freeze([
    Object.freeze({ moveNumber: 1, color: 'black', action: Object.freeze({ type: 'place', pointId: 'front:0:0' }) }),
    Object.freeze({ moveNumber: 2, color: 'white', action: Object.freeze({ type: 'place', pointId: 'front:0:1' }) }),
  ]),
});

describe('Development Workspace persistence isolation', () => {
  it('does not delete, replace, or autosave over the ordinary current game', async () => {
    const repo = new RecordingRepo();
    const app = new GameApplication(repo);
    const normal = await app.createNewGame({
      gameMode: 'cube-2d',
      size: 4,
      ruleSet: 'japanese',
      komi: 6.5,
    });
    if (normal.gameMode !== 'cube-2d') throw new Error('Cube game expected');
    await normal.controller.placeStone('front:1:1');

    const savedBeforeDevelopment = structuredClone(repo.saved);
    const savesBeforeDevelopment = repo.saves;
    const normalSnapshotBeforeDevelopment = structuredClone(normal.controller.snapshot());

    const replay = new DeveloperReplaySession(generatedGame);
    await replay.jumpToEnd();

    expect(repo.saves).toBe(savesBeforeDevelopment);
    expect(repo.removes).toBe(0);
    expect(repo.saved).toEqual(savedBeforeDevelopment);
    expect(normal.controller.snapshot()).toEqual(normalSnapshotBeforeDevelopment);

    const restored = await new GameApplication(repo).restoreSavedGame();
    if (!restored || restored.gameMode !== 'cube-2d') throw new Error('Saved Cube game expected');
    expect(restored.controller.snapshot()).toEqual(normalSnapshotBeforeDevelopment);
  });
});
