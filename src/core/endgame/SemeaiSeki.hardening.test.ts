import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { BASIC_SEKI_ALGORITHM, analyzeBasicSeki, type BasicSekiResult } from './SekiSearch';
import { SIMPLE_SEMEAI_ALGORITHM, analyzeSimpleSemeai } from './SemeaiCore';
import {
  BOUNDED_SEMEAI_ALGORITHM,
  analyzeBoundedSemeai,
  type BoundedSemeaiResult,
} from './SemeaiSearch';

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

const analyzeState = async (topology: Topology, state: GameState) => {
  const graph = buildEndgameGraph(state.board, topology);
  return new AssistedEndgameClassifier().analyze({
    state,
    topology,
    groups: Object.freeze(graph.strings.map((group) => group.points)),
  });
};

const stableLeftRace = (
  far: PointOccupancy = 'empty',
): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work7d-stable-left', [
    ['L', 'R'],
    ['L', 's'],
    ['R', 's'],
    ['L', 'l'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, { L: 'black', R: 'white', OUT1: far }),
  });
};

const simpleStableLeftRace = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work7d-simple-stable-left', [
    ['L', 'R'],
    ['L', 'l1'],
    ['L', 'l2'],
    ['R', 'r'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, { L: 'black', R: 'white' }),
  });
};

const firstPlayerRace = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work7d-first-player-dependent', [
    ['L', 'R'],
    ['L', 's'],
    ['R', 's'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, { L: 'black', R: 'white' }),
  });
};

const basicSeki = (
  far: PointOccupancy = 'empty',
): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work7d-basic-seki', [
    ['L', 's1'],
    ['R', 's1'],
    ['L', 's2'],
    ['R', 's2'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, { L: 'black', R: 'white', OUT1: far }),
  });
};

const koDependentSekiCandidate = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work7d-ko-dependent-seki-candidate', [
    ['L', 's1'],
    ['R', 's1'],
    ['L', 's2'],
    ['R', 's2'],
    ['L', 'A'],
    ['A', 'k'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, { L: 'black', R: 'white', A: 'white' }),
  });
};

const semeaiExploredNodes = (result: BoundedSemeaiResult): readonly number[] =>
  Object.freeze([
    result.leftFirst.search?.exploredNodes ?? 0,
    result.rightFirst.search?.exploredNodes ?? 0,
  ]);

const sekiExploredNodes = (result: BasicSekiResult): readonly number[] =>
  Object.freeze(
    [result.leftInitiation, result.rightInitiation].flatMap((initiation) =>
      initiation.moves.flatMap((move) => {
        if (!move.continuation) return [];
        return semeaiExploredNodes(move.continuation);
      }),
    ),
  );

