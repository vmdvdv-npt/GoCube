import { describe, expect, it } from 'vitest';
import { generateLiveTestCase } from '../core/endgame/testlab/LiveTestGenerators';
import type { GameRepository, SavedGame } from '../core/persistence/GameRepository';
import {
  GameApplication,
  type ActiveGame,
  type ApplicationSavedState,
  type NewGameSettings,
} from './GameApplication';

class MemoryRepo implements GameRepository<ApplicationSavedState> {
  saved: SavedGame<ApplicationSavedState> | null = null;

  async save(game: SavedGame<ApplicationSavedState>) {
    this.saved = structuredClone(game);
  }

  async load(id: string) {
    return this.saved?.id === id ? structuredClone(this.saved) : null;
  }

  async remove(id: string) {
    if (this.saved?.id === id) this.saved = null;
  }
}

const currentState = (active: ActiveGame) => {
  const current = active.controller.snapshot().history.at(-1);
  if (!current) throw new Error('Generated session has no current state');
  return current;
};

const continueWithOneLegalMove = async (active: ActiveGame): Promise<void> => {
  const candidate = active.controller
    .viewModel()
    .points.find((point) =>
      point.occupancy === 'empty' && active.controller.moveAvailability(point.logicalPointId).allowed,
    );
  if (!candidate) throw new Error('Generated position has no legal continuation');
  const result = await active.controller.placeStone(candidate.logicalPointId);
  expect(result.accepted).toBe(true);
};

const finishAssistedReview = async (active: ActiveGame): Promise<void> => {
  if (active.controller.viewModel().phase === 'playing') {
    expect((await active.controller.pass()).accepted).toBe(true);
    expect((await active.controller.pass()).accepted).toBe(true);
  }

  let guard = 0;
  while (active.controller.viewModel().phase === 'endgame') {
    guard += 1;
    if (guard > 512) throw new Error('Assisted review did not converge');
    const groupId = active.controller.nextUnresolvedEndgameGroupId();
    if (groupId === null) {
      await active.controller.finishEndgame();
      break;
    }
    await active.controller.setEndgameDecision(groupId, 'alive');
  }

  expect(active.controller.viewModel().phase).toBe('finished');
  expect(active.controller.resultModel()).not.toBeNull();
};

describe('GameApplication live test generation', () => {
  it.each([
    {
      settings: {
        gameMode: 'torus-2d' as const,
        size: 9 as const,
        ruleSet: 'japanese' as const,
        komi: 7.5,
      },
      topology: 'torus' as const,
    },
    {
      settings: {
        gameMode: 'cube-2d' as const,
        size: 5 as const,
        ruleSet: 'chinese' as const,
        komi: 6.5,
      },
      topology: 'cube' as const,
    },
  ])('loads Game-like output through the real session and keeps it playable', async ({ settings, topology }) => {
    const repo = new MemoryRepo();
    const app = new GameApplication(repo, () => '2026-08-23T04:30:00.000Z');
    const seed = '184237';
    const expected = generateLiveTestCase({
      generator: 'game-like',
      topology,
      size: settings.size,
      seed,
    });

    const generated = await app.createGeneratedGame(settings, 'game-like', seed);
    expect(generated.generation).toEqual(expected);
    expect(currentState(generated.activeGame)).toEqual(expected.state);
    expect(repo.saved?.state.snapshot.history.at(-1)).toEqual(expected.state);

    const beforeUndo = generated.activeGame.controller.viewModel();
    expect((await generated.activeGame.controller.undo()).accepted).toBe(true);
    expect(generated.activeGame.controller.viewModel().moveNumber).toBe(beforeUndo.moveNumber - 1);
    expect((await generated.activeGame.controller.redo()).accepted).toBe(true);
    expect(generated.activeGame.controller.viewModel()).toEqual(beforeUndo);

    await continueWithOneLegalMove(generated.activeGame);
    expect(generated.activeGame.controller.viewModel().phase).toBe('playing');
  });

  it.each([
    {
      gameMode: 'torus-2d' as const,
      size: 9 as const,
      ruleSet: 'japanese' as const,
      komi: 7.5,
    },
    {
      gameMode: 'cube-2d' as const,
      size: 5 as const,
      ruleSet: 'japanese' as const,
      komi: 7.5,
    },
  ] satisfies readonly NewGameSettings[])('takes generated endgame through Pass → Pass → assisted review → scoring', async (settings) => {
    const app = new GameApplication(new MemoryRepo());
    const generated = await app.createGeneratedGame(
      settings,
      'endgame',
      'endgame-review-184237',
    );

    expect(generated.activeGame.controller.viewModel().phase).toBe('playing');
    await finishAssistedReview(generated.activeGame);
  });

  it('replays the same generator/topology/size/seed into the identical board', async () => {
    const settings: NewGameSettings = {
      gameMode: 'torus-2d',
      size: 9,
      ruleSet: 'chinese',
      komi: 7.5,
    };
    const app = new GameApplication(new MemoryRepo());
    const first = await app.createGeneratedGame(settings, 'game-like', 'replay-me');
    const second = await app.createGeneratedGame(settings, 'game-like', 'replay-me');

    expect(currentState(second.activeGame)).toEqual(currentState(first.activeGame));
    expect(second.generation.spec).toEqual(first.generation.spec);
  });
});
