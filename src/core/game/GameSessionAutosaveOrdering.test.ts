import { describe, expect, it } from 'vitest';
import type { EndgameClassifier, EndgameProposal } from '../endgame/EndgameClassifier';
import type { GameRepository, SavedGame } from '../persistence/GameRepository';
import type { GameSessionSnapshot } from '../persistence/GameSessionSnapshot';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession, type GameSessionConfig } from './GameSession';

class EmptyClassifier implements EndgameClassifier {
  async analyze(): Promise<EndgameProposal> {
    return Object.freeze([]);
  }
}

class ControlledRepository implements GameRepository<GameSessionSnapshot> {
  readonly started: SavedGame<GameSessionSnapshot>[] = [];
  private readonly pending: Array<() => void> = [];

  async save(game: SavedGame<GameSessionSnapshot>): Promise<void> {
    this.started.push(game);
    await new Promise<void>((resolve) => this.pending.push(resolve));
  }

  async load(): Promise<SavedGame<GameSessionSnapshot> | null> {
    return null;
  }

  async remove(): Promise<void> {}

  releaseNext(): void {
    const resolve = this.pending.shift();
    if (!resolve) throw new Error('No pending save to release');
    resolve();
  }
}

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

class FailOnceRepository implements GameRepository<GameSessionSnapshot> {
  readonly saved: SavedGame<GameSessionSnapshot>[] = [];
  private shouldFail = true;

  async save(game: SavedGame<GameSessionSnapshot>): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('simulated storage quota failure');
    }
    this.saved.push(JSON.parse(JSON.stringify(game)) as SavedGame<GameSessionSnapshot>);
  }

  async load(): Promise<SavedGame<GameSessionSnapshot> | null> {
    return null;
  }

  async remove(): Promise<void> {}
}

const configFor = (
  repository: GameRepository<GameSessionSnapshot>,
  topology: TorusTopology,
): GameSessionConfig => ({
  endgameClassifier: new EmptyClassifier(),
  scoringStrategy: new ChineseScoring(topology),
  komi: 7.5,
  persistence: {
    repository,
    gameId: 'current',
    now: () => '2026-08-22T09:00:00.000Z',
  },
});

describe('GameSession ordered autosave revisions', () => {
  it('serializes async saves and captures each revision before it enters the queue', async () => {
    const topology = new TorusTopology(9);
    const repository = new ControlledRepository();
    const session = new GameSession(
      new GameEngine(topology),
      configFor(repository, topology),
    );

    expect(session.snapshot().sessionRevision).toBe(0);

    const firstAction = session.execute({ type: 'place-stone', point: '0,0' });
    await Promise.resolve();
    expect(repository.started).toHaveLength(1);
    expect(repository.started[0]?.state.sessionRevision).toBe(1);
    expect(repository.started[0]?.state.history).toHaveLength(2);

    const secondAction = session.execute({ type: 'place-stone', point: '1,1' });
    await Promise.resolve();
    expect(session.snapshot().sessionRevision).toBe(2);
    expect(repository.started).toHaveLength(1);

    repository.releaseNext();
    await firstAction;
    await Promise.resolve();

    expect(repository.started).toHaveLength(2);
    expect(repository.started[1]?.state.sessionRevision).toBe(2);
    expect(repository.started[1]?.state.history).toHaveLength(3);

    repository.releaseNext();
    await secondAction;
  });

  it('keeps an accepted command authoritative when autosave fails and recovers on the next save', async () => {
    const topology = new TorusTopology(9);
    const repository = new FailOnceRepository();
    const session = new GameSession(
      new GameEngine(topology),
      configFor(repository, topology),
    );

    const firstAction = await session.execute({ type: 'place-stone', point: '0,0' });

    expect(firstAction.ok).toBe(true);
    expect(session.state().board['0,0']).toBe('black');
    expect(session.snapshot().sessionRevision).toBe(1);
    expect(repository.saved).toHaveLength(0);

    const secondAction = await session.execute({ type: 'place-stone', point: '1,1' });

    expect(secondAction.ok).toBe(true);
    expect(session.state().board['0,0']).toBe('black');
    expect(session.state().board['1,1']).toBe('white');
    expect(session.snapshot().sessionRevision).toBe(2);
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.state.sessionRevision).toBe(2);
    expect(repository.saved[0]?.state.history).toHaveLength(3);
  });

  it('restores the saved revision and continues monotonically after reload', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const config = configFor(repository, topology);
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, config);

    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    expect(session.snapshot().sessionRevision).toBe(2);

    const restored = await GameSession.load(engine, config);
    expect(restored?.snapshot().sessionRevision).toBe(2);

    await restored!.execute({ type: 'place-stone', point: '1,1' });
    expect(restored?.snapshot().sessionRevision).toBe(3);
  });

  it('treats a legacy v1 snapshot without revision as revision zero', () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    const config: GameSessionConfig = {
      endgameClassifier: new EmptyClassifier(),
      scoringStrategy: new ChineseScoring(topology),
      komi: 7.5,
    };
    const source = new GameSession(engine, config).snapshot();
    const { sessionRevision: _ignored, ...legacySnapshot } = source;

    const restored = GameSession.fromSnapshot(engine, config, legacySnapshot);

    expect(restored.snapshot().sessionRevision).toBe(0);
  });
});
