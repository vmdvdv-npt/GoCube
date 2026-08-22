import { describe, expect, it } from 'vitest';
import type { EndgameClassifier } from '../endgame/EndgameClassifier';
import type { GameRepository, SavedGame } from '../persistence/GameRepository';
import type { GameSessionSnapshot } from '../persistence/GameSessionSnapshot';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession } from './GameSession';

class MemoryRepository implements GameRepository<GameSessionSnapshot> {
  private game: SavedGame<GameSessionSnapshot> | null = null;

  async save(game: SavedGame<GameSessionSnapshot>): Promise<void> {
    this.game = JSON.parse(JSON.stringify(game)) as SavedGame<GameSessionSnapshot>;
  }

  async load(id: string): Promise<SavedGame<GameSessionSnapshot> | null> {
    if (!this.game || this.game.id !== id) return null;
    return JSON.parse(JSON.stringify(this.game)) as SavedGame<GameSessionSnapshot>;
  }

  async remove(): Promise<void> {
    this.game = null;
  }
}

const deadClassifier: EndgameClassifier = {
  classify: async (groups) =>
    Object.freeze(
      groups.map((points) =>
        Object.freeze({
          points: Object.freeze([...points]),
          status: 'dead' as const,
          source: 'user' as const,
        }),
      ),
    ),
};

describe('GameSession result persistence', () => {
  it('persists and restores the final endgame classification used for result statistics', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const config = {
      endgameClassifier: deadClassifier,
      scoringStrategy: new ChineseScoring(topology),
      boardSize: 9,
      komi: 0,
      persistence: {
        repository,
        gameId: 'current',
        now: () => '2026-08-20T20:00:00.000Z',
      },
    } as const;
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, config);

    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    expect(session.state().phase).toBe('finished');
    expect(session.snapshot().endgameClassification).toEqual([
      { points: ['0,0'], status: 'dead', source: 'user' },
    ]);

    const saved = await repository.load('current');
    expect(saved?.state.endgameClassification).toEqual(
      session.snapshot().endgameClassification,
    );

    const restored = await GameSession.load(engine, config);
    expect(restored?.snapshot().endgameClassification).toEqual(
      session.snapshot().endgameClassification,
    );

    const undo = await restored!.executeSessionCommand({ type: 'undo' });
    expect(undo.ok).toBe(true);
    expect(restored?.state().phase).toBe('playing');
    expect(restored?.snapshot().endgameClassification).toBeNull();
    expect(restored?.snapshot().finalScore).toBeNull();
  });
});
