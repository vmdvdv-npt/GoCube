import { describe, expect, it, vi } from 'vitest';
import {
  BotGameActionBlockedError,
  BotGameOrchestrator,
  type BotGameOrchestratorOptions,
} from './BotGameOrchestrator';
import type { BotTurnGameController } from './BotTurnCoordinator';
import { TorusGameController } from './TorusGameController';
import type {
  AlphaZeroAction,
  AlphaZeroGateway,
  AlphaZeroSelectMoveRequest,
  AlphaZeroSelectedMove,
} from './development/AlphaZeroGateway';

type SelectMoveGateway = Pick<AlphaZeroGateway, 'selectMove'>;

type ControllerSource = BotGameOrchestratorOptions['controller'];

const responseFor = (
  request: AlphaZeroSelectMoveRequest,
  action: AlphaZeroAction,
  color: 'black' | 'white',
): AlphaZeroSelectedMove => Object.freeze({
  protocolVersion: 1,
  requestId: request.requestId,
  checkpointId: request.checkpointId,
  mctsSimulations: request.mctsSimulations,
  moveNumber: request.position.moves.length + 1,
  color,
  action,
  search: Object.freeze({
    simulations: request.mctsSimulations,
    implementationId: 'fake-test-search',
  }),
});

const makeOrchestrator = (
  controller: ControllerSource,
  gateway: SelectMoveGateway,
  humanColor: 'black' | 'white' = 'black',
) => {
  let nextRequestId = 1;
  return new BotGameOrchestrator({
    gateway,
    controller,
    humanColor,
    checkpointId: 'torus9-test-checkpoint',
    mctsSimulations: 128,
    topology: 'torus',
    size: 9,
    requestIdFactory: () => `bot-request-${nextRequestId++}`,
  });
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected asynchronous condition was not reached');
};

const place = (pointId: string): AlphaZeroAction => Object.freeze({ type: 'place', pointId });
const pass = (): AlphaZeroAction => Object.freeze({ type: 'pass' });

