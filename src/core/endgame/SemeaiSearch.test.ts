import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { analyzeSimpleSemeai } from './SemeaiCore';
import { BOUNDED_SEMEAI_ALGORITHM, analyzeBoundedSemeai } from './SemeaiSearch';

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

const makeState = (
  topology: Topology,
  stones: Readonly<Partial<Record<PointId, PointOccupancy>>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black' as const,
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame' as const,
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const targetAt = (
  state: GameState,
  topology: Topology,
  point: PointId,
): EndgameStoneString => {
  const target = buildEndgameGraph(state.board, topology).strings.find((candidate) =>
    candidate.points.includes(point),
  );
  if (!target) throw new Error(`No target at ${point}`);
  return target;
};

const boundedSharedRace = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work7b-shared-first-player', [
    ['L', 'R'],
    ['L', 's'],
    ['R', 's'],
    ['s', 'B'],
    ['B', 'b'],
    ['s', 'W'],
    ['W', 'w'],
    ['OUT1', 'OUT2'],
  ]);
  const state = makeState(topology, {
    L: 'black',
    R: 'white',
    B: 'black',
    W: 'white',
  });
  return Object.freeze({ topology, state });
};

const boundedMultiGroupRace = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work7b-multi-group', [
    ['L', 'R'],
    ['L', 'l'],
    ['l', 'W'],
    ['W', 'w'],
    ['R', 'r'],
    ['r', 'B'],
    ['B', 'b'],
    ['OUT1', 'OUT2'],
  ]);
  const state = makeState(topology, {
    L: 'black',
    R: 'white',
    W: 'white',
    B: 'black',
  });
  return Object.freeze({ topology, state });
};

describe('SemeaiSearch Work 7B', () => {
  it('solves a shared-liberty race with bounded AND/OR search', () => {
    const { topology, state } = boundedSharedRace();
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');

    const simple = analyzeSimpleSemeai(left, right, state, topology);
    expect(simple.outcome).toBe('unresolved');
    expect(simple.reason).toBe('shared-liberties-deferred');

    const result = analyzeBoundedSemeai(left, right, state, topology);

    expect(result.algorithm).toBe(BOUNDED_SEMEAI_ALGORITHM);
    expect(result.leftZone?.outcome).toBe('bounded');
    expect(result.rightZone?.outcome).toBe('bounded');
    expect(result.leftFirst.outcome).toBe('left-wins');
    expect(result.rightFirst.outcome).toBe('right-wins');
    expect(result.outcome).toBe('first-player-dependent');
    expect(result.leftFirst.search?.trace.children[0]?.move).toBe('play:s');
  });

  it('proves a stable winner when a shared liberty is immediately capturable but the other target has one extra liberty', () => {
    const topology = new GraphTopology('work7b-shared-stable-left', [
      ['L', 'R'],
      ['L', 's'],
      ['R', 's'],
      ['s', 'B'],
      ['B', 'b'],
      ['L', 'l'],
      ['l', 'W'],
      ['W', 'w'],
      ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, {
      L: 'black',
      R: 'white',
      B: 'black',
      W: 'white',
    });

    const result = analyzeBoundedSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.leftFirst.outcome).toBe('left-wins');
    expect(result.rightFirst.outcome).toBe('left-wins');
    expect(result.outcome).toBe('left-wins');
  });

  it('handles third-group connection/capture interactions instead of rejecting them statically', () => {
    const { topology, state } = boundedMultiGroupRace();
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');

    const simple = analyzeSimpleSemeai(left, right, state, topology);
    expect(simple.outcome).toBe('unresolved');
    expect(simple.reason).toBe('multi-group-interaction');

    const result = analyzeBoundedSemeai(left, right, state, topology);

    expect(result.zonePoints).toEqual(['B', 'L', 'R', 'W', 'b', 'l', 'r', 'w']);
    expect(result.leftFirst.outcome).toBe('left-wins');
    expect(result.rightFirst.outcome).toBe('right-wins');
    expect(result.outcome).toBe('first-player-dependent');
  });

  it('fails closed when the deterministic AND/OR node budget is exhausted', () => {
    const { topology, state } = boundedMultiGroupRace();

    const result = analyzeBoundedSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
      { maxNodes: 0 },
    );

    expect(result.leftFirst.outcome).toBe('unknown-budget');
    expect(result.rightFirst.outcome).toBe('unknown-budget');
    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('mixed-order-uncertainty');
  });

  it('fails closed when the conflict region cannot be certified as local', () => {
    const topology = new GraphTopology('work7b-unbounded', [
      ['L', 'R'],
      ['L', 's'],
      ['R', 's'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });

    const result = analyzeBoundedSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('unknown-boundary');
    expect(result.leftFirst.outcome).toBe('unknown-boundary');
    expect(result.rightFirst.outcome).toBe('unknown-boundary');
    expect(result.leftFirst.search).toBeNull();
  });

  it('keeps a restoring simple-ko capture ko-dependent rather than promoting it to a winner', () => {
    const topology = new GraphTopology('work7b-ko', [
      ['L', 'R'],
      ['L', 'l1'],
      ['l1', 'le1'],
      ['L', 'l2'],
      ['l2', 'le2'],
      ['R', 'c'],
      ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });

    const result = analyzeBoundedSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.outcome).toBe('ko-dependent');
    expect([result.leftFirst.outcome, result.rightFirst.outcome]).toContain('ko-dependent');
  });

  it('rejects stale supplied group identity before starting search', () => {
    const { topology, state } = boundedMultiGroupRace();
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');
    const changed = makeState(topology, {
      L: 'black',
      R: 'white',
      W: 'white',
      B: 'black',
      l: 'black',
    });

    const result = analyzeBoundedSemeai(left, right, changed, topology);

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('stale-group');
    expect(result.leftFirst.outcome).toBe('unknown-incomplete');
    expect(result.leftFirst.search).toBeNull();
  });
});
