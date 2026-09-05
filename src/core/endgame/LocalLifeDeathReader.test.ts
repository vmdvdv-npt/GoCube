import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { LOCAL_LIFE_DEATH_ALGORITHM, readLocalLifeDeath } from './LocalLifeDeathReader';

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
    board: Object.freeze(board),
    currentPlayer: 'black' as const,
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame' as const,
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const targetAt = (state: GameState, topology: Topology, point: PointId): EndgameStoneString => {
  const group = buildEndgameStaticGraph(state.board, topology).strings.find((candidate) => candidate.points.includes(point));
  if (!group) throw new Error(`No target at ${point}`);
  return group;
};

const twoPointDeadFixture = () => {
  const topology = new GraphTopology('life-death-two-point-dead', [
    ['t', 'a'], ['a', 'b'], ['t', 'B'], ['a', 'B'], ['b', 'B'],
    ['B', 'be1'], ['B', 'be2'], ['B', 'outside'], ['outside', 'far'],
  ]);
  return Object.freeze({ topology, state: makeState(topology, { t: 'white', B: 'black' }) });
};

const safeConnectionFixture = () => {
  const topology = new GraphTopology('life-death-safe-defense', [
    ['t', 'c'], ['t', 'B'], ['c', 'B'], ['c', 'W'],
    ['B', 'be1'], ['B', 'be2'], ['B', 'bout'], ['bout', 'bfar'],
    ['W', 'we1'], ['W', 'we2'], ['W', 'wout'], ['wout', 'wfar'],
  ]);
  return Object.freeze({ topology, state: makeState(topology, { t: 'white', B: 'black', W: 'white' }) });
};

const koFixture = () => {
  const topology = new GraphTopology('life-death-ko', [
    ['t', 'c'], ['t', 'B'], ['c', 'W'],
    ['B', 'be1'], ['B', 'be2'], ['B', 'bout'], ['bout', 'bfar'],
    ['W', 'we1'], ['W', 'we2'], ['W', 'wout'], ['wout', 'wfar'],
  ]);
  return Object.freeze({ topology, state: makeState(topology, { t: 'white', B: 'black', W: 'white' }) });
};

describe('LocalLifeDeathReader production proof safety', () => {
  it('proves a small enclosed false-eye target dead for both first-player orders', () => {
    const { topology, state } = twoPointDeadFixture();
    const result = readLocalLifeDeath(targetAt(state, topology, 't'), state, topology);
    expect(result.algorithm).toBe(LOCAL_LIFE_DEATH_ALGORITHM);
    expect(result.zone.outcome).toBe('bounded');
    expect(result.attackerFirst.outcome).toBe('proved-dead');
    expect(result.defenderFirst.outcome).toBe('proved-dead');
    expect(result.outcome).toBe('proved-dead');
  });

  it('uses current KataGo-style Benson/pass-alive as a proved survival terminal', () => {
    const { topology, state } = twoPointDeadFixture();
    const result = readLocalLifeDeath(targetAt(state, topology, 'B'), state, topology);
    expect(result.attackerFirst.outcome).toBe('proved-alive');
    expect(result.defenderFirst.outcome).toBe('proved-alive');
    expect(result.outcome).toBe('proved-alive');
  });

  it('does not prove dead when one legal defense connects to a proven-alive structure', () => {
    const { topology, state } = safeConnectionFixture();
    const result = readLocalLifeDeath(targetAt(state, topology, 't'), state, topology);
    expect(result.attackerFirst.outcome).toBe('proved-dead');
    expect(result.defenderFirst.outcome).toBe('proved-alive');
    expect(result.outcome).toBe('unknown');
    expect(result.defenderFirst.search?.trace.children.map((child) => child.move)).toContain('play:c');
  });

  it('turns exact node-budget exhaustion into unknown', () => {
    const { topology, state } = twoPointDeadFixture();
    const result = readLocalLifeDeath(targetAt(state, topology, 'B'), state, topology, { maxNodes: 0 });
    expect(result.attackerFirst.outcome).toBe('unknown-budget');
    expect(result.defenderFirst.outcome).toBe('unknown-budget');
    expect(result.outcome).toBe('unknown');
  });

  it('fails closed when the Relevance Zone cannot be bounded', () => {
    const topology = new GraphTopology('life-death-open', [['t', 'a'], ['a', 'b'], ['b', 'c']]);
    const state = makeState(topology, { t: 'white' });
    const result = readLocalLifeDeath(targetAt(state, topology, 't'), state, topology);
    expect(result.zone.outcome).toBe('unknown-boundary');
    expect(result.outcome).toBe('unknown');
  });

  it('fails closed as ko-dependent rather than guessing the ko result', () => {
    const { topology, state } = koFixture();
    const result = readLocalLifeDeath(targetAt(state, topology, 't'), state, topology, { maxNodes: 200 });
    expect(result.zone.outcome).toBe('bounded');
    expect(result.attackerFirst.outcome).toBe('ko-dependent');
    expect(result.outcome).toBe('unknown');
  });
});
