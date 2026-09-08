import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistedEndgameClassifier } from '../core/endgame/AssistedEndgameClassifier';
import { GameEngine } from '../core/game/GameEngine';
import type { GameState } from '../core/game/types';
import type { ActiveGameRepository, SavedGame } from '../core/persistence/GameRepository';
import {
  GAME_SESSION_SNAPSHOT_VERSION,
  type GameSessionSnapshot,
} from '../core/persistence/GameSessionSnapshot';
import { CubeTopology } from '../core/topology/CubeTopology';
import { TorusTopology } from '../core/topology/TorusTopology';
import type { PointId, Topology } from '../core/topology/Topology';
import {
  APPLICATION_SAVE_VERSION,
  CURRENT_GAME_ID,
  GameApplication,
  type ApplicationSavedState,
  type GameMode,
} from './GameApplication';

class Repo implements ActiveGameRepository<ApplicationSavedState> {
  saved: SavedGame<ApplicationSavedState> | null = null;
  saves = 0;

  async save(game: SavedGame<ApplicationSavedState>): Promise<void> {
    this.saved = structuredClone(game);
    this.saves += 1;
  }

  async activate(game: SavedGame<ApplicationSavedState>): Promise<void> {
    this.saved = structuredClone(game);
  }

  async load(): Promise<SavedGame<ApplicationSavedState> | null> {
    return this.saved ? structuredClone(this.saved) : null;
  }

  async remove(): Promise<void> {
    this.saved = null;
  }
}

interface LegacyFixture {
  readonly gameMode: GameMode;
  readonly boardSize: number;
  readonly topology: Topology;
  readonly moves: readonly PointId[];
}

const fixtureFor = (gameMode: GameMode): LegacyFixture =>
  gameMode === 'torus-2d'
    ? Object.freeze({
        gameMode,
        boardSize: 9,
        topology: new TorusTopology(9),
        moves: Object.freeze(['0,0']),
      })
    : Object.freeze({
        gameMode,
        boardSize: 2,
        topology: new CubeTopology(2),
        moves: Object.freeze(['front:0:0']),
      });

const createLegacyEndgameSnapshot = (
  fixture: LegacyFixture,
  moves: readonly PointId[] = fixture.moves,
): GameSessionSnapshot => {
  const engine = new GameEngine(fixture.topology);
  const history: GameState[] = [engine.createInitialState()];

  for (const point of moves) {
    const current = history.at(-1)!;
    const previousBoard = history.length >= 2 ? history.at(-2)!.board : null;
    const result = engine.placeStone(
      current,
      point,
      current.currentPlayer,
      Object.freeze({ previousBoard }),
    );
    if (!result.ok) throw new Error(`Fixture move rejected: ${point} (${result.reason})`);
    history.push(result.state);
  }

  for (let passIndex = 0; passIndex < 2; passIndex += 1) {
    const result = engine.pass(history.at(-1)!);
    if (!result.ok) throw new Error('Fixture Pass rejected');
    history.push(result.state);
  }

  if (history.at(-1)!.phase !== 'endgame') {
    throw new Error('Fixture must end in endgame');
  }

  return Object.freeze({
    version: GAME_SESSION_SNAPSHOT_VERSION,
    boardSize: fixture.boardSize,
    sessionRevision: 0,
    ruleSet: 'japanese',
    komi: 7.5,
    history: Object.freeze(history),
    redo: Object.freeze([]),
    endgameReview: null,
    endgameClassification: null,
    finalScore: null,
  });
};

const saveLegacySnapshot = (
  repo: Repo,
  fixture: LegacyFixture,
  snapshot: GameSessionSnapshot,
): void => {
  repo.saved = {
    id: CURRENT_GAME_ID,
    savedAt: '2026-09-08T00:00:00.000Z',
    state: {
      version: APPLICATION_SAVE_VERSION,
      gameMode: fixture.gameMode,
      sessionId: `legacy-${fixture.gameMode}`,
      snapshot,
    },
  };
};

const mockUnresolvedClassifier = () =>
  vi.spyOn(AssistedEndgameClassifier.prototype, 'analyze').mockImplementation(
    async ({ groups }) =>
      Object.freeze(
        groups.map((points) =>
          Object.freeze({
            points: Object.freeze([...points]),
            status: 'unresolved' as const,
          }),
        ),
      ),
  );

