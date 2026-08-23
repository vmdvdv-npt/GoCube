import { describe, expect, it } from 'vitest';
import { AUTOMATIC_SEKI_ALGORITHM } from './AutomaticSekiProof';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import type { EndgameAnalysisContext, EndgameProposal } from './EndgameClassifier';
import { buildEndgameGraph } from './EndgameGraphCore';
import { BASIC_SEKI_ALGORITHM, analyzeBasicSeki } from './SekiSearch';
import { analyzeSimpleSemeai } from './SemeaiCore';
import { BOUNDED_SEMEAI_ALGORITHM, analyzeBoundedSemeai } from './SemeaiSearch';
import { TACTICAL_READER_ALGORITHM } from './TacticalReader';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

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

class GridTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];
  private readonly pointSet: ReadonlySet<PointId>;

  constructor(readonly size: number) {
    this.id = `work7d-grid-${String(size)}`;
    this.allPoints = Object.freeze(
      Array.from({ length: size * size }, (_, index) => {
        const row = Math.floor(index / size);
        const column = index % size;
        return GridTopology.point(row, column);
      }),
    );
    this.pointSet = new Set(this.allPoints);
  }

  static point(row: number, column: number): PointId {
    return `${column},${row}`;
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  neighbors(point: PointId): readonly PointId[] {
    if (!this.has(point)) throw new Error(`Unknown grid point: ${point}`);
    const [columnText, rowText] = point.split(',');
    const row = Number(rowText);
    const column = Number(columnText);
    return Object.freeze(
      [
        [row - 1, column],
        [row, column + 1],
        [row + 1, column],
        [row, column - 1],
      ]
        .filter(
          ([nextRow, nextColumn]) =>
            nextRow >= 0 &&
            nextRow < this.size &&
            nextColumn >= 0 &&
            nextColumn < this.size,
        )
        .map(([nextRow, nextColumn]) => GridTopology.point(nextRow, nextColumn)),
    );
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
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

const contextFor = (state: GameState, topology: Topology): EndgameAnalysisContext => {
  const graph = buildEndgameGraph(state.board, topology);
  return Object.freeze({
    state,
    topology,
    groups: Object.freeze(graph.strings.map((group) => group.points)),
  });
};

const analyze = async (state: GameState, topology: Topology): Promise<EndgameProposal> =>
  new AssistedEndgameClassifier().analyze(contextFor(state, topology));

const proposalAt = (proposal: EndgameProposal, point: PointId): EndgameProposal[number] => {
  const result = proposal.find((candidate) => candidate.points.includes(point));
  if (!result) throw new Error(`No proposal at ${point}`);
  return result;
};

const simpleSemeaiFixture = (
  leftLiberties: number,
  rightLiberties: number,
  id = `work7d-simple-${String(leftLiberties)}-${String(rightLiberties)}`,
): Readonly<{ topology: Topology; state: GameState }> => {
  const edges: Array<readonly [PointId, PointId]> = [['L', 'R']];
  for (let index = 1; index <= leftLiberties; index += 1) {
    edges.push(['L', `l${index}`], [`l${index}`, `le${index}`]);
  }
  for (let index = 1; index <= rightLiberties; index += 1) {
    edges.push(['R', `r${index}`], [`r${index}`, `re${index}`]);
  }
  const topology = new GraphTopology(id, edges);
  return Object.freeze({ topology, state: makeState(topology, { L: 'black', R: 'white' }) });
};

const sharedStableFixture = (
  id = 'work7d-shared-stable-left',
  farStone = false,
): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology(id, [
    ['L', 'R'],
    ['L', 's'],
    ['R', 's'],
    ['s', 'B'],
    ['B', 'b'],
    ['L', 'l'],
    ['l', 'W'],
    ['W', 'w'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({
    topology,
    state: makeState(topology, {
      L: 'black',
      R: 'white',
      B: 'black',
      W: 'white',
      ...(farStone ? { OUT1: 'black' as const } : {}),
    }),
  });
};

const sharedOnlyFixture = (
  id = 'work7d-shared-only-two',
): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology(id, [
    ['L', 's1'],
    ['R', 's1'],
    ['L', 's2'],
    ['R', 's2'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({ topology, state: makeState(topology, { L: 'black', R: 'white' }) });
};

const koSemeaiFixture = (): Readonly<{ topology: Topology; state: GameState }> => {
  const topology = new GraphTopology('work7d-ko-semeai', [
    ['L', 'R'],
    ['L', 'l1'],
    ['l1', 'le1'],
    ['L', 'l2'],
    ['l2', 'le2'],
    ['R', 'c'],
    ['OUT1', 'OUT2'],
  ]);
  return Object.freeze({ topology, state: makeState(topology, { L: 'black', R: 'white' }) });
};

describe('Engine Work 7D classifier integration', () => {
  it('closes the immediate one-stone tactical gap only with both first-player proofs', async () => {
    const topology = new GridTopology(3);
    const state = makeState(topology, {
      '0,0': 'white',
      '0,1': 'black',
      '1,1': 'black',
      '2,0': 'black',
    });

    const target = proposalAt(await analyze(state, topology), '0,0');
    expect(target.status).toBe('dead');
    expect(target.source).toBe('automatic');
    expect(target.evidence?.algorithm).toBe(TACTICAL_READER_ALGORITHM);
    expect(target.evidence?.proof).toBe('forced-capture-both-first-player-orders');
    expect((target.evidence?.attackerFirst as { outcome?: string })?.outcome).toBe('proved-kill');
    expect((target.evidence?.defenderFirst as { outcome?: string })?.outcome).toBe('proved-kill');
  });

  it('uses simple-semeai-v1 provenance for a stable loser and never promotes its winner alive', async () => {
    const { topology, state } = simpleSemeaiFixture(2, 1);
    const proposal = await analyze(state, topology);
    const left = proposalAt(proposal, 'L');
    const right = proposalAt(proposal, 'R');

    expect(right.status).toBe('dead');
    expect(right.evidence?.algorithm).toBe('simple-semeai-v1');
    expect(right.evidence?.proof).toBe('stable-winner-both-first-player-orders');
    expect(left.status).toBe('unresolved');
  });

  it('handles the symmetric stable simple race', async () => {
    const { topology, state } = simpleSemeaiFixture(1, 2, 'work7d-simple-right');
    const proposal = await analyze(state, topology);
    expect(proposalAt(proposal, 'L').status).toBe('dead');
    expect(proposalAt(proposal, 'R').status).toBe('unresolved');
  });

  it('keeps first-player-dependent simple semeai unresolved', async () => {
    const { topology, state } = simpleSemeaiFixture(1, 1, 'work7d-simple-first-player');
    const graph = buildEndgameGraph(state.board, topology);
    const result = analyzeSimpleSemeai(
      graph.stringsByKey.get('["L"]')!,
      graph.stringsByKey.get('["R"]')!,
      state,
      topology,
    );
    expect(result.outcome).toBe('first-player-dependent');

    const proposal = await analyze(state, topology);
    expect(proposalAt(proposal, 'L').status).toBe('unresolved');
    expect(proposalAt(proposal, 'R').status).toBe('unresolved');
  });

  it('uses bounded-semeai-v1 for the shared-liberty stable loser within classifier budget', async () => {
    const { topology, state } = sharedStableFixture();
    const target = proposalAt(await analyze(state, topology), 'R');

    expect(target.status).toBe('dead');
    expect(target.evidence?.algorithm).toBe(BOUNDED_SEMEAI_ALGORITHM);
    expect(target.evidence?.proof).toBe('stable-winner-both-first-player-orders');
    expect((target.evidence?.leftFirst as { outcome?: string })?.outcome).toBe('left-wins');
    expect((target.evidence?.rightFirst as { outcome?: string })?.outcome).toBe('left-wins');
    expect(Number(target.evidence?.exploredNodes)).toBeLessThan(128);
  });

  it('keeps bounded budget and boundary failures non-promoting', () => {
    const shared = sharedStableFixture('work7d-bounded-budget');
    const graph = buildEndgameGraph(shared.state.board, shared.topology);
    const budget = analyzeBoundedSemeai(
      graph.stringsByKey.get('["L"]')!,
      graph.stringsByKey.get('["R"]')!,
      shared.state,
      shared.topology,
      { maxNodes: 0, maxZonePoints: 24 },
    );
    expect(budget.outcome).toBe('unresolved');
    expect(budget.leftFirst.outcome).toBe('unknown-budget');
    expect(budget.rightFirst.outcome).toBe('unknown-budget');

    const topology = new GraphTopology('work7d-bounded-open', [
      ['L', 'R'],
      ['L', 's'],
      ['R', 's'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const openGraph = buildEndgameGraph(state.board, topology);
    const boundary = analyzeBoundedSemeai(
      openGraph.stringsByKey.get('["L"]')!,
      openGraph.stringsByKey.get('["R"]')!,
      state,
      topology,
      { maxNodes: 64, maxZonePoints: 24 },
    );
    expect(boundary.outcome).toBe('unresolved');
    expect(boundary.reason).toBe('unknown-boundary');
  });

  it('keeps a restoring-ko race unresolved in the classifier', async () => {
    const { topology, state } = koSemeaiFixture();
    const proposal = await analyze(state, topology);
    expect(proposalAt(proposal, 'L').status).toBe('unresolved');
    expect(proposalAt(proposal, 'R').status).toBe('unresolved');
  });

  it('preserves legacy seki precedence while the same strict shape remains provable by basic-seki-v1', async () => {
    const { topology, state } = sharedOnlyFixture('work7d-basic-and-legacy-seki');
    const graph = buildEndgameGraph(state.board, topology);
    const proof = analyzeBasicSeki(
      graph.stringsByKey.get('["L"]')!,
      graph.stringsByKey.get('["R"]')!,
      state,
      topology,
      { maxNodes: 64, maxZonePoints: 24 },
    );
    expect(proof.algorithm).toBe(BASIC_SEKI_ALGORITHM);
    expect(proof.outcome).toBe('seki');
    expect(proof.proof).toBe('every-legal-local-initiation-is-losing');

    const proposal = await analyze(state, topology);
    expect(proposalAt(proposal, 'L').status).toBe('seki');
    expect(proposalAt(proposal, 'R').status).toBe('seki');
    expect(proposalAt(proposal, 'L').evidence?.algorithm).toBe(AUTOMATIC_SEKI_ALGORITHM);
  });

  it('does not infer seki from a single shared-liberty first-move race', async () => {
    const topology = new GraphTopology('work7d-not-seki', [
      ['L', 's'],
      ['R', 's'],
      ['OUT1', 'OUT2'],
    ]);
    const state = makeState(topology, { L: 'black', R: 'white' });
    const proposal = await analyze(state, topology);
    expect(proposalAt(proposal, 'L').status).not.toBe('seki');
    expect(proposalAt(proposal, 'R').status).not.toBe('seki');
  });

  it('keeps bounded proof and evidence deterministic under a far-away disconnected mutation', async () => {
    const base = sharedStableFixture('work7d-rz-base');
    const mutated = sharedStableFixture('work7d-rz-mutated', true);
    const baseTarget = proposalAt(await analyze(base.state, base.topology), 'R');
    const mutatedTarget = proposalAt(await analyze(mutated.state, mutated.topology), 'R');

    expect(baseTarget.status).toBe('dead');
    expect(mutatedTarget.status).toBe('dead');
    expect(mutatedTarget.evidence?.algorithm).toBe(baseTarget.evidence?.algorithm);
    expect(mutatedTarget.evidence?.proof).toBe(baseTarget.evidence?.proof);
    expect(mutatedTarget.evidence?.zonePoints).toEqual(baseTarget.evidence?.zonePoints);
    expect(mutatedTarget.evidence?.leftFirst).toEqual(baseTarget.evidence?.leftFirst);
    expect(mutatedTarget.evidence?.rightFirst).toEqual(baseTarget.evidence?.rightFirst);
    expect(mutatedTarget.evidence?.exploredNodes).toBe(baseTarget.evidence?.exploredNodes);
    expect(mutatedTarget.evidence?.transpositionHits).toBe(baseTarget.evidence?.transpositionHits);
  });

  it('is exact deterministic across repeated classifier runs and never mutates the authoritative board', async () => {
    const { topology, state } = sharedStableFixture('work7d-repeatability');
    const before = state.board;
    const snapshot = JSON.stringify(state.board);
    const first = await analyze(state, topology);
    const second = await analyze(state, topology);
    expect(second).toEqual(first);
    expect(state.board).toBe(before);
    expect(JSON.stringify(state.board)).toBe(snapshot);
  });

  it('preserves simple-semeai classification under arbitrary graph relabeling', async () => {
    const original = simpleSemeaiFixture(2, 1, 'work7d-relabel-a');
    const renamedTopology = new GraphTopology('work7d-relabel-b', [
      ['black-target', 'white-target'],
      ['black-target', 'a'],
      ['a', 'a-out'],
      ['black-target', 'b'],
      ['b', 'b-out'],
      ['white-target', 'c'],
      ['c', 'c-out'],
    ]);
    const renamedState = makeState(renamedTopology, {
      'black-target': 'black',
      'white-target': 'white',
    });

    const first = proposalAt(await analyze(original.state, original.topology), 'R');
    const second = proposalAt(await analyze(renamedState, renamedTopology), 'white-target');
    expect(first.status).toBe('dead');
    expect(second.status).toBe('dead');
    expect(second.evidence?.algorithm).toBe(first.evidence?.algorithm);
    expect(second.evidence?.proof).toBe(first.evidence?.proof);
  });
});
