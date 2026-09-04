import { describe, expect, it, vi } from 'vitest';
import type { AlphaZeroGeneratedGame, AlphaZeroGeneratedMove } from './AlphaZeroGateway';
import { DeveloperReplayCompatibilityError, DeveloperReplaySession } from './DeveloperReplaySession';

const game = (
  moves: readonly AlphaZeroGeneratedMove[],
  size = 3,
  ruleSet: 'chinese' | 'japanese' = 'chinese',
): AlphaZeroGeneratedGame => Object.freeze({
  protocolVersion: 1,
  topology: 'cube',
  size,
  ruleSet,
  komi: 7.5,
  blackCheckpoint: 'checkpoint-a',
  whiteCheckpoint: 'checkpoint-a',
  mctsSimulations: 100,
  moves: Object.freeze([...moves]),
});

const place = (
  moveNumber: number,
  color: 'black' | 'white',
  pointId: string,
  captured?: readonly string[],
): AlphaZeroGeneratedMove => Object.freeze({
  moveNumber,
  color,
  action: Object.freeze({ type: 'place', pointId }),
  ...(captured === undefined ? {} : { captured: Object.freeze([...captured]) }),
});

const pass = (moveNumber: number, color: 'black' | 'white'): AlphaZeroGeneratedMove =>
  Object.freeze({ moveNumber, color, action: Object.freeze({ type: 'pass' }) });

const captureGameMoves = (): readonly AlphaZeroGeneratedMove[] => [
  place(1, 'black', 'front:1:1'),
  place(2, 'white', 'front:1:2'),
  place(3, 'black', 'front:0:2'),
  place(4, 'white', 'right:1:0'),
  place(5, 'black', 'front:2:2'),
  place(6, 'white', 'back:1:1'),
  place(7, 'black', 'right:0:0'),
  place(8, 'white', 'back:0:0'),
  place(9, 'black', 'right:2:0'),
  place(10, 'white', 'top:1:1'),
  place(11, 'black', 'right:1:1', ['front:1:2', 'right:1:0']),
];

describe('DeveloperReplaySession', () => {
  it('applies normal placements and Pass through the real GameSession', async () => {
    const replay = new DeveloperReplaySession(game([
      place(1, 'black', 'front:0:0'),
      pass(2, 'white'),
      place(3, 'black', 'front:0:1'),
    ]));

    await replay.next();
    expect(replay.controller.viewModel().lastMovePointId).toBe('front:0:0');
    const afterPass = await replay.next();
    expect(afterPass.viewModel.consecutivePasses).toBe(1);
    await replay.next();
    expect(replay.position).toBe(3);
    expect(replay.controller.viewModel().consecutivePasses).toBe(0);
  });

  it('reaches normal endgame after two generated Pass actions', async () => {
    const replay = new DeveloperReplaySession(game([pass(1, 'black'), pass(2, 'white')]));
    await replay.jumpToEnd();
    expect(replay.controller.viewModel().phase).toBe('endgame');
  });

  it('independently scores a fully resolved Japanese endgame without mutating replay phase', async () => {
    const replay = new DeveloperReplaySession(
      game([pass(1, 'black'), pass(2, 'white')], 3, 'japanese'),
    );
    const listener = vi.fn();
    replay.setFinalScoreListener(listener);

    await replay.jumpToEnd();

    const score = replay.diagnosticScore();
    expect(score).not.toBeNull();
    expect(score?.ruleSet).toBe('japanese');
    expect(score?.black).toBe(0);
    expect(score?.white).toBe(7.5);
    expect(score?.winner).toBe('white');
    expect(replay.controller.viewModel().phase).toBe('endgame');
    expect(listener).toHaveBeenLastCalledWith(score);
  });

  it('keeps the independent GoCube score unavailable while groups remain unresolved', async () => {
    const replay = new DeveloperReplaySession(
      game([
        place(1, 'black', 'front:1:1'),
        pass(2, 'white'),
        pass(3, 'black'),
      ], 3, 'japanese'),
    );

    await replay.jumpToEnd();

    expect(replay.controller.viewModel().phase).toBe('endgame');
    if (replay.controller.nextUnresolvedEndgameGroupId() !== null) {
      expect(replay.diagnosticScore()).toBeNull();
    }
  });

  it('validates captures against GoCube authoritative captures', async () => {
    const replay = new DeveloperReplaySession(game(captureGameMoves()));
    const result = await replay.jumpToEnd();
    expect(new Set(result.captured)).toEqual(new Set(['front:1:2', 'right:1:0']));
  });

  it('stops on expected-color mismatch', async () => {
    const replay = new DeveloperReplaySession(game([pass(1, 'white')]));
    await expect(replay.next()).rejects.toBeInstanceOf(DeveloperReplayCompatibilityError);
    expect(replay.position).toBe(0);
  });

  it('stops on an illegal AlphaZero move', async () => {
    const replay = new DeveloperReplaySession(game([
      place(1, 'black', 'front:0:0'),
      place(2, 'white', 'front:0:0'),
    ]));
    await replay.next();
    await expect(replay.next()).rejects.toThrow(/rejected/i);
    expect(replay.position).toBe(1);
  });

  it('stops on captured mismatch', async () => {
    const moves = [...captureGameMoves()];
    moves[10] = place(11, 'black', 'right:1:1', []);
    const replay = new DeveloperReplaySession(game(moves));
    await expect(replay.jumpToEnd()).rejects.toThrow(/captured mismatch/i);
    expect(replay.position).toBe(10);
  });

  it('uses Undo and Redo for Previous/Next and deterministic seeking', async () => {
    const replay = new DeveloperReplaySession(game([
      place(1, 'black', 'front:0:0'),
      place(2, 'white', 'front:0:1'),
      place(3, 'black', 'front:1:0'),
      place(4, 'white', 'front:1:1'),
    ]));

    await replay.jumpToEnd();
    const final = structuredClone(replay.controller.snapshot());
    await replay.previous();
    expect(replay.position).toBe(3);
    await replay.next();
    const afterRedo = replay.controller.snapshot();
    expect(afterRedo).toEqual({ ...final, sessionRevision: afterRedo.sessionRevision });
    await replay.seek(1);
    expect(replay.position).toBe(1);
    await replay.seek(3);
    expect(replay.position).toBe(3);
    await replay.jumpToStart();
    expect(replay.position).toBe(0);
    await replay.jumpToEnd();
    const afterSecondReplay = replay.controller.snapshot();
    expect(afterSecondReplay).toEqual({ ...final, sessionRevision: afterSecondReplay.sessionRevision });
  });

  it('rejects non-Cube metadata before creating an alternative board model', () => {
    expect(() => new DeveloperReplaySession({ ...game([]), topology: 'torus', size: 9 })).toThrow(/Cube 2D/i);
  });
});