const restore = async (repo: Repo) =>
  new GameApplication(repo, () => '2026-09-08T00:00:01.000Z', () => 'unused')
    .restoreSavedGame();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GameApplication legacy endgame restore', () => {
  it.each(['torus-2d', 'cube-2d'] as const)(
    'creates and autosaves a missing review before exposing restored %s',
    async (gameMode) => {
      const repo = new Repo();
      const fixture = fixtureFor(gameMode);
      saveLegacySnapshot(repo, fixture, createLegacyEndgameSnapshot(fixture));
      const analyze = mockUnresolvedClassifier();

      const restored = await restore(repo);

      expect(restored?.gameMode).toBe(gameMode);
      expect(restored?.controller.viewModel().phase).toBe('endgame');
      expect(restored?.controller.snapshot().endgameReview).not.toBeNull();
      expect(restored?.controller.endgameGroups()).toHaveLength(1);
      expect(analyze).toHaveBeenCalledTimes(1);
      expect(repo.saves).toBe(1);
      expect(repo.saved?.state.snapshot.endgameReview).not.toBeNull();
      expect(repo.saved?.state.snapshot.sessionRevision).toBe(1);
    },
  );

  it('exposes every real logical stone group for manual classification after resume', async () => {
    const repo = new Repo();
    const fixture = fixtureFor('torus-2d');
    const occupied = ['0,0', '4,4', '0,2'] as const;
    saveLegacySnapshot(repo, fixture, createLegacyEndgameSnapshot(fixture, occupied));
    mockUnresolvedClassifier();

    const restored = await restore(repo);
    if (!restored || restored.gameMode !== 'torus-2d') throw new Error('Torus restore failed');

    const groups = restored.controller.endgameGroups();
    expect(groups).toHaveLength(3);
    expect(groups.flatMap((group) => group.points).sort()).toEqual([...occupied].sort());
    expect(restored.controller.endgameManualGroupIds()).toHaveLength(groups.length);
  });

  it('allows a resumed legacy review to be completed manually through FinalScore', async () => {
    const repo = new Repo();
    const fixture = fixtureFor('torus-2d');
    saveLegacySnapshot(repo, fixture, createLegacyEndgameSnapshot(fixture));
    mockUnresolvedClassifier();

    const restored = await restore(repo);
    if (!restored || restored.gameMode !== 'torus-2d') throw new Error('Torus restore failed');

    for (const group of restored.controller.endgameGroups()) {
      await restored.controller.setEndgameDecision(group.id, 'alive');
    }
    expect(restored.controller.canFinishEndgame()).toBe(true);

    const finished = await restored.controller.finishEndgame();
    expect(finished.accepted).toBe(true);
    expect(restored.controller.viewModel().phase).toBe('finished');
    expect(restored.controller.snapshot().finalScore).not.toBeNull();
    expect(restored.controller.resultModel()).not.toBeNull();
  });

  it('keeps restore successful and falls back to unresolved groups when classifier throws', async () => {
    const repo = new Repo();
    const fixture = fixtureFor('torus-2d');
    saveLegacySnapshot(repo, fixture, createLegacyEndgameSnapshot(fixture));
    const analyze = vi
      .spyOn(AssistedEndgameClassifier.prototype, 'analyze')
      .mockRejectedValue(new Error('classifier failed'));

    const restored = await restore(repo);
    if (!restored || restored.gameMode !== 'torus-2d') throw new Error('Torus restore failed');

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(restored.controller.viewModel().phase).toBe('endgame');
    expect(restored.controller.endgameGroups()).toHaveLength(1);
    expect(restored.controller.endgameManualGroupIds()).toHaveLength(1);
    expect(restored.controller.endgameDecisions()).toEqual({});
    expect(repo.saved?.state.snapshot.endgameReview).not.toBeNull();
  });

  it('uses the same unresolved fallback when the classifier proposal is invalid', async () => {
    const repo = new Repo();
    const fixture = fixtureFor('torus-2d');
    saveLegacySnapshot(repo, fixture, createLegacyEndgameSnapshot(fixture));
    vi.spyOn(AssistedEndgameClassifier.prototype, 'analyze').mockResolvedValue(
      Object.freeze([
        Object.freeze({ points: Object.freeze(['8,8']), status: 'alive' as const }),
      ]),
    );

    const restored = await restore(repo);
    if (!restored || restored.gameMode !== 'torus-2d') throw new Error('Torus restore failed');

    expect(restored.controller.endgameGroups()).toHaveLength(1);
    expect(restored.controller.endgameGroups()[0]!.points).toEqual(['0,0']);
    expect(restored.controller.endgameManualGroupIds()).toHaveLength(1);
    expect(restored.controller.endgameDecisions()).toEqual({});
  });

  it('does not re-run classifier or overwrite decisions when a review is already persisted', async () => {
    const repo = new Repo();
    const fixture = fixtureFor('torus-2d');
    const legacy = createLegacyEndgameSnapshot(fixture);
    const snapshot: GameSessionSnapshot = Object.freeze({
      ...legacy,
      endgameReview: Object.freeze({
        groups: Object.freeze([
          Object.freeze({
            points: Object.freeze(['0,0']),
            proposal: Object.freeze({ status: 'unresolved' as const }),
            userDecision: 'dead' as const,
            status: 'dead' as const,
          }),
        ]),
      }),
    });
    saveLegacySnapshot(repo, fixture, snapshot);
    const analyze = vi.spyOn(AssistedEndgameClassifier.prototype, 'analyze');

    const restored = await restore(repo);
    if (!restored || restored.gameMode !== 'torus-2d') throw new Error('Torus restore failed');

    expect(analyze).not.toHaveBeenCalled();
    const group = restored.controller.endgameGroups()[0]!;
    expect(restored.controller.endgameDecisions()[group.id]).toBe('dead');
    expect(restored.controller.snapshot().endgameReview?.groups[0]?.userDecision).toBe('dead');
    expect(repo.saves).toBe(0);
  });

  it('restores the autosaved resumed review on the next reload without another analysis', async () => {
    const repo = new Repo();
    const fixture = fixtureFor('torus-2d');
    saveLegacySnapshot(repo, fixture, createLegacyEndgameSnapshot(fixture));
    const analyze = mockUnresolvedClassifier();

    const first = await restore(repo);
    if (!first || first.gameMode !== 'torus-2d') throw new Error('First restore failed');
    const firstGroupIds = first.controller.endgameGroups().map((group) => group.id);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(repo.saves).toBe(1);

    analyze.mockClear();
    const second = await restore(repo);
    if (!second || second.gameMode !== 'torus-2d') throw new Error('Second restore failed');

    expect(analyze).not.toHaveBeenCalled();
    expect(second.controller.endgameGroups().map((group) => group.id)).toEqual(firstGroupIds);
    expect(second.controller.snapshot().endgameReview).not.toBeNull();
    expect(repo.saves).toBe(1);
  });

  it('does not run endgame resume for a playing snapshot', async () => {
    const repo = new Repo();
    const app = new GameApplication(repo, undefined, () => 'playing-session');
    await app.createNewGame({
      gameMode: 'torus-2d',
      size: 9,
      ruleSet: 'japanese',
      komi: 7.5,
    });
    const analyze = vi.spyOn(AssistedEndgameClassifier.prototype, 'analyze');

    const restored = await restore(repo);

    expect(restored?.controller.viewModel().phase).toBe('playing');
    expect(analyze).not.toHaveBeenCalled();
  });

  it('does not run endgame resume for a finished snapshot', async () => {
    const repo = new Repo();
    const app = new GameApplication(repo, undefined, () => 'finished-session');
    const active = await app.createNewGame({
      gameMode: 'cube-2d',
      size: 2,
      ruleSet: 'chinese',
      komi: 7.5,
    });
    if (active.gameMode !== 'cube-2d') throw new Error('Cube expected');
    await active.controller.pass();
    await active.controller.pass();
    await active.controller.finishEndgame();

    const analyze = vi.spyOn(AssistedEndgameClassifier.prototype, 'analyze');
    const restored = await restore(repo);

    expect(restored?.controller.viewModel().phase).toBe('finished');
    expect(analyze).not.toHaveBeenCalled();
  });
});
