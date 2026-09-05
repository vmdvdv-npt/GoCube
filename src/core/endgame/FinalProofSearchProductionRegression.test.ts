import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/GameEngine';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { AssistedEndgameClassifier, analyzeFinalGroupJudge } from './AssistedEndgameClassifier';
import { FinalProofSearchRunController } from './FinalProofSearchRunController';

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
    moveNumber: 77,
    consecutivePasses: 2,
    phase: 'endgame' as const,
    captures: Object.freeze({ black: 4, white: 5 }),
  });
};

const groupsFor = (topology: Topology, state: GameState): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];
  for (const point of topology.points()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = Object.freeze([...group.points].sort());
    points.forEach((groupPoint) => visited.add(groupPoint));
    groups.push(points);
  }
  return Object.freeze(groups);
};

const contextFor = (topology: Topology, state: GameState) => Object.freeze({
  state,
  topology,
  groups: groupsFor(topology, state),
});

const proofFocusedClassifier = () => new AssistedEndgameClassifier({
  budget: {
    softWallClockMilliseconds: 2_000,
    hardWallClockMilliseconds: 3_000,
    maxGlobalNodes: 20_000,
    tacticalMaxTargetLiberties: 1,
    tacticalNodeBudget: 1,
    tierNodeBudgets: [1],
    semeaiNodeBudget: 1_000,
    sekiNodeBudget: 1_000,
    cooperativeQuantumMilliseconds: 1,
  },
});

const stableRace = (prefix = '') => {
  const p = (value: string) => `${prefix}${value}`;
  const topology = new GraphTopology(`${prefix}stable-race`, [
    [p('L'), p('R')],
    [p('L'), p('l1')], [p('L'), p('l2')], [p('L'), p('l3')],
    [p('R'), p('r1')], [p('R'), p('r2')],
    [p('OUT1'), p('OUT2')],
  ]);
  const state = makeState(topology, { [p('L')]: 'black', [p('R')]: 'white' });
  return Object.freeze({ topology, state, left: p('L'), right: p('R') });
};

const proposalAt = (
  proposal: Awaited<ReturnType<AssistedEndgameClassifier['analyze']>>,
  point: PointId,
) => proposal.find((group) => group.points.includes(point));

describe('production Final Proof Search regression corpus', () => {
  it('integrates bounded semeai into AssistedEndgameClassifier and marks only the proved loser dead', async () => {
    const { topology, state, left, right } = stableRace();
    const result = await proofFocusedClassifier().analyze(contextFor(topology, state));
    const leftResult = proposalAt(result, left);
    const rightResult = proposalAt(result, right);

    expect(leftResult?.status).toBe('unresolved');
    expect(rightResult).toMatchObject({
      status: 'dead',
      source: 'automatic',
      evidence: {
        algorithm: 'final-proof-search-v2',
        proofType: 'stable-bounded-semeai-winner',
      },
    });
  });

  it('keeps a first-player-dependent capture race unresolved rather than inventing dead or seki', async () => {
    const topology = new GraphTopology('first-player-dependent-race', [
      ['L', 'R'], ['L', 'l1'], ['L', 'l2'], ['R', 'r1'], ['R', 'r2'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const result = await proofFocusedClassifier().analyze(contextFor(topology, state));

    expect(proposalAt(result, 'L')?.status).toBe('unresolved');
    expect(proposalAt(result, 'R')?.status).toBe('unresolved');
    expect(result.some((group) => group.status === 'seki')).toBe(false);
  });

  it('uses dynamic seki when the static closed-two-liberty verifier is intentionally inapplicable', async () => {
    const topology = new GraphTopology('production-dynamic-seki', [
      ['L', 's1'], ['R', 's1'], ['L', 's2'], ['R', 's2'], ['s1', 'e'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const context = contextFor(topology, state);
    const staticProposal = (await analyzeFinalGroupJudge(context)).proposal;
    expect(staticProposal.every((group) => group.status === 'unresolved')).toBe(true);

    const result = await proofFocusedClassifier().analyze(context);
    for (const point of ['L', 'R']) {
      expect(proposalAt(result, point)).toMatchObject({
        status: 'seki',
        source: 'automatic',
        evidence: {
          algorithm: 'final-proof-search-v2',
          proofType: 'every-legal-local-initiation-is-losing',
          reader: 'dynamic-seki-v1',
        },
      });
    }
  });

  it('does not issue pairwise seki when a non-pass-alive third group participates', async () => {
    const topology = new GraphTopology('production-third-group-seki', [
      ['L', 's1'], ['R', 's1'], ['L', 's2'], ['R', 's2'],
      ['s2', 'T'], ['T', 't'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white', T: 'white' });
    const result = await proofFocusedClassifier().analyze(contextFor(topology, state));

    expect(proposalAt(result, 'L')?.status).not.toBe('seki');
    expect(proposalAt(result, 'R')?.status).not.toBe('seki');
  });

  it('keeps a restoring-ko race unresolved instead of promoting it to an automatic result', async () => {
    const topology = new GraphTopology('production-restoring-ko', [
      ['L', 'R'], ['L', 'l1'], ['l1', 'le1'], ['L', 'l2'], ['l2', 'le2'],
      ['R', 'c'], ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const result = await proofFocusedClassifier().analyze(contextFor(topology, state));

    expect(proposalAt(result, 'R')?.status).toBe('unresolved');
  });

  it('applies one request-scoped hard deadline and clears the owning progress channel on exit', async () => {
    const { topology, state } = stableRace('deadline:');
    const runController = new FinalProofSearchRunController();
    let tick = 0;
    const classifier = new AssistedEndgameClassifier({
      runController,
      now: () => tick++,
      yieldControl: async () => Promise.resolve(),
      budget: {
        softWallClockMilliseconds: 1,
        hardWallClockMilliseconds: 2,
        tacticalMaxTargetLiberties: 1,
        tierNodeBudgets: [1],
      },
    });
    const result = await classifier.analyze(contextFor(topology, state));

    expect(result.every((group) => group.status === 'unresolved')).toBe(true);
    expect(runController.current()).toBeNull();
  });

  it('is invariant under topology-preserving point relabeling', async () => {
    const original = stableRace();
    const relabeled = stableRace('renamed:');
    const classifier = proofFocusedClassifier();
    const originalResult = await classifier.analyze(contextFor(original.topology, original.state));
    const relabeledResult = await classifier.analyze(contextFor(relabeled.topology, relabeled.state));

    const originalStatuses = originalResult.map((group) => group.status).sort();
    const relabeledStatuses = relabeledResult.map((group) => group.status).sort();
    expect(relabeledStatuses).toEqual(originalStatuses);
  });
});