describe('Work 7D semeai / seki hardening and classifier integration', () => {
  it('keeps stable bounded semeai proof deterministic and inside the production node gate', () => {
    const { topology, state } = stableLeftRace();
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');

    const first = analyzeBoundedSemeai(left, right, state, topology, { maxNodes: 256 });
    const second = analyzeBoundedSemeai(left, right, state, topology, { maxNodes: 256 });
    const third = analyzeBoundedSemeai(left, right, state, topology, { maxNodes: 256 });

    expect(first.algorithm).toBe(BOUNDED_SEMEAI_ALGORITHM);
    expect(first.outcome).toBe('left-wins');
    expect(first.leftFirst.outcome).toBe('left-wins');
    expect(first.rightFirst.outcome).toBe('left-wins');
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    for (const nodes of semeaiExploredNodes(first)) {
      expect(nodes).toBeGreaterThan(0);
      expect(nodes).toBeLessThan(256);
    }
  });

  it('preserves the complete local bounded-semeai proof after an irrelevant far-away mutation', () => {
    const original = stableLeftRace('empty');
    const mutated = stableLeftRace('black');

    const originalResult = analyzeBoundedSemeai(
      targetAt(original.state, original.topology, 'L'),
      targetAt(original.state, original.topology, 'R'),
      original.state,
      original.topology,
      { maxNodes: 256 },
    );
    const mutatedResult = analyzeBoundedSemeai(
      targetAt(mutated.state, mutated.topology, 'L'),
      targetAt(mutated.state, mutated.topology, 'R'),
      mutated.state,
      mutated.topology,
      { maxNodes: 256 },
    );

    expect(originalResult).toEqual(mutatedResult);
  });

  it('has an exact deterministic bounded-semeai node threshold and fails closed one node below it', () => {
    const { topology, state } = stableLeftRace();
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');
    const baseline = analyzeBoundedSemeai(left, right, state, topology, { maxNodes: 256 });
    const requiredNodes = Math.max(...semeaiExploredNodes(baseline));

    expect(baseline.outcome).toBe('left-wins');
    expect(requiredNodes).toBeGreaterThan(0);

    const exact = analyzeBoundedSemeai(left, right, state, topology, { maxNodes: requiredNodes });
    const below = analyzeBoundedSemeai(left, right, state, topology, {
      maxNodes: requiredNodes - 1,
    });

    expect(exact.outcome).toBe('left-wins');
    expect(below.outcome).toBe('unresolved');
    expect([below.leftFirst.outcome, below.rightFirst.outcome]).toContain('unknown-budget');
  });

  it('promotes only the stable bounded-semeai loser to dead, never the winner to alive', async () => {
    const { topology, state } = stableLeftRace();
    const result = await analyzeState(topology, state);
    const left = result.find((proposal) => proposal.points.includes('L'));
    const right = result.find((proposal) => proposal.points.includes('R'));

    expect(left).toEqual({ points: ['L'], status: 'unresolved' });
    expect(right).toMatchObject({
      points: ['R'],
      status: 'dead',
      source: 'automatic',
      evidence: {
        algorithm: BOUNDED_SEMEAI_ALGORITHM,
        proof: 'stable-loser-both-first-player-orders',
        winnerCrucialStones: ['L'],
        loserCrucialStones: ['R'],
        leftFirst: { outcome: 'left-wins' },
        rightFirst: { outcome: 'left-wins' },
      },
    });
  });

  it('integrates the cheap Work 7A stable simple-semeai proof without inferring winner life', async () => {
    const { topology, state } = simpleStableLeftRace();
    const leftTarget = targetAt(state, topology, 'L');
    const rightTarget = targetAt(state, topology, 'R');
    const direct = analyzeSimpleSemeai(leftTarget, rightTarget, state, topology, {
      maxExclusiveLiberties: 3,
    });
    const result = await analyzeState(topology, state);

    expect(direct.algorithm).toBe(SIMPLE_SEMEAI_ALGORITHM);
    expect(direct.outcome).toBe('left-wins');
    expect(result.find((proposal) => proposal.points.includes('L'))).toEqual({
      points: ['L'],
      status: 'unresolved',
    });
    expect(result.find((proposal) => proposal.points.includes('R'))).toMatchObject({
      status: 'dead',
      source: 'automatic',
      evidence: {
        algorithm: SIMPLE_SEMEAI_ALGORITHM,
        proof: 'stable-simple-loser-both-first-player-orders',
      },
    });
  });

  it('does not promote a first-player-dependent semeai through the classifier', async () => {
    const { topology, state } = firstPlayerRace();
    const direct = analyzeBoundedSemeai(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
      { maxNodes: 256 },
    );
    const result = await analyzeState(topology, state);

    expect(direct.outcome).toBe('first-player-dependent');
    expect(result.find((proposal) => proposal.points.includes('L'))).toEqual({
      points: ['L'],
      status: 'unresolved',
    });
    expect(result.find((proposal) => proposal.points.includes('R'))).toEqual({
      points: ['R'],
      status: 'unresolved',
    });
  });

  it('does not promote a ko-dependent basic-seki candidate through the classifier', async () => {
    const { topology, state } = koDependentSekiCandidate();
    const direct = analyzeBasicSeki(
      targetAt(state, topology, 'L'),
      targetAt(state, topology, 'R'),
      state,
      topology,
    );
    const result = await analyzeState(topology, state);

    expect(direct.outcome).toBe('ko-dependent');
    expect(result.find((proposal) => proposal.points.includes('L'))?.status).toBe('unresolved');
    expect(result.find((proposal) => proposal.points.includes('R'))?.status).toBe('unresolved');
  });

  it('keeps basic-seki proof deterministic and invariant under an irrelevant far-away mutation', () => {
    const original = basicSeki('empty');
    const mutated = basicSeki('black');
    const first = analyzeBasicSeki(
      targetAt(original.state, original.topology, 'L'),
      targetAt(original.state, original.topology, 'R'),
      original.state,
      original.topology,
      { maxNodes: 256 },
    );
    const second = analyzeBasicSeki(
      targetAt(mutated.state, mutated.topology, 'L'),
      targetAt(mutated.state, mutated.topology, 'R'),
      mutated.state,
      mutated.topology,
      { maxNodes: 256 },
    );

    expect(first.algorithm).toBe(BASIC_SEKI_ALGORITHM);
    expect(first.outcome).toBe('seki');
    expect(first).toEqual(second);
    expect(sekiExploredNodes(first).length).toBeGreaterThan(0);
    for (const nodes of sekiExploredNodes(first)) expect(nodes).toBeLessThan(256);
  });

  it('fails basic seki closed under an insufficient deterministic continuation budget', () => {
    const { topology, state } = basicSeki();
    const left = targetAt(state, topology, 'L');
    const right = targetAt(state, topology, 'R');
    const baseline = analyzeBasicSeki(left, right, state, topology, { maxNodes: 256 });
    const requiredNodes = Math.max(...sekiExploredNodes(baseline));

    expect(baseline.outcome).toBe('seki');
    expect(requiredNodes).toBeGreaterThan(0);

    const exact = analyzeBasicSeki(left, right, state, topology, { maxNodes: requiredNodes });
    const below = analyzeBasicSeki(left, right, state, topology, {
      maxNodes: requiredNodes - 1,
    });

    expect(exact.outcome).toBe('seki');
    expect(below.outcome).toBe('unresolved');
    expect([below.leftInitiation.outcome, below.rightInitiation.outcome]).toContain(
      'unknown-budget',
    );
  });

  it('promotes only an accepted basic-seki proof to both automatic seki statuses', async () => {
    const { topology, state } = basicSeki();
    const result = await analyzeState(topology, state);
    const left = result.find((proposal) => proposal.points.includes('L'));
    const right = result.find((proposal) => proposal.points.includes('R'));

    for (const proposal of [left, right]) {
      expect(proposal).toMatchObject({
        status: 'seki',
        source: 'automatic',
        evidence: {
          algorithm: BASIC_SEKI_ALGORITHM,
          proof: 'every-legal-local-initiation-is-losing',
          leftInitiation: { outcome: 'all-local-initiations-lose' },
          rightInitiation: { outcome: 'all-local-initiations-lose' },
        },
      });
    }
  });
});
