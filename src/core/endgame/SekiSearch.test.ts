import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { DYNAMIC_SEKI_ALGORITHM, analyzeDynamicSeki } from './SekiSearch';

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
    board: Object.freeze(board), currentPlayer: 'black' as const, moveNumber: 0,
    consecutivePasses: 2, phase: 'endgame' as const,
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const targetAt = (state: GameState, topology: Topology, point: PointId): EndgameStoneString => {
  const target = buildEndgameStaticGraph(state.board, topology).strings.find((candidate) => candidate.points.includes(point));
  if (!target) throw new Error(`No target at ${point}`);
  return target;
};

const mutualRestraint = (id: string) => {
  const topology = new GraphTopology(id, [
    ['L', 's1'], ['R', 's1'], ['L', 's2'], ['R', 's2'], ['OUT1', 'OUT2'],
  ]);
  return { topology, state: makeState(topology, { L: 'black', R: 'white' }) } as const;
};

describe('strict production dynamic seki', () => {
  it('proves seki only when every legal local initiation by both sides loses', async () => {
    const { topology, state } = mutualRestraint('dynamic-seki');
    const result = await analyzeDynamicSeki(targetAt(state, topology, 'L'), targetAt(state, topology, 'R'), state, topology);

    expect(result.algorithm).toBe(DYNAMIC_SEKI_ALGORITHM);
    expect(result.proof).toBe('every-legal-local-initiation-is-losing');
    expect(result.sharedLiberties).toEqual(['s1', 's2']);
    expect(result.leftInitiation.outcome).toBe('all-local-initiations-lose');
    expect(result.rightInitiation.outcome).toBe('all-local-initiations-lose');
    expect(result.leftInitiation.moves.map((move) => [move.point, move.outcome])).toEqual([
      ['s1', 'initiator-loses'], ['s2', 'initiator-loses'],
    ]);
    expect(result.rightInitiation.moves.map((move) => [move.point, move.outcome])).toEqual([
      ['s1', 'initiator-loses'], ['s2', 'initiator-loses'],
    ]);
    expect(result.outcome).toBe('seki');
    expect(result.reason).toBeNull();
  });

  it('can prove mutual restraint beyond the static closed-two-liberty shape', async () => {
    const topology = new GraphTopology('dynamic-seki-external-leaf', [
      ['L', 's1'], ['R', 's1'], ['L', 's2'], ['R', 's2'], ['s1', 'e'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const result = await analyzeDynamicSeki(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.certifiedZone).toContain('e');
    expect(result.leftInitiation.moves.map((move) => move.point)).toContain('e');
    expect(result.rightInitiation.moves.map((move) => move.point)).toContain('e');
    expect(result.leftInitiation.outcome).toBe('all-local-initiations-lose');
    expect(result.rightInitiation.outcome).toBe('all-local-initiations-lose');
    expect(result.outcome).toBe('seki');
  });

  it('does not turn absence of a stable winner into seki', async () => {
    const topology = new GraphTopology('winning-initiation', [['L', 's'], ['R', 's'], ['OUT1', 'OUT2']]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const result = await analyzeDynamicSeki(targetAt(state, topology, 'L'), targetAt(state, topology, 'R'), state, topology);

    expect(result.leftInitiation.outcome).toBe('winning-initiation');
    expect(result.rightInitiation.outcome).toBe('winning-initiation');
    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('winning-initiation');
  });

  it('fails closed when the pair has no certified local boundary', async () => {
    const topology = new GraphTopology('unbounded-seki', [['L', 's1'], ['R', 's1'], ['L', 's2'], ['R', 's2']]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const result = await analyzeDynamicSeki(targetAt(state, topology, 'L'), targetAt(state, topology, 'R'), state, topology);

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('unknown-boundary');
    expect(result.leftInitiation.outcome).toBe('unknown-boundary');
  });

  it('fails closed on third-group interference rather than issuing pairwise seki', async () => {
    const topology = new GraphTopology('third-group-seki', [
      ['L', 's1'], ['R', 's1'], ['L', 's2'], ['R', 's2'],
      ['s2', 'T'], ['T', 't'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white', T: 'white' });
    const result = await analyzeDynamicSeki(targetAt(state, topology, 'L'), targetAt(state, topology, 'R'), state, topology);

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('third-group-interference');
    expect(result.thirdGroupKeys).toHaveLength(1);
  });

  it('fails closed on budget exhaustion and stale target identity', async () => {
    const { topology, state } = mutualRestraint('budget-stale-seki');
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');
    const exhausted = await analyzeDynamicSeki(left, right, state, topology, { maxNodes: 0 });
    expect(exhausted.outcome).toBe('unresolved');
    expect(exhausted.leftInitiation.outcome).toBe('unknown-budget');

    const changed = makeState(topology, { L: 'black', R: 'white', s1: 'black' });
    const stale = await analyzeDynamicSeki(left, right, changed, topology);
    expect(stale.outcome).toBe('unresolved');
    expect(stale.reason).toBe('stale-group');
    expect(stale.leftInitiation.outcome).toBe('unknown-incomplete');
  });
});
