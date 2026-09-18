import { describe, expect, it, vi } from 'vitest';
import { BotGameOrchestrator } from './BotGameOrchestrator';
import { TorusGameController } from './TorusGameController';
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
    implementationId: 'fake-undo-redo-search',
  }),
});

const place = (pointId: string): AlphaZeroAction => Object.freeze({ type: 'place', pointId });
const pass = (): AlphaZeroAction => Object.freeze({ type: 'pass' });

const makeOrchestrator = (
  controller: TorusGameController,
  gateway: SelectMoveGateway,
  humanColor: 'black' | 'white' = 'black',
) => {
  let requestNumber = 0;
  return new BotGameOrchestrator({
    gateway,
    controller,
    humanColor,
    checkpointId: 'torus9-undo-redo-test',
    mctsSimulations: 128,
    topology: 'torus',
    size: 9,
    requestIdFactory: () => `undo-redo-${++requestNumber}`,
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected asynchronous condition was not reached');
};

describe('BotGameOrchestrator Undo / Redo', () => {
  it('Human Black undoes and redoes the complete human + bot pair without another request', async () => {
    const controller = new TorusGameController({ size: 9 });
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, place('1,0'), 'white'));
    const orchestrator = makeOrchestrator(controller, { selectMove });

    await orchestrator.humanPlaceStone('0,0');
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(2);
    expect(orchestrator.canUndo()).toBe(true);

    const undo = await orchestrator.undoHumanTurn();
    expect(undo.accepted).toBe(true);
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(0);
    expect(controller.snapshot().history.at(-1)!.board['0,0']).toBe('empty');
    expect(controller.snapshot().history.at(-1)!.board['1,0']).toBe('empty');
    expect(orchestrator.canRedo()).toBe(true);

    const redo = await orchestrator.redoHumanTurn();
    expect(redo.accepted).toBe(true);
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(2);
    expect(controller.snapshot().history.at(-1)!.board['0,0']).toBe('black');
    expect(controller.snapshot().history.at(-1)!.board['1,0']).toBe('white');
    expect(selectMove).toHaveBeenCalledOnce();
    expect(orchestrator.state()).toBe('human-turn');
  });

  it('Human White cannot undo the opening bot move and later Undo leaves that opening in place', async () => {
    const controller = new TorusGameController({ size: 9 });
    let attempt = 0;
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) => {
      attempt += 1;
      return attempt === 1
        ? responseFor(request, place('0,0'), 'black')
        : responseFor(request, place('2,0'), 'black');
    });
    const orchestrator = makeOrchestrator(controller, { selectMove }, 'white');

    await orchestrator.start();
    expect(orchestrator.canUndo()).toBe(false);
    expect(controller.snapshot().history.at(-1)!.board['0,0']).toBe('black');

    await orchestrator.humanPlaceStone('1,0');
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(3);
    expect(orchestrator.canUndo()).toBe(true);

    await orchestrator.undoHumanTurn();
    const state = controller.snapshot().history.at(-1)!;
    expect(state.moveNumber).toBe(1);
    expect(state.board['0,0']).toBe('black');
    expect(state.board['1,0']).toBe('empty');
    expect(state.board['2,0']).toBe('empty');
    expect(state.currentPlayer).toBe('white');
    expect(orchestrator.canUndo()).toBe(false);
    expect(orchestrator.canRedo()).toBe(true);
  });

  it('Undo during bot-thinking removes the human move and fences the late response', async () => {
    const controller = new TorusGameController({ size: 9 });
    const pending = deferred<AlphaZeroSelectedMove>();
    let request!: AlphaZeroSelectMoveRequest;
    const selectMove = vi.fn((value: AlphaZeroSelectMoveRequest) => {
      request = value;
      return pending.promise;
    });
    const orchestrator = makeOrchestrator(controller, { selectMove });

    const turn = orchestrator.humanPlaceStone('0,0');
    await flushUntil(() => selectMove.mock.calls.length === 1);
    expect(orchestrator.state()).toBe('bot-thinking');
    expect(orchestrator.canUndo()).toBe(true);

    await orchestrator.undoHumanTurn();
    expect(orchestrator.state()).toBe('human-turn');
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(0);

    pending.resolve(responseFor(request, place('1,0'), 'white'));
    await turn;

    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(0);
    expect(controller.snapshot().history.at(-1)!.board['1,0']).toBe('empty');
    expect(orchestrator.state()).toBe('human-turn');
    expect(orchestrator.lastError()).toBeNull();
  });

  it('Undo after Bot move failed removes the human move and clears Retry state', async () => {
    const controller = new TorusGameController({ size: 9 });
    const failure = new Error('forced bot failure');
    const selectMove = vi.fn(async () => {
      throw failure;
    });
    const orchestrator = makeOrchestrator(controller, { selectMove });

    await orchestrator.humanPlaceStone('0,0');
    expect(orchestrator.state()).toBe('error');
    expect(orchestrator.lastError()).toBe(failure);
    expect(orchestrator.canUndo()).toBe(true);

    await orchestrator.undoHumanTurn();

    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(0);
    expect(controller.snapshot().history.at(-1)!.currentPlayer).toBe('black');
    expect(orchestrator.state()).toBe('human-turn');
    expect(orchestrator.lastError()).toBeNull();
  });

  it('Redo of only the interrupted human move launches a fresh bot request', async () => {
    const controller = new TorusGameController({ size: 9 });
    const first = deferred<AlphaZeroSelectedMove>();
    const second = deferred<AlphaZeroSelectedMove>();
    const requests: AlphaZeroSelectMoveRequest[] = [];
    const selectMove = vi.fn((request: AlphaZeroSelectMoveRequest) => {
      requests.push(request);
      return requests.length === 1 ? first.promise : second.promise;
    });
    const orchestrator = makeOrchestrator(controller, { selectMove });

    const originalTurn = orchestrator.humanPlaceStone('0,0');
    await flushUntil(() => requests.length === 1);
    await orchestrator.undoHumanTurn();

    const redo = await orchestrator.redoHumanTurn();
    expect(redo.accepted).toBe(true);
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(1);
    await flushUntil(() => requests.length === 2);
    expect(orchestrator.state()).toBe('bot-thinking');
    expect(requests[1]!.position.moves).toEqual([
      { moveNumber: 1, color: 'black', action: { type: 'place', pointId: '0,0' } },
    ]);

    first.resolve(responseFor(requests[0]!, place('8,8'), 'white'));
    await originalTurn;
    expect(controller.snapshot().history.at(-1)!.board['8,8']).toBe('empty');
    expect(orchestrator.state()).toBe('bot-thinking');

    second.resolve(responseFor(requests[1]!, place('1,0'), 'white'));
    await flushUntil(() => orchestrator.state() === 'human-turn');
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(2);
    expect(controller.snapshot().history.at(-1)!.board['1,0']).toBe('white');
    expect(selectMove).toHaveBeenCalledTimes(2);
  });

  it('Pass into endgame can Undo and Redo the existing pair without another request', async () => {
    const controller = new TorusGameController({ size: 9 });
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) =>
      responseFor(request, pass(), 'white'));
    const orchestrator = makeOrchestrator(controller, { selectMove });

    await orchestrator.humanPass();
    expect(controller.snapshot().history.at(-1)!.phase).toBe('endgame');
    expect(orchestrator.canUndo()).toBe(true);

    await orchestrator.undoHumanTurn();
    expect(controller.snapshot().history.at(-1)!.phase).toBe('playing');
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(0);

    await orchestrator.redoHumanTurn();
    expect(controller.snapshot().history.at(-1)!.phase).toBe('endgame');
    expect(selectMove).toHaveBeenCalledOnce();
  });

  it('a new human move after Undo clears redo-future', async () => {
    const controller = new TorusGameController({ size: 9 });
    const botPoints = ['1,0', '3,0'];
    const selectMove = vi.fn(async (request: AlphaZeroSelectMoveRequest) => {
      const pointId = botPoints.shift();
      if (!pointId) throw new Error('Unexpected bot request');
      return responseFor(request, place(pointId), 'white');
    });
    const orchestrator = makeOrchestrator(controller, { selectMove });

    await orchestrator.humanPlaceStone('0,0');
    await orchestrator.undoHumanTurn();
    expect(orchestrator.canRedo()).toBe(true);

    await orchestrator.humanPlaceStone('2,0');

    expect(orchestrator.canRedo()).toBe(false);
    expect(controller.snapshot().redo).toHaveLength(0);
    expect(controller.snapshot().history.at(-1)!.board['0,0']).toBe('empty');
    expect(controller.snapshot().history.at(-1)!.board['2,0']).toBe('black');
    expect(controller.snapshot().history.at(-1)!.board['3,0']).toBe('white');
  });

  it('ordinary Human-vs-Human controller Undo / Redo semantics stay unchanged', async () => {
    const controller = new TorusGameController({ size: 9 });

    await controller.placeStone('0,0');
    await controller.placeStone('1,0');
    expect(controller.canUndo()).toBe(true);

    await controller.undo();
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(1);
    expect(controller.snapshot().history.at(-1)!.board['1,0']).toBe('empty');
    expect(controller.canRedo()).toBe(true);

    await controller.redo();
    expect(controller.snapshot().history.at(-1)!.moveNumber).toBe(2);
    expect(controller.snapshot().history.at(-1)!.board['1,0']).toBe('white');
  });
});
