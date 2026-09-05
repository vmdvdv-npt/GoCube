import { describe, expect, it } from 'vitest';
import type { BoardOccupancy, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { proveBensonPassAlive } from './BensonPassAlive';
import { buildEndgameStaticGraph } from './EndgameStaticGraph';

class GraphTopology implements Topology {
  readonly id = 'memoized-endgame-analysis';
  private readonly pointsValue = Object.freeze(['a', 'b', 'c', 'd'] as PointId[]);
  private readonly adjacency = new Map<PointId, readonly PointId[]>([
    ['a', Object.freeze(['b', 'd'])],
    ['b', Object.freeze(['a', 'c'])],
    ['c', Object.freeze(['b', 'd'])],
    ['d', Object.freeze(['a', 'c'])],
  ]);

  points(): readonly PointId[] { return this.pointsValue; }
  neighbors(point: PointId): readonly PointId[] {
    const result = this.adjacency.get(point);
    if (!result) throw new Error(`Unknown point: ${point}`);
    return result;
  }
  has(point: PointId): boolean { return this.adjacency.has(point); }
}

const boardFor = (stones: Readonly<Partial<Record<PointId, PointOccupancy>>>): BoardOccupancy => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of ['a', 'b', 'c', 'd']) board[point] = stones[point] ?? 'empty';
  return Object.freeze(board);
};

describe('immutable endgame analysis memoization', () => {
  it('reuses a fully built graph only for the exact immutable board and topology objects', () => {
    const topology = new GraphTopology();
    const board = boardFor({ a: 'black' });
    const first = buildEndgameStaticGraph(board, topology);
    const second = buildEndgameStaticGraph(board, topology);
    expect(second).toBe(first);

    const equivalentButDistinctBoard = boardFor({ a: 'black' });
    expect(buildEndgameStaticGraph(equivalentButDistinctBoard, topology)).not.toBe(first);
  });

  it('reuses only completed Benson proofs and still checks cancellation before cache lookup', () => {
    const topology = new GraphTopology();
    const board = boardFor({ a: 'black' });
    const graph = buildEndgameStaticGraph(board, topology);
    const first = proveBensonPassAlive(board, topology, graph, 'black');
    const second = proveBensonPassAlive(board, topology, graph, 'black');
    expect(second).toBe(first);

    expect(() => proveBensonPassAlive(board, topology, graph, 'black', {
      shouldStop: () => true,
    })).toThrow('Benson/pass-alive proof interrupted');
  });
});
