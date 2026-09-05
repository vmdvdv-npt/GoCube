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

describe('FinalProofSearch scheduler', () => {
  it('resolves a locally forced death and stores auditable proof evidence', () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const targetIndex = proposal.findIndex((group) => group.points.includes('t'));
    const result = runFinalProofSearch(context, proposal, {
      budget: { tierNodeBudgets: [300], maxGlobalNodes: 2_000 },
    });

    expect(result.proposal[targetIndex]?.status).toBe('dead');
    expect(result.proposal[targetIndex]?.evidence).toMatchObject({
      algorithm: 'final-proof-search-v1',
      proof: 'proved-dead',
      firstPlayerOrders: { attackerFirst: 'proved-dead', defenderFirst: 'proved-dead' },
    });
    expect(result.diagnostics.resolvedAutomatically).toBeGreaterThan(0);
  });

  it('never mutates the authoritative final position, captures, phase, or move metadata', () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const before = JSON.stringify(state);
    runFinalProofSearch(context, proposal, { budget: { tierNodeBudgets: [300], maxGlobalNodes: 2_000 } });
    expect(JSON.stringify(state)).toBe(before);
    expect(state.phase).toBe('endgame');
    expect(state.moveNumber).toBe(42);
    expect(state.captures).toEqual({ black: 3, white: 2 });
  });

  it('turns global node exhaustion into unresolved rather than a guessed status', () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const result = runFinalProofSearch(context, proposal, {
      budget: { tierNodeBudgets: [300, 1500], maxGlobalNodes: 0 },
    });
    expect(result.proposal.some((group) => group.status === 'unresolved')).toBe(true);
    expect(result.diagnostics.stopReason).toBe('global-node-budget');
  });

  it('reports monotonic progress snapshots without affecting correctness', () => {
    const { topology, state } = deadFixture();
    const [context, proposal] = contextAndProposal(topology, state);
    const snapshots: number[] = [];
    runFinalProofSearch(context, proposal, {
      budget: { tierNodeBudgets: [50, 300], maxGlobalNodes: 2_000 },
      onProgress: (progress) => snapshots.push(progress.exploredNodes),
    });
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots).toEqual([...snapshots].sort((a, b) => a - b));
  });

  it('fails closed when locality covers the whole graph', () => {
    const topology = new GraphTopology('final-proof-open', [['t', 'a'], ['a', 'b'], ['b', 'c']]);
    const state = stateFor(topology, { t: 'white' });
    const [context, proposal] = contextAndProposal(topology, state);
    const result = runFinalProofSearch(context, proposal);
    expect(result.proposal[0]?.status).toBe('unresolved');
    expect(result.diagnostics.outcomes.unresolvedBoundary).toBe(1);
  });
});
