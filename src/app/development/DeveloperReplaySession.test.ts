import { describe, expect, it, vi } from 'vitest';
import type { AlphaZeroGeneratedGame, AlphaZeroGeneratedMove, AlphaZeroTopology } from './AlphaZeroGateway';
import { DeveloperReplayCompatibilityError, DeveloperReplaySession } from './DeveloperReplaySession';

type GameOptions = Readonly<{
  topology?: AlphaZeroTopology;
  size?: number;
  ruleSet?: 'chinese' | 'japanese';
  komi?: number;
}>;

const game = (
  moves: readonly AlphaZeroGeneratedMove[],
  options: GameOptions = {},
): AlphaZeroGeneratedGame => {
  const topology = options.topology ?? 'cube';
  return Object.freeze({
    protocolVersion: 1,
    topology,
    size: options.size ?? (topology === 'cube' ? 3 : 9),
    ruleSet: options.ruleSet ?? 'chinese',
    komi: options.komi ?? 0.5,
    blackCheckpoint: 'checkpoint-a',
    whiteCheckpoint: 'checkpoint-a',
    mctsSimulations: 100,
    moves: Object.freeze([...moves]),
  });
};

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

const cubeCaptureGameMoves = (): readonly AlphaZeroGeneratedMove[] => [
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

const torusCaptureGameMoves = (): readonly AlphaZeroGeneratedMove[] => [
  place(1, 'black', '1,0'),
  place(2, 'white', '1,1'),
  place(3, 'black', '0,1'),
  place(4, 'white', '8,8'),
  place(5, 'black', '2,1'),
  place(6, 'white', '7,7'),
  place(7, 'black', '1,2', ['1,1']),
];

describe('DeveloperReplaySession', () => {
  it('applies Cube placements and Pass through the real GameSession', async () => {
    const replay = new DeveloperReplaySession(game([
      place(1, 'black', 'front:0:0'),
      pass(2, 'white'),
      place(3, 'black', 'front:0:1'),
    ]));

    expect(replay.binding.topology).toBe('cube');
    await replay.next();
    expect(replay.controller.viewModel().lastMovePointId).toBe('front:0:0');
    const afterPass = await replay.next();
    expect(afterPass.viewModel.consecutivePasses).toBe(1);
    await replay.next();
    expect(replay.position).toBe(3);
    expect(replay.controller.viewModel().consecutivePasses).toBe(0);
  });

  it('applies Torus placements and Pass through the same replay orchestration', async () => {
    const replay = new DeveloperReplaySession(game([
      place(1, 'black', '0,0'),
      place(2, 'white', '1,0'),
      pass(3, 'black'),
      place(4, 'white', '2,0'),
    ], { topology: 'torus', size: 9 }));

    expect(replay.binding.topology).toBe('torus');
    expect(replay.controller.topology.id).toBe('torus-9x9');
    await replay.next();
    expect(replay.controller.viewModel().lastMovePointId).toBe('0,0');
    await replay.jumpToEnd();
    expect(replay.position).toBe(4);
    expect(replay.controller.viewModel().lastMovePointId).toBe('2,0');
  });

  it.each([
    ['cube', game([pass(1, 'black'), pass(2, 'white')])],
    ['torus', game([pass(1, 'black'), pass(2, 'white')], { topology: 'torus', size: 9 })],
  ] as const)('reaches normal endgame after two generated Pass actions on %s', async (_label, generated) => {
    const replay = new DeveloperReplaySession(generated);
    await replay.jumpToEnd();
    expect(replay.controller.viewModel().phase).toBe('endgame');
  });

  it('independently scores a fully resolved Japanese endgame without mutating replay phase', async () => {
    const replay = new DeveloperReplaySession(
      game([pass(1, 'black'), pass(2, 'white')], { ruleSet: 'japanese' }),
    );
    const listener = vi.fn();
    replay.setFinalScoreListener(listener);

    await replay.jumpToEnd();

    const score = replay.diagnosticScore();
    expect(score).not.toBeNull();
    expect(score?.ruleSet).toBe('japanese');
    expect(score?.black).toBe(0);
    expect(score?.white).toBe(0.5);
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
      ], { ruleSet: 'japanese' }),
    );

    await replay.jumpToEnd();

    expect(replay.controller.viewModel().phase).toBe('endgame');
    if (replay.controller.nextUnresolvedEndgameGroupId() !== null) {
      expect(replay.diagnosticScore()).toBeNull();
    }
  });

  it('validates Cube captures against GoCube authoritative captures', async () => {
    const replay = new DeveloperReplaySession(game(cubeCaptureGameMoves()));
    const result = await replay.jumpToEnd();
    expect(new Set(result.captured)).toEqual(new Set(['front:1:2', 'right:1:0']));
  });

  it('validates Torus captures against GoCube authoritative captures', async () => {
    const replay = new DeveloperReplaySession(
      game(torusCaptureGameMoves(), { topology: 'torus', size: 9 }),
    );
    const result = await replay.jumpToEnd();
    expect(result.captured).toEqual(['1,1']);
  });

  it('stops on expected-color mismatch with the actual move number', async () => {
    const replay = new DeveloperReplaySession(game([pass(1, 'white')]));
    await expect(replay.next()).rejects.toMatchObject({ moveNumber: 1 });
    await expect(replay.next()).rejects.toBeInstanceOf(DeveloperReplayCompatibilityError);
    expect(replay.position).toBe(0);
  });

  it('stops on an illegal AlphaZero move', async () => {
    const replay = new DeveloperReplaySession(game([
      place(1, 'black', 'front:0:0'),
      place(2, 'white', 'front:0:0'),
    ]));
    await replay.next();
    await expect(replay.next()).rejects.toThrow(/move 2.*rejected/i);
    expect(replay.position).toBe(1);
  });

  it('stops on captured mismatch', async () => {
    const moves = [...cubeCaptureGameMoves()];
    moves[10] = place(11, 'black', 'right:1:1', []);
    const replay = new DeveloperReplaySession(game(moves));
    await expect(replay.jumpToEnd()).rejects.toThrow(/move 11.*captured mismatch/i);
    expect(replay.position).toBe(10);
  });

  it.each([
    ['cube', game([
      place(1, 'black', 'front:0:0'),
      place(2, 'white', 'front:0:1'),
      place(3, 'black', 'front:1:0'),
      place(4, 'white', 'front:1:1'),
    ])],
    ['torus', game([
      place(1, 'black', '0,0'),
      place(2, 'white', '1,0'),
      place(3, 'black', '0,1'),
      place(4, 'white', '1,1'),
    ], { topology: 'torus', size: 9 })],
  ] as const)('uses Undo/Redo and deterministic seeking on %s', async (_label, generated) => {
    const replay = new DeveloperReplaySession(generated);

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
});
