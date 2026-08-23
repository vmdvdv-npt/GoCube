import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../game/GameEngine';
import { LinearHistory } from '../../history/LinearHistory';
import { controlledExpectedGroups } from './ControlledEndgameGenerator';
import { LocalAnalysisClient } from './LocalAnalysisClient';
import {
  CONTROLLED_ENDGAME_TEST_CASE_VARIANT,
  createTestCaseTopology,
  LIVE_ENDGAME_TEST_CASE_VARIANT,
  TestCaseReplayService,
} from './TestCaseReplayService';
import {
  decodeTestCaseId,
  encodeTestCaseId,
  makeTestCaseIdentity,
} from './TestCase';

const boardSignature = (board: Readonly<Record<string, string>>): string =>
  Object.entries(board)
    .filter(([, occupancy]) => occupancy !== 'empty')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([point, occupancy]) => `${point}=${occupancy}`)
    .join(';');

const occupiedCount = (board: Readonly<Record<string, string>>): number =>
  Object.values(board).filter((occupancy) => occupancy !== 'empty').length;

const replayCommands = async (
  service: TestCaseReplayService,
  testId: string,
) => {
  const generated = await service.createFromId(testId, false);
  const topology = createTestCaseTopology(generated.identity);
  const engine = new GameEngine(topology);
  const history = new LinearHistory(engine.createInitialState());
  for (const command of generated.commands) {
    if (command.type === 'pass') {
      const result = engine.pass(history.current());
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Generated pass rejected');
      history.push(result.state);
      continue;
    }
    const state = history.current();
    const result = engine.placeStone(
      state,
      command.point,
      state.currentPlayer,
      history.simpleKoContext(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Generated move rejected: ${result.reason}`);
    history.push(result.state);
  }
  return { generated, replayed: history.current() };
};

const finishTwoPasses = async (testId: string) => {
  const service = new TestCaseReplayService();
  const generated = await service.createFromId(testId, false);
  const engine = new GameEngine(createTestCaseTopology(generated.identity));
  const first = engine.pass(generated.state);
  if (!first.ok) throw new Error('First pass rejected');
  const second = engine.pass(first.state);
  if (!second.ok) throw new Error('Second pass rejected');
  return second.state;
};

const fakeKataGoClient = (statuses: readonly ('alive' | 'dead')[]): LocalAnalysisClient => {
  let analysisIndex = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return new Response(
        JSON.stringify({ protocolVersion: 1, available: true, version: 'test' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (!url.endsWith('/analyze')) return new Response('not found', { status: 404 });

    const request = JSON.parse(String(init?.body)) as {
      readonly position: {
        readonly boardSize: number;
        readonly targetCoordinates: readonly Readonly<{ row: number; column: number }>[];
        readonly stones: readonly Readonly<{ row: number; column: number; color: string }>[];
      };
    };
    const position = request.position;
    const target = position.targetCoordinates[0]!;
    const targetColor = position.stones.find(
      (stone) => stone.row === target.row && stone.column === target.column,
    )?.color;
    const requestedStatus = statuses[Math.min(analysisIndex, statuses.length - 1)] ?? 'alive';
    analysisIndex += 1;
    const ownership = Array.from({ length: position.boardSize * position.boardSize }, () => 0);
    const targetOwnership = requestedStatus === 'alive'
      ? targetColor === 'black' ? 0.95 : -0.95
      : targetColor === 'black' ? -0.95 : 0.95;
    ownership[target.row * position.boardSize + target.column] = targetOwnership;
    return new Response(
      JSON.stringify({ protocolVersion: 1, result: { id: `test-${analysisIndex}`, ownership } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  return new LocalAnalysisClient({ fetchImpl, timeoutMs: 100 });
};

describe('Test ID contract', () => {
  it('encodes every replay-relevant field into a reversible decimal identifier', () => {
    const identity = makeTestCaseIdentity({
      source: 'synthetic-endgame',
      topology: 'cube',
      size: 7,
      variant: 13,
      transform: 41,
      payload: 3_817_429_051,
    });
    const testId = encodeTestCaseId(identity);
    expect(testId).toMatch(/^\d+$/);
    expect(decodeTestCaseId(testId)).toEqual(identity);
  });

  it('changes when any encoded replay dimension changes', () => {
    const base = makeTestCaseIdentity({
      source: 'game-like', topology: 'torus', size: 9, variant: 0, transform: 0, payload: 184237,
    });
    const baseId = encodeTestCaseId(base);
    for (const changed of [
      { ...base, source: 'synthetic-endgame' as const },
      { ...base, topology: 'cube' as const },
      { ...base, size: 13 },
      { ...base, variant: 1 },
      { ...base, transform: 1 },
      { ...base, payload: 184238 },
    ]) {
      expect(encodeTestCaseId(changed)).not.toBe(baseId);
    }
  });
});

describe('TestCaseReplayService', () => {
  it.each([
    { topology: 'torus' as const, size: 9, payload: 184237 },
    { topology: 'cube' as const, size: 5, payload: 314159 },
  ])('replays game-like Test IDs through legal GameEngine commands', async (shape) => {
    const service = new TestCaseReplayService();
    const identity = service.identityForGenerated('game-like', shape.topology, shape.size, shape.payload);
    const testId = encodeTestCaseId(identity);
    const first = await replayCommands(service, testId);
    const second = await service.createFromId(testId, false);

    expect(first.generated.loadStrategy).toBe('replay-commands');
    expect(first.replayed).toEqual(first.generated.state);
    expect(second).toEqual(first.generated);
  });

  it('different game-like payloads produce different positions and different Test IDs', async () => {
    const service = new TestCaseReplayService();
    const firstIdentity = service.identityForGenerated('game-like', 'torus', 9, 184237);
    const secondIdentity = service.identityForGenerated('game-like', 'torus', 9, 184238);
    const first = await service.createFromIdentity(firstIdentity, false);
    const second = await service.createFromIdentity(secondIdentity, false);
    expect(first.testId).not.toBe(second.testId);
    expect(boardSignature(first.state.board)).not.toBe(boardSignature(second.state.board));
  });

  it.each([
    { topology: 'torus' as const, size: 9, payload: 271828 },
    { topology: 'cube' as const, size: 5, payload: 161803 },
    { topology: 'cube' as const, size: 2, payload: 42 },
  ])('creates manual endgame Test IDs with guaranteed classifier control groups', async (shape) => {
    const service = new TestCaseReplayService();
    const identity = service.identityForGenerated(
      'synthetic-endgame',
      shape.topology,
      shape.size,
      shape.payload,
    );
    expect(identity.variant).toBe(CONTROLLED_ENDGAME_TEST_CASE_VARIANT);

    const generated = await service.createFromIdentity(identity, false);
    const topology = createTestCaseTopology(identity);
    const expected = controlledExpectedGroups(generated);
    const minimumOccupied = Math.max(6, Math.floor(topology.points().length * 0.25));
    const dead = expected.filter((group) => group.role === 'mandatory-dead');
    const alive = expected.filter((group) => group.role === 'control-alive');
    const unresolved = expected.filter((group) => group.role === 'intentional-unresolved');

    expect(generated.loadStrategy).toBe('snapshot');
    expect(generated.commands).toHaveLength(0);
    expect(generated.state.phase).toBe('playing');
    expect(generated.scenario).toBe('controlled-mixed-endgame');
    expect(generated.tags).toEqual(expect.arrayContaining([
      'full-position',
      'game-like-background',
      'mandatory-dead',
      'control-alive',
      'intentional-unresolved',
      'topology-specific-contact',
    ]));
    expect(occupiedCount(generated.state.board)).toBeGreaterThanOrEqual(minimumOccupied);
    expect(dead.length).toBeGreaterThanOrEqual(1);
    expect(alive).toHaveLength(1);
    expect(unresolved.length).toBeGreaterThanOrEqual(2);
    expect(dead.every((group) => group.expected === 'dead')).toBe(true);
    expect(alive.every((group) => group.expected === 'alive')).toBe(true);
    expect(unresolved.every((group) => group.expected === 'unresolved')).toBe(true);
    expect((await finishTwoPasses(generated.testId)).phase).toBe('endgame');
    expect(await service.createFromId(generated.testId, false)).toEqual(generated);
  }, 30_000);

  it('keeps the previous full-legal manual endgame variant replayable by its existing Test ID', async () => {
    const service = new TestCaseReplayService();
    const identity = makeTestCaseIdentity({
      source: 'synthetic-endgame',
      topology: 'torus',
      size: 9,
      variant: LIVE_ENDGAME_TEST_CASE_VARIANT,
      transform: 0,
      payload: 271828,
    });
    const generated = await service.createFromIdentity(identity, false);
    const replayed = await replayCommands(service, generated.testId);

    expect(generated.scenario).toBe('full-endgame');
    expect(generated.loadStrategy).toBe('replay-commands');
    expect(replayed.replayed).toEqual(generated.state);
  });

  it('keeps topology-specific historical synthetic variants explicitly encoded and replayable', async () => {
    const service = new TestCaseReplayService();
    const cube = makeTestCaseIdentity({
      source: 'synthetic-endgame', topology: 'cube', size: 5, variant: 13, transform: 0, payload: 7,
    });
    const torus = makeTestCaseIdentity({
      source: 'synthetic-endgame', topology: 'torus', size: 9, variant: 9, transform: 0, payload: 7,
    });
    const cubeCase = await service.createFromIdentity(cube, false);
    const torusCase = await service.createFromIdentity(torus, false);
    expect(cubeCase.scenario).toBe('cube-corner-shared-liberties');
    expect(torusCase.scenario).toBe('torus-seam-shared-liberties');
    expect(cubeCase.loadStrategy).toBe('snapshot');
    expect(torusCase.loadStrategy).toBe('snapshot');
  });

  it('imports the public-domain corpus case only into a seam-safe Torus interior', async () => {
    const service = new TestCaseReplayService();
    const identity = service.identityForCorpus('torus', 9, 0, 0);
    const generated = await service.createFromIdentity(identity, false);
    expect(generated.identity.source).toBe('corpus');
    expect(generated.diagnostics?.sourceId).toBe('xuanxuan-qijing:1');
    expect(generated.diagnostics?.sourceStatus).toBe('unknown');
    expect(generated.targetPoints).toHaveLength(1);
    for (const point of Object.keys(generated.state.board).filter((point) => generated.state.board[point] !== 'empty')) {
      const [x, y] = point.split(',').map(Number);
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
      expect(x).toBeLessThan(8);
      expect(y).toBeLessThan(8);
    }
  });

  it('keeps a corpus case inside one Cube face with an empty edge margin', async () => {
    const service = new TestCaseReplayService();
    const identity = service.identityForCorpus('cube', 6, 0, 17);
    const generated = await service.createFromIdentity(identity, false);
    const occupied = Object.keys(generated.state.board).filter((point) => generated.state.board[point] !== 'empty');
    const faces = new Set(occupied.map((point) => point.split(':')[0]));
    expect(faces.size).toBe(1);
    for (const point of occupied) {
      const [, rowText, columnText] = point.split(':');
      const row = Number(rowText);
      const column = Number(columnText);
      expect(row).toBeGreaterThan(0);
      expect(column).toBeGreaterThan(0);
      expect(row).toBeLessThan(5);
      expect(column).toBeLessThan(5);
    }
  });

  it('rejects corpus import instead of reinterpreting an ordinary planar neighborhood as a Cube edge', async () => {
    const service = new TestCaseReplayService();
    const identity = service.identityForCorpus('cube', 5, 0, 0);
    await expect(service.createFromIdentity(identity, false)).rejects.toThrow(/safety margin/i);
  });

  it('reports stable KataGo ownership separately from the source and Cube Go result', async () => {
    const service = new TestCaseReplayService({ localAnalysisClient: fakeKataGoClient(['alive', 'alive']) });
    const generated = await service.createFromIdentity(service.identityForCorpus('torus', 9, 0, 0), true);
    expect(generated.diagnostics?.sourceStatus).toBe('unknown');
    expect(generated.diagnostics?.kataGoStatus).toBe('alive');
    expect(generated.diagnostics?.attention).toBe(generated.diagnostics?.cubeGoStatus !== 'alive');
  });

  it('marks inconsistent KataGo results as unstable and requiring attention', async () => {
    const service = new TestCaseReplayService({ localAnalysisClient: fakeKataGoClient(['alive', 'dead']) });
    const generated = await service.createFromIdentity(service.identityForCorpus('torus', 9, 0, 0), true);
    expect(generated.diagnostics?.kataGoStatus).toBe('unstable');
    expect(generated.diagnostics?.attention).toBe(true);
  });
});