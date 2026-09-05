import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { BOUNDED_SEMEAI_ALGORITHM, analyzeBoundedSemeai, analyzeBoundedSemeaiAsync } from './SemeaiSearch';

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
  points(): readonly PointId[] { return this.allPoints; }
  neighbors(point: PointId): readonly PointId[] {
    const values = this.adjacency.get(point);
    if (!values) throw new Error(`Unknown graph point: ${point}`);
    return values;
  }
  has(point: PointId): boolean { return this.adjacency.has(point); }
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

const targetAt = (state: GameState, topology: Topology, point: PointId): EndgameStoneString => {
  const target = buildEndgameStaticGraph(state.board, topology).strings.find((candidate) => candidate.points.includes(point));
  if (!target) throw new Error(`No target at ${point}`);
  return target;
};

describe('production bounded semeai', () => {
  it('solves a shared-liberty first-player-dependent race and checks both move orders', () => {
    const topology = new GraphTopology('shared-first-player', [
      ['L', 'R'], ['L', 's'], ['R', 's'], ['s', 'B'], ['B', 'b'], ['s', 'W'], ['W', 'w'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white', B: 'black', W: 'white' });
    const result = analyzeBoundedSemeai(targetAt(state, topology, 'L'), targetAt(state, topology, 'R'), state, topology);

    expect(result.algorithm).toBe(BOUNDED_SEMEAI_ALGORITHM);
    expect(result.sharedLiberties).toContain('s');
    expect(result.leftFirst.outcome).toBe('left-wins');
    expect(result.rightFirst.outcome).toBe('right-wins');
    expect(result.outcome).toBe('first-player-dependent');
  });

  it('proves a stable winner with captures/connections inside one certified region', () => {
    const topology = new GraphTopology('stable-left', [
      ['L', 'R'], ['L', 's'], ['R', 's'], ['s', 'B'], ['B', 'b'], ['L', 'l'], ['l', 'W'], ['W', 'w'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white', B: 'black', W: 'white' });
    const result = analyzeBoundedSemeai(targetAt(state, topology, 'L'), targetAt(state, topology, 'R'), state, topology);

    expect(result.leftFirst.outcome).toBe('left-wins');
    expect(result.rightFirst.outcome).toBe('left-wins');
    expect(result.outcome).toBe('stable-left-winner');
  });

  it('keeps a restoring simple ko ko-dependent', () => {
    const topology = new GraphTopology('restoring-ko', [
      ['L', 'R'], ['L', 'l1'], ['l1', 'le1'], ['L', 'l2'], ['l2', 'le2'], ['R', 'c'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const result = analyzeBoundedSemeai(targetAt(state, topology, 'L'), targetAt(state, topology, 'R'), state, topology);

    expect(result.outcome).toBe('ko-dependent');
    expect([result.leftFirst.outcome, result.rightFirst.outcome]).toContain('ko-dependent');
  });

  it('fails closed on zero node budget and stale target identity', () => {
    const topology = new GraphTopology('budget-and-stale', [
      ['L', 'R'], ['L', 'l'], ['l', 'W'], ['W', 'w'], ['R', 'r'], ['r', 'B'], ['B', 'b'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white', W: 'white', B: 'black' });
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');

    const exhausted = analyzeBoundedSemeai(left, right, state, topology, { maxNodes: 0 });
    expect(exhausted.outcome).toBe('unknown-budget');
    expect(exhausted.leftFirst.outcome).toBe('unknown-budget');

    const changed = makeState(topology, { L: 'black', R: 'white', W: 'white', B: 'black', l: 'black' });
    const stale = analyzeBoundedSemeai(left, right, changed, topology);
    expect(stale.outcome).toBe('unknown-incomplete');
    expect(stale.leftFirst.search).toBeNull();
  });

  it('cooperatively yields during async search without changing proof semantics', async () => {
    const topology = new GraphTopology('cooperative', [
      ['L', 'R'], ['L', 's'], ['R', 's'], ['s', 'B'], ['B', 'b'], ['s', 'W'], ['W', 'w'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white', B: 'black', W: 'white' });
    let checkpoints = 0;
    const result = await analyzeBoundedSemeaiAsync(targetAt(state, topology, 'L'), targetAt(state, topology, 'R'), state, topology, {
      cooperativeCheckpoint: async () => { checkpoints += 1; await Promise.resolve(); return false; },
    });
    expect(checkpoints).toBeGreaterThan(1);
    expect(result.outcome).toBe('first-player-dependent');
  });
});
