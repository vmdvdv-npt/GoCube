import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import {
  LOCAL_LIFE_DEATH_ALGORITHM,
  readLocalLifeDeath,
  type LocalLifeDeathResult,
} from './LocalLifeDeathReader';

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
  const group = buildEndgameGraph(state.board, topology).strings.find((candidate) =>
    candidate.points.includes(point),
  );
  if (!group) throw new Error(`No target at ${point}`);
  return group;
};

const enclosedFixture = (
  libertyCount: 2 | 3 | 4,
  farOccupancy: PointOccupancy = 'empty',
): Readonly<{ topology: Topology; state: GameState }> => {
  const liberties = ['a', 'b', 'c', 'd'].slice(0, libertyCount);
  const edges: Array<readonly [PointId, PointId]> = [];
  for (const liberty of liberties) {
    edges.push(['t', liberty], [liberty, 'B']);
  }
  edges.push(
    ['t', 'B'],
    ['B', 'be1'],
    ['B', 'be2'],
    ['B', 'outside'],
    ['outside', 'far'],
  );

  const topology = new GraphTopology(`life-death-enclosed-${String(libertyCount)}`, edges);
  return Object.freeze({
    topology,
    state: makeState(topology, {
      t: 'white',
      B: 'black',
      far: farOccupancy,
    }),
  });
};

const adversarialSafeDefenseFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('life-death-adversarial-safe-defense', [
    ['t', 'a'],
    ['t', 'b'],
    ['t', 'c'],
    ['t', 'B'],
    ['a', 'B'],
    ['b', 'B'],
    ['c', 'B'],
    ['c', 'W'],
    ['B', 'be1'],
    ['B', 'be2'],
    ['B', 'bout'],
    ['bout', 'bfar'],
    ['W', 'we1'],
    ['W', 'we2'],
    ['W', 'wout'],
    ['wout', 'wfar'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, {
      t: 'white',
      B: 'black',
      W: 'white',
    }),
  });
};

const analyzeState = async (topology: Topology, state: GameState) => {
  const graph = buildEndgameGraph(state.board, topology);
  return new AssistedEndgameClassifier().analyze({
    state,
    topology,
    groups: Object.freeze(graph.strings.map((group) => group.points)),
  });
};

const exploredNodes = (result: LocalLifeDeathResult): readonly number[] =>
  Object.freeze([
    result.attackerFirst.search?.exploredNodes ?? 0,
    result.defenderFirst.search?.exploredNodes ?? 0,
  ]);

