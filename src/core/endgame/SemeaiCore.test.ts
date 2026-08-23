import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { SIMPLE_SEMEAI_ALGORITHM, analyzeSimpleSemeai } from './SemeaiCore';

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

const simpleRace = (
  leftLiberties: number,
  rightLiberties: number,
): Readonly<{ topology: Topology; state: GameState }> => {
  const edges: Array<readonly [PointId, PointId]> = [['L', 'R']];
  for (let index = 1; index <= leftLiberties; index += 1) {
    edges.push(['L', `l${index}`], [`l${index}`, `le${index}`]);
  }
  for (let index = 1; index <= rightLiberties; index += 1) {
    edges.push(['R', `r${index}`], [`r${index}`, `re${index}`]);
  }
  const topology = new GraphTopology(
    `simple-semeai-${leftLiberties}-${rightLiberties}`,
    edges,
  );
  return Object.freeze({
    topology,
    state: makeState(topology, { L: 'black', R: 'white' }),
  });
};

describe('SemeaiCore Work 7A', () => {
  it('proves the side with the shorter exclusive-liberty capture countdown wins in both orders', () => {
    const { topology, state } = simpleRace(2, 1);
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');

    const result = analyzeSimpleSemeai(left, right, state, topology);

    expect(result.algorithm).toBe(SIMPLE_SEMEAI_ALGORITHM);
    expect(result.liberties).toEqual({
      leftExclusive: ['l1', 'l2'],
      rightExclusive: ['r1'],
      shared: [],
    });
    expect(result.leftCapture).toMatchObject({ turns: 1 });
    expect(result.rightCapture).toMatchObject({ turns: 2 });
    expect(result.leftFirst).toMatchObject({
      outcome: 'left-wins',
      leftCapturePly: 1,
      rightCapturePly: 4,
    });
    expect(result.rightFirst).toMatchObject({
      outcome: 'left-wins',
      leftCapturePly: 2,
      rightCapturePly: 3,
    });
    expect(result.outcome).toBe('left-wins');
  });

  it('is symmetric when the right group has the shorter exclusive-liberty countdown', () => {
    const { topology, state } = simpleRace(1, 2);
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');

    const result = analyzeSimpleSemeai(left, right, state, topology);

    expect(result.leftCapture).toMatchObject({ turns: 2 });
    expect(result.rightCapture).toMatchObject({ turns: 1 });
    expect(result.leftFirst?.outcome).toBe('right-wins');
    expect(result.rightFirst?.outcome).toBe('right-wins');
    expect(result.outcome).toBe('right-wins');
  });

  it('reports first-player dependence for an equal one-liberty race', () => {
    const { topology, state } = simpleRace(1, 1);
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');

    const result = analyzeSimpleSemeai(left, right, state, topology);

    expect(result.leftFirst).toMatchObject({ outcome: 'left-wins', leftCapturePly: 1 });
    expect(result.rightFirst).toMatchObject({ outcome: 'right-wins', rightCapturePly: 1 });
    expect(result.outcome).toBe('first-player-dependent');
  });

  it('counts shared liberties but defers solving them to Work 7B', () => {
    const topology = new GraphTopology('simple-semeai-shared-deferred', [
      ['L', 'R'],
      ['L', 'l1'],
      ['l1', 'le1'],
      ['R', 'r1'],
      ['r1', 're1'],
      ['L', 's'],
      ['R', 's'],
      ['s', 'se'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });

    const result = analyzeSimpleSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.liberties).toEqual({
      leftExclusive: ['l1'],
      rightExclusive: ['r1'],
      shared: ['s'],
    });
    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('shared-liberties-deferred');
  });

  it('fails closed when a third group touches the race frontier', () => {
    const topology = new GraphTopology('simple-semeai-third-group', [
      ['L', 'R'],
      ['L', 'l1'],
      ['l1', 'le1'],
      ['R', 'r1'],
      ['r1', 're1'],
      ['l1', 'X'],
      ['X', 'xe'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white', X: 'white' });

    const result = analyzeSimpleSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('multi-group-interaction');
  });

  it('does not accept a liberty countdown when an intermediate attack is suicide', () => {
    const topology = new GraphTopology('simple-semeai-suicide-frontier', [
      ['L', 'R'],
      ['L', 'l1'],
      ['L', 'l2'],
      ['R', 'r1'],
      ['r1', 're1'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });

    const result = analyzeSimpleSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('capture-not-simple');
  });

  it('marks an immediate simple-ko capture as ko-dependent instead of a win', () => {
    const topology = new GraphTopology('simple-semeai-ko', [
      ['L', 'R'],
      ['L', 'l1'],
      ['l1', 'le1'],
      ['L', 'l2'],
      ['l2', 'le2'],
      ['R', 'c'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });

    const result = analyzeSimpleSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );

    expect(result.outcome).toBe('ko-dependent');
    expect(result.reason).toBe('capture-not-simple');
    expect(result.leftFirst).toBeNull();
    expect(result.rightFirst).toBeNull();
  });

  it('fails closed above the explicit small-race liberty budget', () => {
    const { topology, state } = simpleRace(3, 1);

    const result = analyzeSimpleSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
      { maxExclusiveLiberties: 2 },
    );

    expect(result.outcome).toBe('unresolved');
    expect(result.reason).toBe('too-many-liberties');
  });
});