describe('BotGameOrchestrator', () => {
  it('plays two complete human Black -> bot cycles from authoritative history', async () => {
    const controller = new TorusGameController({ size: 9, ruleSet: 'chinese', komi: 0.5 });
    const botPoints = ['1,0', '3,0'];
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) => {
      const pointId = botPoints.shift();
      if (!pointId) throw new Error('Unexpected extra bot request');
      return responseFor(request, place(pointId), 'white');
    });
    const orchestrator = makeOrchestrator(controller, { selectMove }, 'black');

    expect(orchestrator.state()).toBe('human-turn');
    expect((await orchestrator.start())).toBeNull();

    expect((await orchestrator.humanPlaceStone('0,0')).accepted).toBe(true);
    expect(selectMove).toHaveBeenCalledTimes(1);
    expect(selectMove.mock.calls[0]![0].position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
    ]);
    let current = controller.snapshot().history.at(-1)!;
    expect(current.board['0,0']).toBe('black');
    expect(current.board['1,0']).toBe('white');
    expect(current.currentPlayer).toBe('black');
    expect(orchestrator.state()).toBe('human-turn');

    expect((await orchestrator.humanPlaceStone('2,0')).accepted).toBe(true);
    expect(selectMove).toHaveBeenCalledTimes(2);
    expect(selectMove.mock.calls[1]![0].position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
      { moveNumber: 2, color: 'white', action: { type: 'place', pointId: '1,0' } },
      { moveNumber: 3, color: 'black', action: { type: 'place', pointId: '2,0' } },
    ]);

    current = controller.snapshot().history.at(-1)!;
    expect(current.moveNumber).toBe(4);
    expect(current.board['0,0']).toBe('black');
    expect(current.board['1,0']).toBe('white');
    expect(current.board['2,0']).toBe('black');
    expect(current.board['3,0']).toBe('white');
    expect(current.currentPlayer).toBe('black');
    expect(orchestrator.state()).toBe('human-turn');
  });

  it('automatically makes the opening Black bot move when the human is White', async () => {
    const controller = new TorusGameController({ size: 9 });
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, place('0,0'), 'black'));
    const orchestrator = makeOrchestrator(controller, { selectMove }, 'white');

    expect(orchestrator.state()).toBe('bot-turn');
    await orchestrator.start();

    expect(selectMove).toHaveBeenCalledOnce();
    expect(selectMove.mock.calls[0]![0].position.moves).toEqual([]);
    const state = controller.snapshot().history.at(-1)!;
    expect(state.board['0,0']).toBe('black');
    expect(state.currentPlayer).toBe('white');
    expect(orchestrator.state()).toBe('human-turn');
  });

  it('applies a bot place through BotTurnCoordinator and the real GameSession', async () => {
    const controller = new TorusGameController({ size: 9 });
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, place('1,0'), 'white'));
    const orchestrator = makeOrchestrator(controller, { selectMove });

    await orchestrator.humanPlaceStone('0,0');

    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(2);
    expect(state.board['1,0']).toBe('white');
  });

  it('applies a bot Pass and returns the turn to the human', async () => {
    const controller = new TorusGameController({ size: 9 });
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, pass(), 'white'));
    const orchestrator = makeOrchestrator(controller, { selectMove });

    await orchestrator.humanPlaceStone('0,0');

    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(2);
    expect(state.consecutivePasses).toBe(1);
    expect(state.currentPlayer).toBe('black');
    expect(orchestrator.state()).toBe('human-turn');
  });

  it('sends an accepted human Pass to AlphaZero history before the bot response', async () => {
    const controller = new TorusGameController({ size: 9 });
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, place('1,0'), 'white'));
    const orchestrator = makeOrchestrator(controller, { selectMove });

    expect((await orchestrator.humanPass()).accepted).toBe(true);

    expect(selectMove.mock.calls[0]![0].position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'pass' } },
    ]);
    const state = controller.snapshot().history.at(-1)!;
    expect(state.board['1,0']).toBe('white');
    expect(state.consecutivePasses).toBe(0);
    expect(state.currentPlayer).toBe('black');
  });

  it('blocks human input while the bot request is in flight', async () => {
    const controller = new TorusGameController({ size: 9 });
    const pending = deferred<AlphaZeroSelectedMove>();
    let request!: AlphaZeroSelectMoveRequest;
    const selectMove = vi.fn((value: AlphaZeroSelectMoveRequest) => {
      request = value;
      return pending.promise;
    });
    const orchestrator = makeOrchestrator(controller, { selectMove });

    const firstTurn = orchestrator.humanPlaceStone('0,0');
    await flushUntil(() => selectMove.mock.calls.length === 1);
    expect(orchestrator.state()).toBe('bot-thinking');

    await expect(orchestrator.humanPlaceStone('2,0')).rejects.toMatchObject({
      name: 'BotGameActionBlockedError',
      reasonCode: 'bot-thinking',
    } satisfies Partial<BotGameActionBlockedError>);
    await expect(orchestrator.humanPass()).rejects.toMatchObject({
      reasonCode: 'bot-thinking',
    } satisfies Partial<BotGameActionBlockedError>);

    pending.resolve(responseFor(request, place('1,0'), 'white'));
    await firstTurn;
    expect(orchestrator.state()).toBe('human-turn');
  });

  it('does not start a second selectMove when bot startup is requested twice', async () => {
    const controller = new TorusGameController({ size: 9 });
    const pending = deferred<AlphaZeroSelectedMove>();
    let request!: AlphaZeroSelectMoveRequest;
    const selectMove = vi.fn((value: AlphaZeroSelectMoveRequest) => {
      request = value;
      return pending.promise;
    });
    const orchestrator = makeOrchestrator(controller, { selectMove }, 'white');

    const firstStart = orchestrator.start();
    await flushUntil(() => selectMove.mock.calls.length === 1);

    await expect(orchestrator.start()).rejects.toMatchObject({
      name: 'BotGameActionBlockedError',
      reasonCode: 'bot-thinking',
    } satisfies Partial<BotGameActionBlockedError>);
    expect(selectMove).toHaveBeenCalledOnce();

    pending.resolve(responseFor(request, place('0,0'), 'black'));
    await firstStart;
    expect(selectMove).toHaveBeenCalledOnce();
  });

  it('keeps the accepted human move when AlphaZero fails and allows retryBotTurn()', async () => {
    const controller = new TorusGameController({ size: 9 });
    const failure = new Error('AlphaZero unavailable');
    let attempt = 0;
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) => {
      attempt += 1;
      if (attempt === 1) throw failure;
      return responseFor(request, place('1,0'), 'white');
    });
    const orchestrator = makeOrchestrator(controller, { selectMove });

    const humanResult = await orchestrator.humanPlaceStone('0,0');

    expect(humanResult.accepted).toBe(true);
    expect(controller.snapshot().history).toHaveLength(2);
    expect(controller.snapshot().history.at(-1)!.board['0,0']).toBe('black');
    expect(controller.snapshot().history.at(-1)!.board['1,0']).toBe('empty');
    expect(orchestrator.state()).toBe('error');
    expect(orchestrator.lastError()).toBe(failure);

    await orchestrator.retryBotTurn();

    expect(selectMove).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().history.at(-1)!.board['1,0']).toBe('white');
    expect(orchestrator.lastError()).toBeNull();
    expect(orchestrator.state()).toBe('human-turn');
  });

  it('rebuilds retry from the current complete authoritative history', async () => {
    const controller = new TorusGameController({ size: 9 });
    const failure = new Error('temporary failure');
    let requestNumber = 0;
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) => {
      requestNumber += 1;
      if (requestNumber === 1) return responseFor(request, place('1,0'), 'white');
      if (requestNumber === 2) throw failure;
      return responseFor(request, place('3,0'), 'white');
    });
    const orchestrator = makeOrchestrator(controller, { selectMove });

    await orchestrator.humanPlaceStone('0,0');
    await orchestrator.humanPlaceStone('2,0');
    expect(orchestrator.state()).toBe('error');

    const expectedHistory = [
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
      { moveNumber: 2, color: 'white', action: { type: 'place', pointId: '1,0' } },
      { moveNumber: 3, color: 'black', action: { type: 'place', pointId: '2,0' } },
    ];
    expect(selectMove.mock.calls[1]![0].position.moves).toEqual(expectedHistory);

    await orchestrator.retryBotTurn();

    expect(selectMove.mock.calls[2]![0].position.moves).toEqual(expectedHistory);
    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(4);
    expect(state.board['3,0']).toBe('white');
    expect(state.currentPlayer).toBe('black');
  });

  it('ignores a stale response after the application replaces the controller and exits bot-thinking', async () => {
    const first = new TorusGameController({ size: 9 });
    const second = new TorusGameController({ size: 9 });
    let active: BotTurnGameController = first;
    const pending = deferred<AlphaZeroSelectedMove>();
    let request!: AlphaZeroSelectMoveRequest;
    const selectMove = vi.fn((value: AlphaZeroSelectMoveRequest) => {
      request = value;
      return pending.promise;
    });
    const orchestrator = makeOrchestrator(() => active, { selectMove });

    const firstTurn = orchestrator.humanPlaceStone('0,0');
    await flushUntil(() => selectMove.mock.calls.length === 1);
    expect(orchestrator.state()).toBe('bot-thinking');

    active = second;
    expect(orchestrator.state()).toBe('human-turn');
    pending.resolve(responseFor(request, place('1,0'), 'white'));
    await firstTurn;

    expect(first.snapshot().history).toHaveLength(2);
    expect(first.snapshot().history.at(-1)!.board['0,0']).toBe('black');
    expect(first.snapshot().history.at(-1)!.board['1,0']).toBe('empty');
    expect(second.snapshot().history).toHaveLength(1);
    expect(orchestrator.state()).toBe('human-turn');
    expect(orchestrator.lastError()).toBeNull();
  });

  it('uses the normal endgame flow when human Pass is followed by bot Pass', async () => {
    const controller = new TorusGameController({ size: 9 });
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, pass(), 'white'));
    const orchestrator = makeOrchestrator(controller, { selectMove });

    expect((await orchestrator.humanPass()).accepted).toBe(true);

    expect(selectMove).toHaveBeenCalledOnce();
    expect(controller.snapshot().history.at(-1)!.phase).toBe('endgame');
    expect(orchestrator.state()).toBe('endgame');
    await expect(orchestrator.humanPass()).rejects.toMatchObject({
      reasonCode: 'not-playing',
    } satisfies Partial<BotGameActionBlockedError>);
    expect(await orchestrator.start()).toBeNull();
    expect(selectMove).toHaveBeenCalledOnce();
  });

  it('blocks human input whenever the authoritative currentPlayer belongs to the bot', async () => {
    const controller = new TorusGameController({ size: 9 });
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, place('0,0'), 'black'));
    const orchestrator = makeOrchestrator(controller, { selectMove }, 'white');

    await expect(orchestrator.humanPlaceStone('1,0')).rejects.toMatchObject({
      reasonCode: 'not-human-turn',
    } satisfies Partial<BotGameActionBlockedError>);
    expect(selectMove).not.toHaveBeenCalled();
  });

  it('does not affect ordinary local human-vs-human play when no orchestrator is used', async () => {
    const controller = new TorusGameController({ size: 9 });

    expect((await controller.placeStone('0,0')).accepted).toBe(true);
    expect((await controller.placeStone('1,0')).accepted).toBe(true);

    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(2);
    expect(state.board['0,0']).toBe('black');
    expect(state.board['1,0']).toBe('white');
    expect(state.currentPlayer).toBe('black');
  });
});
