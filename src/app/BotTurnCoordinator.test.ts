import { describe, expect, it, vi } from 'vitest';
import { TorusGameController } from './TorusGameController';
import {
  BotTurnCompatibilityError,
  BotTurnCoordinator,
  BotTurnUnavailableError,
  type BotTurnGameController,
} from './BotTurnCoordinator';
import type {
  AlphaZeroAction,
  AlphaZeroGateway,
  AlphaZeroSelectMoveRequest,
  AlphaZeroSelectedMove,
} from './development/AlphaZeroGateway';

type SelectMoveGateway = Pick<AlphaZeroGateway, 'selectMove'>;

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

const makeCoordinator = (
  controller: () => BotTurnGameController,
  gateway: SelectMoveGateway,
  requestId = 'bot-request-1',
) => new BotTurnCoordinator({
  gateway,
  controller,
  checkpointId: 'torus9-test-checkpoint',
  mctsSimulations: 128,
  topology: 'torus',
  size: 9,
  requestIdFactory: () => requestId,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('BotTurnCoordinator', () => {
  it('sends the complete current authoritative history and applies a legal place through GameSession', async () => {
    const controller = new TorusGameController({ size: 9, ruleSet: 'chinese', komi: 0.5 });
    expect((await controller.placeStone('0,0')).accepted).toBe(true);

    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, Object.freeze({ type: 'place', pointId: '1,0' }), 'white'));
    const coordinator = makeCoordinator(() => controller, { selectMove });

    const result = await coordinator.playBotTurn();

    expect(result).toEqual({
      status: 'applied',
      requestId: 'bot-request-1',
      action: { type: 'place', pointId: '1,0' },
    });
    expect(selectMove).toHaveBeenCalledOnce();
    expect(selectMove.mock.calls[0]![0]).toMatchObject({
      requestId: 'bot-request-1',
      checkpointId: 'torus9-test-checkpoint',
      mctsSimulations: 128,
      position: {
        topology: 'torus',
        size: 9,
        ruleSet: 'chinese',
        komi: 0.5,
        moves: [
          { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
        ],
      },
    });

    const snapshot = controller.snapshot();
    expect(snapshot.history).toHaveLength(3);
    expect(snapshot.history.at(-1)!.board['0,0']).toBe('black');
    expect(snapshot.history.at(-1)!.board['1,0']).toBe('white');
    expect(snapshot.history.at(-1)!.moveNumber).toBe(2);
  });

  it('applies a bot Pass through the real GameSession', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('0,0');
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, Object.freeze({ type: 'pass' }), 'white'));

    await makeCoordinator(() => controller, { selectMove }).playBotTurn();

    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(2);
    expect(state.currentPlayer).toBe('black');
    expect(state.consecutivePasses).toBe(1);
  });

  it('fails closed when GameSession rejects a protocol-valid proposed move', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('0,0');
    const before = controller.snapshot();
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, Object.freeze({ type: 'place', pointId: '0,0' }), 'white'));

    await expect(makeCoordinator(() => controller, { selectMove }).playBotTurn()).rejects.toMatchObject({
      name: 'BotTurnCompatibilityError',
      reasonCode: 'action-rejected',
    } satisfies Partial<BotTurnCompatibilityError>);
    expect(controller.snapshot().sessionRevision).toBe(before.sessionRevision);
    expect(controller.snapshot().history).toHaveLength(before.history.length);
  });

  it('rejects a wrong response color before applying any action', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('0,0');
    const before = controller.snapshot();
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, Object.freeze({ type: 'place', pointId: '1,0' }), 'black'));

    await expect(makeCoordinator(() => controller, { selectMove }).playBotTurn()).rejects.toMatchObject({
      name: 'BotTurnCompatibilityError',
      reasonCode: 'wrong-color',
    } satisfies Partial<BotTurnCompatibilityError>);
    expect(controller.snapshot().sessionRevision).toBe(before.sessionRevision);
    expect(controller.snapshot().history).toHaveLength(before.history.length);
  });

  it('ignores a stale response after Undo during the request', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('0,0');
    const pending = deferred<AlphaZeroSelectedMove>();
    let request!: AlphaZeroSelectMoveRequest;
    const selectMove = vi.fn((value: AlphaZeroSelectMoveRequest) => {
      request = value;
      return pending.promise;
    });
    const botTurn = makeCoordinator(() => controller, { selectMove }).playBotTurn();

    await Promise.resolve();
    expect((await controller.undo()).accepted).toBe(true);
    pending.resolve(responseFor(request, Object.freeze({ type: 'place', pointId: '1,0' }), 'white'));

    await expect(botTurn).resolves.toEqual({ status: 'stale', requestId: 'bot-request-1' });
    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(0);
    expect(state.board['1,0']).toBe('empty');
  });

  it('ignores a stale response after another mutation during the request', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('0,0');
    const pending = deferred<AlphaZeroSelectedMove>();
    let request!: AlphaZeroSelectMoveRequest;
    const selectMove = vi.fn((value: AlphaZeroSelectMoveRequest) => {
      request = value;
      return pending.promise;
    });
    const botTurn = makeCoordinator(() => controller, { selectMove }).playBotTurn();

    await Promise.resolve();
    expect((await controller.placeStone('2,0')).accepted).toBe(true);
    pending.resolve(responseFor(request, Object.freeze({ type: 'place', pointId: '1,0' }), 'white'));

    await expect(botTurn).resolves.toEqual({ status: 'stale', requestId: 'bot-request-1' });
    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(2);
    expect(state.board['2,0']).toBe('white');
    expect(state.board['1,0']).toBe('empty');
  });

  it('ignores a response when the application replaces the current controller', async () => {
    const first = new TorusGameController({ size: 9 });
    await first.placeStone('0,0');
    const second = new TorusGameController({ size: 9 });
    let active: BotTurnGameController = first;
    const pending = deferred<AlphaZeroSelectedMove>();
    let request!: AlphaZeroSelectMoveRequest;
    const selectMove = vi.fn((value: AlphaZeroSelectMoveRequest) => {
      request = value;
      return pending.promise;
    });
    const botTurn = makeCoordinator(() => active, { selectMove }).playBotTurn();

    await Promise.resolve();
    active = second;
    pending.resolve(responseFor(request, Object.freeze({ type: 'place', pointId: '1,0' }), 'white'));

    await expect(botTurn).resolves.toEqual({ status: 'stale', requestId: 'bot-request-1' });
    expect(first.snapshot().history).toHaveLength(2);
    expect(second.snapshot().history).toHaveLength(1);
  });

  it('uses the normal endgame flow when the bot supplies the second consecutive Pass', async () => {
    const controller = new TorusGameController({ size: 9 });
    expect((await controller.pass()).accepted).toBe(true);
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, Object.freeze({ type: 'pass' }), 'white'));
    const coordinator = makeCoordinator(() => controller, { selectMove });

    await coordinator.playBotTurn();

    expect(controller.snapshot().history.at(-1)!.phase).toBe('endgame');
    await expect(coordinator.playBotTurn()).rejects.toBeInstanceOf(BotTurnUnavailableError);
    expect(selectMove).toHaveBeenCalledOnce();
  });

  it('leaves GameSession unchanged when AlphaZero fails', async () => {
    const controller = new TorusGameController({ size: 9 });
    await controller.placeStone('0,0');
    const before = controller.snapshot();
    const failure = new Error('AlphaZero unavailable');
    const gateway: SelectMoveGateway = {
      selectMove: vi.fn(async () => {
        throw failure;
      }),
    };

    await expect(makeCoordinator(() => controller, gateway).playBotTurn()).rejects.toBe(failure);
    const after = controller.snapshot();
    expect(after.sessionRevision).toBe(before.sessionRevision);
    expect(after.history).toHaveLength(before.history.length);
    expect(after.history.at(-1)!.board).toEqual(before.history.at(-1)!.board);
  });

  it('does not affect ordinary local play when no BotTurnCoordinator is used', async () => {
    const controller = new TorusGameController({ size: 9 });

    expect((await controller.placeStone('0,0')).accepted).toBe(true);
    expect((await controller.placeStone('1,0')).accepted).toBe(true);

    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(2);
    expect(state.board['0,0']).toBe('black');
    expect(state.board['1,0']).toBe('white');
  });
});
