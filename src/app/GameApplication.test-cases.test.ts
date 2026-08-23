import { describe, expect, it } from 'vitest';
import { controlledExpectedGroups } from '../core/endgame/testlab/ControlledEndgameGenerator';
import { TestCaseReplayService } from '../core/endgame/testlab/TestCaseReplayService';
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
  if (!current) throw new Error('Session has no current state');
  return current;
};

const finishAssistedReview = async (active: ActiveGame): Promise<void> => {
  expect((await active.controller.pass()).accepted).toBe(true);
  expect((await active.controller.pass()).accepted).toBe(true);

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

const service = () => new TestCaseReplayService({ localAnalysisClient: null });

describe('GameApplication Test Case / Replay integration', () => {
  it('uses a Test ID to restore the exact game-like history through GameSession', async () => {
    const settings: NewGameSettings = {
      gameMode: 'torus-2d',
      size: 9,
      ruleSet: 'japanese',
      komi: 7.5,
    };
    const firstApp = new GameApplication(new MemoryRepo(), undefined, service());
    const first = await firstApp.createGeneratedTestCase(settings, 'game-like', 184237);
    const firstState = currentState(first.activeGame);
    expect(first.testCase.testId).toMatch(/^\d+$/);
    expect(first.testCase.loadStrategy).toBe('replay-commands');

    const secondApp = new GameApplication(new MemoryRepo(), undefined, service());
    const loaded = await secondApp.loadTestCaseById(first.testCase.testId, {
      ruleSet: 'japanese',
      komi: 7.5,
    });
    expect(currentState(loaded.activeGame)).toEqual(firstState);
    expect(loaded.testCase).toEqual(first.testCase);

    const beforeUndo = loaded.activeGame.controller.viewModel().moveNumber;
    expect((await loaded.activeGame.controller.undo()).accepted).toBe(true);
    expect(loaded.activeGame.controller.viewModel().moveNumber).toBe(beforeUndo - 1);
    expect((await loaded.activeGame.controller.redo()).accepted).toBe(true);
    expect(loaded.activeGame.controller.viewModel().moveNumber).toBe(beforeUndo);
  });

  it.each([
    { gameMode: 'torus-2d' as const, size: 9 as const, payload: 271828 },
    { gameMode: 'cube-2d' as const, size: 5 as const, payload: 161803 },
  ])('loads a controlled mixed endgame into a playable session and reaches scoring', async (shape) => {
    const settings: NewGameSettings = {
      gameMode: shape.gameMode,
      size: shape.size,
      ruleSet: 'japanese',
      komi: 7.5,
    };
    const app = new GameApplication(new MemoryRepo(), undefined, service());
    const generated = await app.createGeneratedTestCase(
      settings,
      'synthetic-endgame',
      shape.payload,
    );
    const expected = controlledExpectedGroups(generated.testCase);

    expect(generated.testCase.loadStrategy).toBe('snapshot');
    expect(generated.testCase.scenario).toBe('controlled-mixed-endgame');
    expect(generated.testCase.tags).toContain('full-position');
    expect(expected.some((group) => group.role === 'mandatory-dead' && group.expected === 'dead')).toBe(true);
    expect(expected.some((group) => group.role === 'control-alive' && group.expected === 'alive')).toBe(true);
    expect(expected.filter((group) => group.role === 'intentional-unresolved').length).toBeGreaterThanOrEqual(2);
    expect(generated.activeGame.controller.viewModel().phase).toBe('playing');
    await finishAssistedReview(generated.activeGame);
  }, 30_000);

  it('Test ID loader switches topology and board size encoded by the case', async () => {
    const generatorApp = new GameApplication(new MemoryRepo(), undefined, service());
    const generated = await generatorApp.createGeneratedTestCase(
      { gameMode: 'cube-2d', size: 6, ruleSet: 'chinese', komi: 6.5 },
      'synthetic-endgame',
      42,
    );

    const loaderApp = new GameApplication(new MemoryRepo(), undefined, service());
    const loaded = await loaderApp.loadTestCaseById(generated.testCase.testId, {
      ruleSet: 'japanese',
      komi: 7.5,
    });
    expect(loaded.activeGame.gameMode).toBe('cube-2d');
    expect(loaded.activeGame.controller.size).toBe(6);
    expect(currentState(loaded.activeGame).board).toEqual(currentState(generated.activeGame).board);
  });

  it('loads an eligible corpus Test ID as a real Torus session with diagnostics', async () => {
    const app = new GameApplication(new MemoryRepo(), undefined, service());
    const generated = await app.createCorpusTestCase(
      { gameMode: 'torus-2d', size: 9, ruleSet: 'japanese', komi: 7.5 },
      0,
      0,
    );
    expect(generated.testCase.diagnostics?.sourceId).toBe('xuanxuan-qijing:1');
    expect(generated.testCase.diagnostics?.sourceStatus).toBe('unknown');
    expect(generated.testCase.diagnostics?.kataGoStatus).toBe('unavailable');
    expect(generated.activeGame.controller.viewModel().phase).toBe('playing');

    const candidate = generated.activeGame.controller
      .viewModel()
      .points.find((point) =>
        point.occupancy === 'empty' && generated.activeGame.controller.moveAvailability(point.logicalPointId).allowed,
      );
    expect(candidate).toBeDefined();
    if (candidate) {
      expect((await generated.activeGame.controller.placeStone(candidate.logicalPointId)).accepted).toBe(true);
    }
  });
});