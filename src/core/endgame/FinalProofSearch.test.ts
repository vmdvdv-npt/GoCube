import { describe, expect, it } from 'vitest';
import type { EndgameAnalysisContext, EndgameProposal } from './EndgameClassifier';
import { runFinalProofSearch } from './FinalProofSearch';
import { buildEndgameStaticGraph } from './EndgameStaticGraph';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

class GraphTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];
  private readonly adjacency: ReadonlyMap<PointId, readonly PointId[]>;

  constructor(id: string, edges: readonly (readonly [PointId, PointId])[]) {
    this.id = id;
    const map = new Map<PointId, Set<PointId>>();
    for (const [a, b] of edges) {
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b); map.get(b)!.add(a);
    }
    this.allPoints = Object.freeze([...map.keys()].sort());
    this.adjacency = new Map([...map].map(([point, values]) => [point, Object.freeze([...values].sort())] as const));
  }
  points(): readonly PointId[] { return this.allPoints; }
  neighbors(point: PointId): readonly PointId[] { const result = this.adjacency.get(point); if (!result) throw new Error(`Unknown ${point}`); return result; }
  has(point: PointId): boolean { return this.adjacency.has(point); }
}

const stateFor = (topology: Topology, stones: Readonly<Partial<Record<PointId, PointOccupancy>>>): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board), currentPlayer: 'black' as const, moveNumber: 42,
    consecutivePasses: 2, phase: 'endgame' as const,
    captures: Object.freeze({ black: 3, white: 2 }),
  });
};

const contextAndProposal = (topology: Topology, state: GameState): readonly [EndgameAnalysisContext, EndgameProposal] => {
  const graph = buildEndgameStaticGraph(state.board, topology);
  const groups = Object.freeze(graph.strings.map((group) => group.points));
  const proposal = Object.freeze(graph.strings.map((group) => Object.freeze({ points: group.points, status: 'unresolved' as const })));
  return Object.freeze([Object.freeze({ state, topology, groups }), proposal]);
};

const deadFixture = () => {
  const topology = new GraphTopology('final-proof-dead', [
    ['t', 'a'], ['a', 'b'], ['t', 'B'], ['a', 'B'], ['b', 'B'],
    ['B', 'be1'], ['B', 'be2'], ['B', 'outside'], ['outside', 'far'],
  ]);
  return Object.freeze({ topology, state: stateFor(topology, { t: 'white', B: 'black' }) });
};

const openFixture = () => {
  const topology = new GraphTopology('final-proof-open-progress', [
    ['t', 'a'], ['t', 'b'], ['t', 'c'], ['t', 'd'],
    ['a', 'x'], ['b', 'x'], ['c', 'x'], ['d', 'x'],
  ]);
  return Object.freeze({ topology, state: stateFor(topology, { t: 'white' }) });
};

