import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { BASIC_SEKI_ALGORITHM, analyzeBasicSeki } from './SekiSearch';

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

const basicMutualRestraint = (
  id = 'work7c-basic-mutual-restraint',
): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology(id, [
    ['L', 's1'],
    ['R', 's1'],
    ['L', 's2'],
    ['R', 's2'],
    ['OUT1', 'OUT2'],
  ]);
  const state = makeState(topology, { L: 'black', R: 'white' });
  return Object.freeze({ topology, state });
};

describe('SekiSearch Work 7C', () => {
  it('proves basic seki only when every legal local initiation by either side loses', () => {
    const { topology, state } = basicMutualRestraint();
    const result = analyzeBasicSeki(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.algorithm).toBe(BASIC_SEKI_ALGORITHM);
    expect(result.proof).toBe('every-legal-local-initiation-is-losing');
    expect(result.sharedLiberties).toEqual(['s1', 's2']);
    expect(result.leftZone?.outcome).toBe('bounded');
    expect(result.rightZone?.outcome).toBe('bounded');
    expect(result.leftInitiation.outcome).toBe('all-local-initiations-lose');
    expect(result.rightInitiation.outcome).toBe('all-local-initiations-lose');
    expect(result.leftInitiation.moves.map((move) => [move.point, move.outcome])).toEqual([
      ['s1', 'initiator-loses'],
      ['s2', 'initiator-loses'],
    ]);
    expect(result.rightInitiation.moves.map((move) => [move.point, move.outcome])).toEqual([
      ['s1', 'initiator-loses'],
      ['s2', 'initiator-loses'],
    ]);
    expect(result.outcome).toBe('seki');
    expect(result.reason).toBeNull();
  });

  it('does not call a first-move capture race seki', () => {
    const topology = new GraphTopology('work7c-winning-initiation', [
      ['L', 's'],
      ['R', 's'],
      ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });

    const result = analyzeBasicSeki(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.leftInitiation.outcome).toBe('winning-initiation');
    expect(result.rightInitiation.outcome).toBe('winning-initiation');
    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('winning-initiation');
  });

  it('requires explicit shared-liberty mutual dependence rather than mere opposing contact', () => {
    const topology = new GraphTopology('work7c-no-shared-liberty', [
      ['L', 'R'],
      ['L', 'l'],
      ['R', 'r'],
      ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });

    const result = analyzeBasicSeki(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('no-shared-liberty');
    expect(result.leftInitiation.moves).toEqual([]);
  });

  it('fails closed when a continuation exhausts the deterministic node budget', () => {
    const { topology, state } = basicMutualRestraint('work7c-budget');
    const result = analyzeBasicSeki(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
      { maxNodes: 0 },
    );

    expect(result.leftInitiation.outcome).toBe('unknown-budget');
    expect(result.rightInitiation.outcome).toBe('unknown-budget');
    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('mixed-initiation-uncertainty');
  });

  it('fails closed before proof when the mutual conflict region is not bounded', () => {
    const topology = new GraphTopology('work7c-unbounded', [
      ['L', 's1'],
      ['R', 's1'],
      ['L', 's2'],
      ['R', 's2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });

    const result = analyzeBasicSeki(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('unknown-boundary');
    expect(result.leftInitiation.outcome).toBe('unknown-boundary');
    expect(result.rightInitiation.outcome).toBe('unknown-boundary');
  });

  it('keeps an initiation-created restoring simple ko ko-dependent', () => {
    const topology = new GraphTopology('work7c-initiation-ko', [
      ['L', 's1'],
      ['R', 's1'],
      ['L', 's2'],
      ['R', 's2'],
      ['L', 'A'],
      ['A', 'k'],
      ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, {
      L: 'black',
      R: 'white',
      A: 'white',
    });

    const result = analyzeBasicSeki(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.leftInitiation.moves).toEqual(
      expect.arrayContaining([expect.objectContaining({ point: 'k', outcome: 'ko-dependent' })]),
    );
    expect(result.outcome).toBe('ko-dependent');
  });

  it('rejects stale supplied target identity before starting seki proof', () => {
    const { topology, state } = basicMutualRestraint('work7c-stale');
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');
    const changed = makeState(topology, {
      L: 'black',
      R: 'white',
      s1: 'black',
    });

    const result = analyzeBasicSeki(left, right, changed, topology);

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('stale-group');
    expect(result.leftInitiation.outcome).toBe('unknown-incomplete');
  });
});