describe('LocalLifeDeathReader Work 6C hardening', () => {
  it('solves a frozen elementary tsumego subset within the deterministic node gate', () => {
    for (const libertyCount of [2, 3, 4] as const) {
      const { topology, state } = enclosedFixture(libertyCount);
      const target = targetAt(state, topology, 't');

      const result = readLocalLifeDeath(target, state, topology, { maxNodes: 512 });

      expect(result.algorithm).toBe(LOCAL_LIFE_DEATH_ALGORITHM);
      expect(result.zone.outcome).toBe('bounded');
      expect(result.attackerFirst.outcome).toBe('proved-dead');
      expect(result.defenderFirst.outcome).toBe('proved-dead');
      expect(result.outcome).toBe('proved-dead');
      for (const nodes of exploredNodes(result)) expect(nodes).toBeLessThan(512);
    }

    const { topology, state } = enclosedFixture(3);
    const safeBoundary = targetAt(state, topology, 'B');
    const alive = readLocalLifeDeath(safeBoundary, state, topology, { maxNodes: 512 });

    expect(alive.attackerFirst.outcome).toBe('proved-alive');
    expect(alive.defenderFirst.outcome).toBe('proved-alive');
    expect(alive.outcome).toBe('proved-alive');
  });

  it('keeps an adversarial defender-first connection to a Benson-safe group unresolved overall', () => {
    const { topology, state } = adversarialSafeDefenseFixture();
    const target = targetAt(state, topology, 't');

    const result = readLocalLifeDeath(target, state, topology, { maxNodes: 512 });

    expect(target.liberties).toEqual(['a', 'b', 'c']);
    expect(result.zone.outcome).toBe('bounded');
    expect(result.attackerFirst.outcome).toBe('proved-dead');
    expect(result.defenderFirst.outcome).toBe('proved-alive');
    expect(result.outcome).toBe('unknown');
    expect(result.defenderFirst.search?.trace.children.map((child) => child.move)).toContain('play:c');
  });

  it('preserves the exact local proof and trace after an irrelevant far-away mutation', () => {
    const original = enclosedFixture(3, 'empty');
    const mutated = enclosedFixture(3, 'white');
    const originalResult = readLocalLifeDeath(
      targetAt(original.state, original.topology, 't'),
      original.state,
      original.topology,
      { maxNodes: 512 },
    );
    const mutatedResult = readLocalLifeDeath(
      targetAt(mutated.state, mutated.topology, 't'),
      mutated.state,
      mutated.topology,
      { maxNodes: 512 },
    );

    expect(originalResult.zone).toEqual(mutatedResult.zone);
    expect(originalResult.outcome).toBe('proved-dead');
    expect(mutatedResult.outcome).toBe('proved-dead');
    expect(originalResult.attackerFirst.search).toEqual(mutatedResult.attackerFirst.search);
    expect(originalResult.defenderFirst.search).toEqual(mutatedResult.defenderFirst.search);
  });

  it('returns byte-for-byte equivalent deterministic proof traces on repeated reads', () => {
    const { topology, state } = enclosedFixture(4);
    const target = targetAt(state, topology, 't');

    const first = readLocalLifeDeath(target, state, topology, { maxNodes: 512 });
    const second = readLocalLifeDeath(target, state, topology, { maxNodes: 512 });
    const third = readLocalLifeDeath(target, state, topology, { maxNodes: 512 });

    expect(first.attackerFirst.search).toEqual(second.attackerFirst.search);
    expect(second.attackerFirst.search).toEqual(third.attackerFirst.search);
    expect(first.defenderFirst.search).toEqual(second.defenderFirst.search);
    expect(second.defenderFirst.search).toEqual(third.defenderFirst.search);
  });

  it('has a deterministic exact-node threshold and fails closed one node below it', () => {
    const { topology, state } = enclosedFixture(3);
    const target = targetAt(state, topology, 't');
    const baseline = readLocalLifeDeath(target, state, topology, { maxNodes: 512 });
    const requiredNodes = Math.max(...exploredNodes(baseline));

    expect(baseline.outcome).toBe('proved-dead');
    expect(requiredNodes).toBeGreaterThan(0);

    const exact = readLocalLifeDeath(target, state, topology, { maxNodes: requiredNodes });
    const below = readLocalLifeDeath(target, state, topology, {
      maxNodes: requiredNodes - 1,
    });

    expect(exact.outcome).toBe('proved-dead');
    expect(below.outcome).toBe('unknown');
    expect([below.attackerFirst.outcome, below.defenderFirst.outcome]).toContain('unknown-budget');
  });

  it('promotes only a fully proved three-liberty local death through the classifier', async () => {
    const { topology, state } = enclosedFixture(3);

    const result = await analyzeState(topology, state);
    const target = result.find((proposal) => proposal.points.includes('t'));

    expect(target).toMatchObject({
      points: ['t'],
      status: 'dead',
      source: 'automatic',
      evidence: {
        algorithm: LOCAL_LIFE_DEATH_ALGORITHM,
        proof: 'proved-dead-both-first-player-orders',
        attackerFirst: { outcome: 'proved-dead' },
        defenderFirst: { outcome: 'proved-dead' },
      },
    });
  });

  it('does not promote a mixed first-player result through the classifier', async () => {
    const { topology, state } = adversarialSafeDefenseFixture();

    const result = await analyzeState(topology, state);
    const target = result.find((proposal) => proposal.points.includes('t'));

    expect(target).toEqual({ points: ['t'], status: 'unresolved' });
  });
});