describe('FinalProofSearch scheduler', () => {
  it('resolves a forced death at the cheapest proof tier and stores auditable evidence', async () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const targetIndex = proposal.findIndex((group) => group.points.includes('t'));
    const result = await runFinalProofSearch(context, proposal, {
      budget: { tierNodeBudgets: [300], maxGlobalNodes: 2_000 },
    });

    expect(result.proposal[targetIndex]?.status).toBe('dead');
    expect(result.proposal[targetIndex]?.evidence).toMatchObject({
      algorithm: 'final-proof-search-v2',
      proof: 'proved-dead',
      reader: 'tactical-forced-capture-v1',
      firstPlayerOrders: { attackerFirst: 'proved-kill', defenderFirst: 'proved-kill' },
    });
    expect(result.diagnostics.resolvedAutomatically).toBeGreaterThan(0);
  });

  it('never mutates the authoritative final position, captures, phase, or move metadata', async () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const before = JSON.stringify(state);
    await runFinalProofSearch(context, proposal, { budget: { tierNodeBudgets: [300], maxGlobalNodes: 2_000 } });
    expect(JSON.stringify(state)).toBe(before);
    expect(state.phase).toBe('endgame');
    expect(state.moveNumber).toBe(42);
    expect(state.captures).toEqual({ black: 3, white: 2 });
  });

  it('turns global node exhaustion into unresolved rather than a guessed status', async () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const result = await runFinalProofSearch(context, proposal, {
      budget: { tierNodeBudgets: [300, 1500], maxGlobalNodes: 0 },
    });
    expect(result.proposal.some((group) => group.status === 'unresolved')).toBe(true);
    expect(result.diagnostics.stopReason).toBe('global-node-budget');
  });

  it('reports monotonic progress snapshots without affecting correctness', async () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const snapshots: number[] = [];
    await runFinalProofSearch(context, proposal, {
      budget: { tierNodeBudgets: [50, 300], maxGlobalNodes: 2_000 },
      onProgress: (progress) => snapshots.push(progress.exploredNodes),
    });
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots).toEqual([...snapshots].sort((a, b) => a - b));
  });

  it('counts unresolved groups as completed only after no proof tier can revisit them', async () => {
    const { topology, state } = openFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const snapshots: Array<Readonly<{ tier: string; completed: number; total: number }>> = [];
    const result = await runFinalProofSearch(context, proposal, {
      onProgress: (progress) => snapshots.push(Object.freeze({
        tier: progress.currentTierName,
        completed: progress.groupsCompleted,
        total: progress.groupsTotal,
      })),
    });

    expect(result.proposal.every((group) => group.status === 'unresolved')).toBe(true);
    expect(snapshots.filter((snapshot) => snapshot.tier !== 'finalizing').every((snapshot) => snapshot.completed === 0)).toBe(true);
    const finalizing = snapshots.filter((snapshot) => snapshot.tier === 'finalizing');
    expect(finalizing.length).toBeGreaterThan(0);
    expect(finalizing.at(-1)?.completed).toBe(finalizing.at(-1)?.total);
    expect(result.diagnostics.groupsCompleted).toBe(result.diagnostics.groupsTotal);
  });

  it('applies the hard deadline to graph/preparation work and fails closed before dynamic proofs', async () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    let tick = 0;
    const result = await runFinalProofSearch(context, proposal, {
      budget: {
        softWallClockMilliseconds: 1,
        hardWallClockMilliseconds: 2,
      },
      now: () => tick++,
      yieldControl: async () => Promise.resolve(),
    });

    expect(result.proposal).toEqual(proposal);
    expect(result.diagnostics.stopReason).toBe('hard-time-budget');
    expect(result.diagnostics.deadlineReachedAt).not.toBeNull();
    expect(result.diagnostics.attempts).toBe(0);
    expect(result.diagnostics.resolvedAutomatically).toBe(0);
  });

  it('fails closed when locality covers the whole graph and the target is outside the tactical gate', async () => {
    const { topology, state } = openFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const result = await runFinalProofSearch(context, proposal);
    expect(result.proposal[0]?.status).toBe('unresolved');
    expect(result.diagnostics.outcomes.unresolvedBoundary).toBe(1);
  });

  it('refuses proof search when the supplied group context is incomplete', async () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    expect(context.groups.length).toBeGreaterThan(1);
    const incompleteContext: EndgameAnalysisContext = Object.freeze({
      ...context,
      groups: Object.freeze(context.groups.slice(0, -1)),
    });

    const result = await runFinalProofSearch(incompleteContext, proposal, {
      budget: { tierNodeBudgets: [300], maxGlobalNodes: 2_000 },
    });

    expect(result.proposal).toEqual(proposal);
    expect(result.diagnostics.stopReason).toBe('incomplete-context');
    expect(result.diagnostics.attempts).toBe(0);
    expect(result.diagnostics.exploredNodes).toBe(0);
    expect(result.diagnostics.resolvedAutomatically).toBe(0);
  });
});