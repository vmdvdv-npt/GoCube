import { describe, expect, it } from 'vitest';
import type {
  EndgameAnalysisContext,
  EndgameClassifier,
  EndgameProposal,
} from '../endgame/EndgameClassifier';
import type { GameRepository, SavedGame } from '../persistence/GameRepository';
import type { GameSessionSnapshot } from '../persistence/GameSessionSnapshot';
import { ChineseScoring } from '../scoring/ChineseScoring';
import { JapaneseScoring } from '../scoring/JapaneseScoring';
import { TorusTopology } from '../topology/TorusTopology';
import { GameEngine } from './GameEngine';
import { GameSession, type GameSessionConfig } from './GameSession';

class EmptyClassifier implements EndgameClassifier {
  async analyze(): Promise<EndgameProposal> {
    return Object.freeze([]);
  }
}

class MixedClassifier implements EndgameClassifier {
  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    return Object.freeze(
      context.groups.map((points, index) =>
        Object.freeze(
          index === 0
            ? { points, status: 'alive' as const, source: 'automatic' as const, evidence: { proof: 'stub' } }
            : { points, status: 'unresolved' as const },
        ),
      ),
    );
  }
}

class MemoryRepository implements GameRepository<GameSessionSnapshot> {
  readonly saves: SavedGame<GameSessionSnapshot>[] = [];
  private readonly games = new Map<string, SavedGame<GameSessionSnapshot>>();

  async save(game: SavedGame<GameSessionSnapshot>): Promise<void> {
    const copy = JSON.parse(JSON.stringify(game)) as SavedGame<GameSessionSnapshot>;
    this.saves.push(copy);
    this.games.set(copy.id, copy);
  }

  async load(id: string): Promise<SavedGame<GameSessionSnapshot> | null> {
    const game = this.games.get(id);
    return game ? (JSON.parse(JSON.stringify(game)) as SavedGame<GameSessionSnapshot>) : null;
  }

  async remove(id: string): Promise<void> {
    this.games.delete(id);
  }
}

const persistentConfig = (
  repository: GameRepository<GameSessionSnapshot>,
  scoringStrategy: GameSessionConfig['scoringStrategy'],
  komi = 7.5,
  endgameClassifier: EndgameClassifier = new EmptyClassifier(),
): GameSessionConfig => ({
  endgameClassifier,
  scoringStrategy,
  komi,
  persistence: {
    repository,
    gameId: 'current',
    now: () => '2026-08-20T18:00:00.000Z',
  },
});

