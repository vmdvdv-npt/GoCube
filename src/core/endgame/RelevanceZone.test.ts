import { describe, expect, it } from 'vitest';
import type { BoardOccupancy, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { buildRelevanceZone, RELEVANCE_ZONE_ALGORITHM } from './RelevanceZone';

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
    this.adjacency = new Map([...neighbors].map(([point, values]) => [point, Object.freeze([...values].sort())] as const));
  }
  points(): readonly PointId[] { return this.allPoints; }
  neighbors(point: PointId): readonly PointId[] { const values = this.adjacency.get(point); if (!values) throw new Error(`Unknown graph point: ${point}`); return values; }
  has(point: PointId): boolean { return this.adjacency.has(point); }
}

const makeBoard = (topology: Topology, stones: Readonly<Partial<Record<PointId, PointOccupancy>>>): BoardOccupancy => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze(board);
};

const targetAt = (board: BoardOccupancy, topology: Topology, point: PointId): EndgameStoneString => {
  const group = buildEndgameStaticGraph(board, topology).strings.find((candidate) => candidate.points.includes(point));
  if (!group) throw new Error(`No target at ${point}`);
  return group;
};

const boundedFixture = () => {
  const topology = new GraphTopology('relevance-bounded', [
    ['t', 'l1'], ['l1', 'x'], ['l1', 'b0'], ['b0', 'e1'], ['b0', 'e2'], ['b0', 'o1'], ['o1', 'far'],
  ]);
  return Object.freeze({ topology, board: makeBoard(topology, { t: 'white', b0: 'black' }) });
};

describe('RelevanceZone', () => {
  it('uses a Benson-alive string as a certified boundary and stays local', () => {
    const { topology, board } = boundedFixture();
    const target = targetAt(board, topology, 't');
    const safeBoundaryKey = targetAt(board, topology, 'b0').key;
    const zone = buildRelevanceZone(target, board, topology);
    expect(zone.algorithm).toBe(RELEVANCE_ZONE_ALGORITHM);
    expect(zone).toMatchObject({ outcome: 'bounded', reason: 'bounded-closure' });
    expect(zone.points).toEqual(['b0', 'l1', 't', 'x']);
    expect(zone.boundarySafeGroupKeys).toEqual([safeBoundaryKey]);
    expect(zone.localPositionKey).not.toBeNull();
    expect(zone.points).not.toContain('far');
  });

  it('is invariant under occupancy changes outside a certified boundary', () => {
    const { topology, board } = boundedFixture();
    const changedBoard = Object.freeze({ ...board, far: 'white' as const });
    expect(buildRelevanceZone(targetAt(changedBoard, topology, 't'), changedBoard, topology)).toEqual(
      buildRelevanceZone(targetAt(board, topology, 't'), board, topology),
    );
  });

  it('expands through direct opponent contact rather than treating it as a boundary', () => {
    const topology = new GraphTopology('relevance-direct-contact', [
      ['t', 'local'], ['t', 'enemy'], ['enemy', 'outside'], ['outside', 'far'],
    ]);
    const board = makeBoard(topology, { t: 'white', enemy: 'black' });
    const target = targetAt(board, topology, 't');
    const zone = buildRelevanceZone(target, board, topology);
    expect(zone.stringKeys).toEqual([targetAt(board, topology, 'enemy').key, target.key].sort());
    expect(zone).toMatchObject({ outcome: 'unknown-boundary', reason: 'localisation-covers-whole-board' });
  });

  it('fails closed when dependency closure consumes the whole graph', () => {
    const topology = new GraphTopology('relevance-open', [['t', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'd']]);
    const board = makeBoard(topology, { t: 'white' });
    const zone = buildRelevanceZone(targetAt(board, topology, 't'), board, topology);
    expect(zone).toMatchObject({ outcome: 'unknown-boundary', reason: 'localisation-covers-whole-board', localPositionKey: null });
  });

  it('fails closed when the deterministic zone budget is exceeded', () => {
    const { topology, board } = boundedFixture();
    const zone = buildRelevanceZone(targetAt(board, topology, 't'), board, topology, { maxPoints: 2 });
    expect(zone).toMatchObject({ outcome: 'unknown-boundary', reason: 'max-points-exceeded', localPositionKey: null });
  });

  it('fails closed when target identity no longer matches the board', () => {
    const { topology, board } = boundedFixture();
    const target = targetAt(board, topology, 't');
    const changedBoard = Object.freeze({ ...board, t: 'black' as const });
    expect(buildRelevanceZone(target, changedBoard, topology)).toMatchObject({ outcome: 'unknown-boundary', reason: 'target-mismatch' });
  });

  it('validates the local point cap', () => {
    const { topology, board } = boundedFixture();
    expect(() => buildRelevanceZone(targetAt(board, topology, 't'), board, topology, { maxPoints: 0 })).toThrow();
  });
});