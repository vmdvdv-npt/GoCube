import { describe, expect, it } from 'vitest';
import type { BoardOccupancy, GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { proveSafeConnectionToBenson, SAFE_CONNECTION_ALGORITHM } from './SafeConnection';

class GraphTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];
  private readonly adjacency: ReadonlyMap<PointId, readonly PointId[]>;

  constructor(id: string, edges: readonly (readonly [PointId, PointId])[]) {
    this.id = id;
    const neighbors = new Map<PointId, Set<PointId>>();
    for (const [left, right] of edges) {
      if (!neighbors.has(left)) neighbors.set(left, new Set());
      if (!neighbors.has(right)) neighbors.set(right, new Set());
      neighbors.get(left)!.add(right);
      neighbors.get(right)!.add(left);
    }
    this.allPoints = Object.freeze([...neighbors.keys()].sort());
    this.adjacency = new Map(
      [...neighbors].map(([point, values]) => [point, Object.freeze([...values].sort())] as const),
    );
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  neighbors(point: PointId): readonly PointId[] {
    const values = this.adjacency.get(point);
    if (!values) throw new Error(`Unknown graph point: ${point}`);
    return values;
  }

  has(point: PointId): boolean {
    return this.adjacency.has(point);
  }
}

const makeBoard = (
  topology: Topology,
  stones: Readonly<Partial<Record<PointId, PointOccupancy>>>,
): BoardOccupancy => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze(board);
};

const targetAt = (
  board: BoardOccupancy,
  topology: Topology,
  point: PointId,
): EndgameStoneString => {
  const group = buildEndgameGraph(board, topology).strings.find((candidate) =>
    candidate.points.includes(point),
  );
  if (!group) throw new Error(`No target at ${point}`);
  return group;
};

const makeState = (board: BoardOccupancy): GameState =>
  Object.freeze({
    board,
    currentPlayer: 'black' as const,
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame' as const,
    captures: Object.freeze({ black: 0, white: 0 }),
  });

const twoLibertyFixture = (): Readonly<{ topology: Topology; board: BoardOccupancy }> => {
  const topology = new GraphTopology('safe-connection-two-liberties', [
    ['t', 'c1'],
    ['t', 'c2'],
    ['s', 'c1'],
    ['s', 'c2'],
    ['c1', 'u'],
    ['u', 'c2'],
    ['s', 'e1'],
    ['s', 'e2'],
    ['s', 'far'],
  ]);
  return Object.freeze({
    topology,
    board: makeBoard(topology, {
      t: 'black',
      s: 'black',
    }),
  });
};

describe('SafeConnection', () => {
  it('proves a quiet two-shared-liberty miai connection to a Benson-alive group', () => {
    const { topology, board } = twoLibertyFixture();
    const target = targetAt(board, topology, 't');
    const safe = targetAt(board, topology, 's');

    const result = proveSafeConnectionToBenson(target, board, topology);

    expect(result.outcome).toBe('proven');
    if (result.outcome !== 'proven') throw new Error(`Unexpected result: ${result.outcome}`);
    expect(result.evidence.algorithm).toBe(SAFE_CONNECTION_ALGORITHM);
    expect(result.evidence.proof).toBe('miai-two-shared-liberties-to-benson');
    expect(result.evidence.safeGroupKey).toBe(safe.key);
    expect(result.evidence.connectors).toEqual(['c1', 'c2']);
  });

  it('keeps the exact proof unchanged after an irrelevant mutation beyond the safe boundary', () => {
    const { topology, board } = twoLibertyFixture();
    const target = targetAt(board, topology, 't');
    const changedBoard = Object.freeze({ ...board, far: 'white' as const });
    const changedTarget = targetAt(changedBoard, topology, 't');

    const original = proveSafeConnectionToBenson(target, board, topology);
    const changed = proveSafeConnectionToBenson(changedTarget, changedBoard, topology);

    expect(original.outcome).toBe('proven');
    expect(changed).toEqual(original);
  });

  it('does not promote a single shared liberty to a forced connection', () => {
    const topology = new GraphTopology('safe-connection-one-liberty', [
      ['t', 'c1'],
      ['s', 'c1'],
      ['c1', 'u'],
      ['u', 'c2'],
      ['s', 'c2'],
      ['s', 'e1'],
      ['s', 'e2'],
      ['s', 'far'],
    ]);
    const board = makeBoard(topology, { t: 'black', s: 'black' });
    const target = targetAt(board, topology, 't');

    const result = proveSafeConnectionToBenson(target, board, topology);

    expect(result).toEqual({ outcome: 'not-proven', reason: 'no-simple-miai-pair' });
  });

  it('propagates unknown-boundary instead of attempting a global connection proof', () => {
    const topology = new GraphTopology('safe-connection-open', [
      ['t', 'a'],
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
    ]);
    const board = makeBoard(topology, { t: 'black' });
    const target = targetAt(board, topology, 't');

    const result = proveSafeConnectionToBenson(target, board, topology);

    expect(result).toEqual({
      outcome: 'unknown-boundary',
      reason: 'localisation-covers-whole-board',
    });
  });

  it('promotes the target to automatic alive in the assisted classifier with connection evidence', async () => {
    const { topology, board } = twoLibertyFixture();
    const graph = buildEndgameGraph(board, topology);
    const target = targetAt(board, topology, 't');
    const classifier = new AssistedEndgameClassifier();

    const proposal = await classifier.analyze({
      state: makeState(board),
      topology,
      groups: Object.freeze(graph.strings.map((group) => group.points)),
    });
    const targetProposal = proposal.find((group) => group.points.includes('t'));

    expect(targetProposal?.status).toBe('alive');
    expect(targetProposal?.source).toBe('automatic');
    expect(targetProposal?.evidence?.algorithm).toBe(SAFE_CONNECTION_ALGORITHM);
    expect(targetProposal?.points).toEqual(target.points);
  });
});