describe('GameSession persistence', () => {
  it('autosaves every accepted action but never a rejected move', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const session = new GameSession(
      new GameEngine(topology),
      persistentConfig(repository, new ChineseScoring(topology)),
    );

    const move = await session.execute({ type: 'place-stone', point: '0,0' });
    expect(move.ok).toBe(true);
    expect(repository.saves).toHaveLength(1);
    expect(repository.saves[0]).toMatchObject({
      id: 'current',
      savedAt: '2026-08-20T18:00:00.000Z',
      state: {
        version: 1,
        ruleSet: 'chinese',
        komi: 7.5,
        redo: [],
      },
    });
    expect(repository.saves[0]?.state.history).toHaveLength(2);

    const rejected = await session.execute({ type: 'place-stone', point: '0,0' });
    expect(rejected).toMatchObject({ ok: false, reason: 'occupied' });
    expect(repository.saves).toHaveLength(1);

    await session.execute({ type: 'pass' });
    expect(repository.saves).toHaveLength(2);
    expect(repository.saves[1]?.state.history.at(-1)).toMatchObject({
      moveNumber: 2,
      consecutivePasses: 1,
      phase: 'playing',
    });
  });

  it('restores the full linear history and can continue with Undo', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const config = persistentConfig(repository, new ChineseScoring(topology), 6.5);
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, config);

    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'place-stone', point: '1,1' });

    const beforeRestore = JSON.stringify(session.snapshot());
    const restored = await GameSession.load(engine, config);

    expect(restored).not.toBeNull();
    expect(restored?.historyLength()).toBe(4);
    expect(JSON.stringify(restored?.snapshot())).toBe(beforeRestore);
    expect(restored?.state()).toEqual(session.state());

    const undo = await restored!.executeSessionCommand({ type: 'undo' });
    expect(undo.ok).toBe(true);
    expect(restored?.state()).toMatchObject({
      moveNumber: 2,
      consecutivePasses: 1,
      phase: 'playing',
    });
    expect(repository.saves).toHaveLength(4);
  });

  it('persists proposal, unresolved status, evidence and user override through reload', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const config = persistentConfig(
      repository,
      new ChineseScoring(topology),
      7.5,
      new MixedClassifier(),
    );
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, config);

    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'place-stone', point: '4,4' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    expect(session.state().phase).toBe('endgame');
    expect(session.endgameReview()).toEqual({
      groups: [
        {
          points: ['0,0'],
          proposal: { status: 'alive', evidence: { proof: 'stub' } },
          userDecision: null,
        },
        {
          points: ['4,4'],
          proposal: { status: 'unresolved' },
          userDecision: null,
        },
      ],
    });

    await session.setEndgameReviewDecision(['4,4'], 'seki');
    const stored = repository.saves.at(-1)?.state.endgameReview;
    expect(stored).toEqual({
      groups: [
        {
          points: ['0,0'],
          proposal: { status: 'alive', evidence: { proof: 'stub' } },
          userDecision: null,
          status: 'alive',
        },
        {
          points: ['4,4'],
          proposal: { status: 'unresolved' },
          userDecision: 'seki',
          status: 'seki',
        },
      ],
    });

    const restored = await GameSession.load(engine, config);
    expect(restored?.state().phase).toBe('endgame');
    expect(restored?.endgameReview()).toEqual(session.endgameReview());
  });

  it('reads legacy v1 partial review status as a user decision without losing it', () => {
    const topology = new TorusTopology(9);
    const engine = new GameEngine(topology);
    const initial = engine.createInitialState();
    const endgame = {
      ...initial,
      board: Object.freeze({ ...initial.board, '0,0': 'black' as const }),
      moveNumber: 2,
      consecutivePasses: 2,
      phase: 'endgame' as const,
    };
    const snapshot: GameSessionSnapshot = Object.freeze({
      version: 1,
      ruleSet: 'chinese',
      komi: 7.5,
      history: Object.freeze([initial, endgame]),
      redo: Object.freeze([]),
      endgameReview: Object.freeze({
        groups: Object.freeze([
          Object.freeze({ points: Object.freeze(['0,0']), status: 'dead' as const }),
        ]),
      }),
      endgameClassification: null,
      finalScore: null,
    });

    const session = GameSession.fromSnapshot(
      engine,
      persistentConfig(new MemoryRepository(), new ChineseScoring(topology)),
      snapshot,
    );

    expect(session.endgameReview()).toEqual({
      groups: [
        { points: ['0,0'], proposal: { status: 'unresolved' }, userDecision: 'dead' },
      ],
    });
  });

  it('persists the Redo future across Undo, save and reload', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const config = persistentConfig(repository, new ChineseScoring(topology));
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, config);

    await session.execute({ type: 'place-stone', point: '0,0' });
    await session.execute({ type: 'place-stone', point: '1,1' });
    const stateBeforeUndo = session.state();

    const undo = await session.executeSessionCommand({ type: 'undo' });
    expect(undo.ok).toBe(true);
    expect(session.canRedo()).toBe(true);
    expect(repository.saves.at(-1)?.state.redo).toHaveLength(1);
    expect(repository.saves.at(-1)?.state.redo?.at(-1)?.state).toEqual(stateBeforeUndo);

    const restored = await GameSession.load(engine, config);
    expect(restored?.canRedo()).toBe(true);

    const redo = await restored!.executeSessionCommand({ type: 'redo' });
    expect(redo.ok).toBe(true);
    expect(restored?.state()).toEqual(stateBeforeUndo);
    expect(restored?.canRedo()).toBe(false);
    expect(repository.saves.at(-1)?.state.redo).toEqual([]);
  });

  it('persists and restores a finished result, then preserves that result through reload and Redo', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const config = persistentConfig(repository, new ChineseScoring(topology), 5.5);
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, config);

    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });

    const finishedScore = session.finalScore();
    const stored = repository.saves.at(-1)?.state;
    expect(stored?.history.at(-1)?.phase).toBe('finished');
    expect(stored?.finalScore).toEqual(finishedScore);
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);

    const restored = await GameSession.load(engine, config);
    expect(restored?.state().phase).toBe('finished');
    expect(restored?.finalScore()).toEqual(finishedScore);

    const undo = await restored!.executeSessionCommand({ type: 'undo' });
    expect(undo.ok).toBe(true);
    expect(restored?.state()).toMatchObject({
      moveNumber: 1,
      consecutivePasses: 1,
      phase: 'playing',
    });
    expect(restored?.finalScore()).toBeNull();
    expect(repository.saves.at(-1)?.state.finalScore).toBeNull();
    expect(repository.saves.at(-1)?.state.redo?.at(-1)).toMatchObject({
      state: { phase: 'finished' },
      finalScore: finishedScore,
    });

    const restoredAfterUndo = await GameSession.load(engine, config);
    expect(restoredAfterUndo?.canRedo()).toBe(true);
    expect(restoredAfterUndo?.finalScore()).toBeNull();

    const redo = await restoredAfterUndo!.executeSessionCommand({ type: 'redo' });
    expect(redo.ok).toBe(true);
    expect(restoredAfterUndo?.state().phase).toBe('finished');
    expect(restoredAfterUndo?.finalScore()).toEqual(finishedScore);
  });

  it('rejects restoration through a different rule set or komi', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const engine = new GameEngine(topology);
    const chinese = persistentConfig(repository, new ChineseScoring(topology), 7.5);
    const session = new GameSession(engine, chinese);

    await session.execute({ type: 'place-stone', point: '0,0' });

    await expect(
      GameSession.load(
        engine,
        persistentConfig(repository, new JapaneseScoring(topology), 7.5),
      ),
    ).rejects.toThrow('Saved rule set mismatch');

    await expect(
      GameSession.load(
        engine,
        persistentConfig(repository, new ChineseScoring(topology), 6.5),
      ),
    ).rejects.toThrow('Saved komi mismatch');
  });

  it('returns null when there is no saved current game', async () => {
    const topology = new TorusTopology(9);
    const repository = new MemoryRepository();
    const config = persistentConfig(repository, new ChineseScoring(topology));

    await expect(GameSession.load(new GameEngine(topology), config)).resolves.toBeNull();
  });
});
