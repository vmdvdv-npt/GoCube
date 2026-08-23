import { describe, expect, it } from 'vitest';
import type { BoardOccupancy, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { proveSimpleCutFromBenson, SIMPLE_CUT_ALGORITHM } from './SimpleCut';

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

const singleCutFixture = (): Readonly<{ topology: Topology; board: BoardOccupancy }> => {
  const topology = new GraphTopology('simple-cut-single', [
    ['t', 'c'],
    ['t', 'x'],
    ['x', 'w'],
    ['s', 'c'],
    ['s', 'e1'],
    ['s', 'e2'],
    ['s', 'far'],
    ['w', 'c'],
    ['w', 'w1'],
    ['w', 'w2'],
  ]);
  return Object.freeze({
    topology,
    board: makeBoard(topology, {
      t: 'black',
      s: 'black',
      w: 'white',
    }),
  });
};

describe('SimpleCut', () => {
  it('proves a quiet single-shared-liberty cut when the blocker becomes Benson-alive', () => {
    const { topology, board } = singleCutFixture();
    const target = targetAt(board, topology, 't');
    const safe = targetAt(board, topology, 's');

    const result = proveSimpleCutFromBenson(target, board, topology);

    expect(result.outcome).toBe('proven');
    if (result.outcome !== 'proven') throw new Error(`Unexpected result: ${result.outcome}`);
    expect(result.evidence.algorithm).toBe(SIMPLE_CUT_ALGORITHM);
    expect(result.evidence.proof).toBe('single-shared-liberty-benson-block');
    expect(result.evidence.safeGroupKey).toBe(safe.key);
    expect(result.evidence.cutPoint).toBe('c');
    expect(result.evidence.blockingSafeGroupPoints).toEqual(['c', 'w']);
  });

  it('keeps the exact cut proof unchanged after an irrelevant mutation beyond the safe boundary', () => {
    const { topology, board } = singleCutFixture();
    const target = targetAt(board, topology, 't');
    const changedBoard = Object.freeze({ ...board, far: 'white' as const });
    const changedTarget = targetAt(changedBoard, topology, 't');

    const original = proveSimpleCutFromBenson(target, board, topology);
    const changed = proveSimpleCutFromBenson(changedTarget, changedBoard, topology);

    expect(original.outcome).toBe('proven');
    expect(changed).toEqual(original);
  });

  it('does not prove a cut when a second shared liberty remains', () => {
    const topology = new GraphTopology('simple-cut-two-connectors', [
      ['t', 'c1'],
      ['t', 'c2'],
      ['t', 'x'],
      ['x', 'w'],
      ['s', 'c1'],
      ['s', 'c2'],
      ['s', 'e1'],
      ['s', 'e2'],
      ['s', 'far'],
      ['w', 'c1'],
      ['w', 'c2'],
      ['w', 'w1'],
      ['w', 'w2'],
    ]);
    const board = makeBoard(topology, { t: 'black', s: 'black', w: 'white' });
    const target = targetAt(board, topology, 't');

    const result = proveSimpleCutFromBenson(target, board, topology);

    expect(result).toEqual({ outcome: 'not-proven', reason: 'no-simple-safe-cut' });
  });

  it('rejects a quiet cut when the blocking attacker string is not Benson-alive', () => {
    const topology = new GraphTopology('simple-cut-unstable-blocker', [
      ['t', 'c'],
      ['t', 'x'],
      ['s', 'c'],
      ['s', 'e1'],
      ['s', 'e2'],
      ['s', 'far'],
      ['c', 'q'],
    ]);
    const board = makeBoard(topology, { t: 'black', s: 'black' });
    const target = targetAt(board, topology, 't');

    const result = proveSimpleCutFromBenson(target, board, topology);

    expect(result).toEqual({ outcome: 'not-proven', reason: 'no-simple-safe-cut' });
  });

  it('rejects a cutting move that captures instead of producing a quiet cut', () => {
    const { topology } = singleCutFixture();
    const board = makeBoard(topology, {
      t: 'black',
      s: 'black',
      w: 'white',
      x: 'white',
    });
    const target = targetAt(board, topology, 't');

    const result = proveSimpleCutFromBenson(target, board, topology);

    expect(result).toEqual({ outcome: 'not-proven', reason: 'no-simple-safe-cut' });
  });

  it('propagates the relevance-zone point budget as unknown-boundary', () => {
    const { topology, board } = singleCutFixture();
    const target = targetAt(board, topology, 't');

    const result = proveSimpleCutFromBenson(target, board, topology, { maxPoints: 4 });

    expect(result).toEqual({ outcome: 'unknown-boundary', reason: 'max-points-exceeded' });
  });

  it('propagates unknown-boundary instead of claiming a cut in a global problem', () => {
    const topology = new GraphTopology('simple-cut-open', [
      ['t', 'a'],
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
    ]);
    const board = makeBoard(topology, { t: 'black' });
    const target = targetAt(board, topology, 't');

    const result = proveSimpleCutFromBenson(target, board, topology);

    expect(result).toEqual({
      outcome: 'unknown-boundary',
      reason: 'localisation-covers-whole-board',
    });
  });
});
