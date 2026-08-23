import { describe, expect, it } from 'vitest';
import { AssistedEndgameClassifier } from '../AssistedEndgameClassifier';
import type { EndgameClassification, EndgameProposal } from '../EndgameClassifier';
import { buildEndgameGraph } from '../EndgameGraphCore';
import { resolveTerritory } from '../TerritoryResolver';
import type { GameState, PointOccupancy } from '../../game/types';
import { ChineseScoring } from '../../scoring/ChineseScoring';
import { JapaneseScoring } from '../../scoring/JapaneseScoring';
import { cubePointId, CubeTopology } from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import { EndgameTestLab, type EndgameTestTopology } from './EndgameTestLab';

class RelabeledTopology implements Topology {
  readonly id: string;
  private readonly pointsBySource: ReadonlyMap<PointId, PointId>;
  private readonly sourceByPoint: ReadonlyMap<PointId, PointId>;
  private readonly relabeledPoints: readonly PointId[];

  constructor(private readonly source: Topology) {
    this.id = `work9-arbitrary-relabel:${source.id}`;
    const sourcePoints = [...source.points()].sort();
    this.pointsBySource = new Map(
      sourcePoints.map((point, index) => [point, `arbitrary-${String(index).padStart(4, '0')}`] as const),
    );
    this.sourceByPoint = new Map(
      [...this.pointsBySource].map(([original, relabeled]) => [relabeled, original] as const),
    );
    this.relabeledPoints = Object.freeze([...this.sourceByPoint.keys()].sort());
  }

  pointForSource(point: PointId): PointId {
    const relabeled = this.pointsBySource.get(point);
    if (!relabeled) throw new Error(`Unknown source point: ${point}`);
    return relabeled;
  }

  points(): readonly PointId[] {
    return this.relabeledPoints;
  }

  has(point: PointId): boolean {
    return this.sourceByPoint.has(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    const sourcePoint = this.sourceByPoint.get(point);
    if (!sourcePoint) throw new Error(`Unknown relabeled point: ${point}`);
    return Object.freeze(
      this.source
        .neighbors(sourcePoint)
        .map((neighbor) => this.pointForSource(neighbor))
        .sort(),
    );
  }
}

const relabelState = (state: GameState, topology: RelabeledTopology): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const sourcePoint of Object.keys(state.board)) {
    board[topology.pointForSource(sourcePoint)] = state.board[sourcePoint]!;
  }
  return Object.freeze({
    ...state,
    board: Object.freeze(board),
    captures: Object.freeze({ ...state.captures }),
  });
};

const makeState = (
  topology: Topology,
  stones: Readonly<Partial<Record<PointId, PointOccupancy>>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const twoEyeState = (
  topology: Topology,
  pointAt: (row: number, column: number) => PointId,
): GameState => {
  const stones: Record<PointId, PointOccupancy> = {};
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const isEye = row === 1 && (column === 1 || column === 3);
      if (!isEye) stones[pointAt(row, column)] = 'black';
    }
  }
  return makeState(topology, stones);
};

const analyze = async (state: GameState, topology: Topology): Promise<EndgameProposal> => {
  const graph = buildEndgameGraph(state.board, topology);
  return new AssistedEndgameClassifier().analyze(
    Object.freeze({
      state,
      topology,
      groups: Object.freeze(graph.strings.map((group) => group.points)),
    }),
  );
};

const resolvedClassification = (proposal: EndgameProposal): EndgameClassification =>
  Object.freeze(
    proposal.map((group) => {
      if (group.status === 'unresolved') {
        throw new Error(`Expected fully resolved Work 9 topology fixture, got ${group.points.join(',')}`);
      }
      return Object.freeze({
        points: group.points,
        status: group.status,
        source: 'automatic' as const,
      });
    }),
  );

const proofSignature = (proposal: EndgameProposal) =>
  Object.freeze(
    proposal.map((group) =>
      Object.freeze({
        status: group.status,
        source: group.source ?? null,
        algorithm:
          typeof group.evidence?.algorithm === 'string' ? group.evidence.algorithm : null,
      }),
    ),
  );

const assertTwoEyePipeline = async (
  state: GameState,
  topology: Topology,
): Promise<Readonly<{ signature: ReturnType<typeof proofSignature>; localEyeTerritory: number }>> => {
  const proposal = await analyze(state, topology);
  expect(proposal).toHaveLength(1);
  expect(proposal[0]).toMatchObject({ status: 'alive', source: 'automatic' });
  expect(proposal[0]?.evidence?.algorithm).toBe('benson-pass-alive-v1');

  const classification = resolvedClassification(proposal);
  const resolution = resolveTerritory(state, classification, topology);
  const localEyeTerritory = resolution.regions.filter(
    (region) => region.owner === 'BLACK' && region.points.length === 1,
  ).length;
  expect(localEyeTerritory).toBe(2);

  const chinese = new ChineseScoring(topology).score(state, classification, 0);
  const japanese = new JapaneseScoring(topology).score(state, classification, 0);
  expect(chinese.territory).toEqual(japanese.territory);

  return Object.freeze({ signature: proofSignature(proposal), localEyeTerritory });
};

const occupiedCount = (state: GameState): number =>
  Object.values(state.board).filter((occupancy) => occupancy !== 'empty').length;

describe('Work 9 topology metamorphic and generated stress acceptance', () => {
  it('preserves proof/evidence/scoring across exact arbitrary, Torus seam and Cube edge graph-isomorphic embeddings', async () => {
    const torus = new TorusTopology(9);
    const torusInterior = twoEyeState(torus, (row, column) => `${column + 2},${row + 2}`);
    const torusSeamColumns = [7, 8, 0, 1, 2] as const;
    const torusSeam = twoEyeState(
      torus,
      (row, column) => `${torusSeamColumns[column]},${row + 2}`,
    );

    const relabeledTorus = new RelabeledTopology(torus);
    const arbitraryState = relabelState(torusInterior, relabeledTorus);

    const cube = new CubeTopology(7);
    const cubeInterior = twoEyeState(cube, (row, column) =>
      cubePointId('front', row + 2, column + 1),
    );
    const cubeEdge = twoEyeState(cube, (row, column) =>
      column <= 2
        ? cubePointId('front', row + 2, column + 4)
        : cubePointId('right', row + 2, column - 3),
    );

    const results = await Promise.all([
      assertTwoEyePipeline(arbitraryState, relabeledTorus),
      assertTwoEyePipeline(torusInterior, torus),
      assertTwoEyePipeline(torusSeam, torus),
      assertTwoEyePipeline(cubeInterior, cube),
      assertTwoEyePipeline(cubeEdge, cube),
    ]);

    for (const result of results) {
      expect(result.signature).toEqual([
        Object.freeze({
          status: 'alive',
          source: 'automatic',
          algorithm: 'benson-pass-alive-v1',
        }),
      ]);
      expect(result.localEyeTerritory).toBe(2);
    }
  });

  it('keeps Cube physical-corner stress conservative because the local surface graph is not planar-rectangular isomorphic', async () => {
    const lab = new EndgameTestLab();
    const cube = new CubeTopology(5);
    const cornerShared = lab.generate({
      kind: 'topology-stress',
      topology: cube,
      seed: 'work9-topology-cube-corner-shared',
      mode: 'cube-corner',
      pattern: 'shared-liberties',
    });

    const proposal = await lab.analyze(cornerShared, new AssistedEndgameClassifier());
    expect(proposal.length).toBeGreaterThan(0);
    expect(proposal.every((group) => group.status === 'unresolved')).toBe(true);
  });

  it('stress-runs deterministic legal near-endgame positions across multiple Torus/Cube sizes without using generator output as truth', async () => {
    const lab = new EndgameTestLab();
    const classifier = new AssistedEndgameClassifier();
    const requests: readonly Readonly<{
      topology: EndgameTestTopology;
      seed: string;
      maxMoves: number;
    }>[] = Object.freeze([
      Object.freeze({ topology: new TorusTopology(9), seed: 'work9-generated-torus9', maxMoves: 52 }),
      Object.freeze({ topology: new TorusTopology(13), seed: 'work9-generated-torus13', maxMoves: 96 }),
      Object.freeze({ topology: new CubeTopology(4), seed: 'work9-generated-cube4', maxMoves: 60 }),
      Object.freeze({ topology: new CubeTopology(5), seed: 'work9-generated-cube5', maxMoves: 90 }),
    ]);

    const diagnostics = [];
    for (const request of requests) {
      const first = lab.generate({ kind: 'endgame-position', ...request });
      const second = lab.generate({ kind: 'endgame-position', ...request });
      expect(second).toEqual(first);
      expect(first.state.phase).toBe('endgame');
      expect(first.state.consecutivePasses).toBe(2);
      expect(occupiedCount(first.state)).toBeGreaterThan(10);

      const graph = buildEndgameGraph(first.state.board, request.topology);
      expect(graph.strings.length).toBeGreaterThan(1);
      expect(graph.opponentAdjacencies.length).toBeGreaterThan(0);
      expect(graph.conflictComponents.length).toBeGreaterThan(0);

      const firstProposal = await lab.analyze(first, classifier);
      const secondProposal = await lab.analyze(second, classifier);
      expect(proofSignature(secondProposal)).toEqual(proofSignature(firstProposal));

      const firstResolution = resolveTerritory(first.state, Object.freeze([]), request.topology);
      const secondResolution = resolveTerritory(second.state, Object.freeze([]), request.topology);
      expect(secondResolution).toEqual(firstResolution);
      expect(firstResolution.regions.length).toBeGreaterThan(0);

      const statusCounts = firstProposal.reduce<Record<string, number>>((counts, group) => {
        counts[group.status] = (counts[group.status] ?? 0) + 1;
        return counts;
      }, {});
      diagnostics.push(
        Object.freeze({
          topology: request.topology.id,
          seed: request.seed,
          occupied: occupiedCount(first.state),
          strings: graph.strings.length,
          opponentAdjacencies: graph.opponentAdjacencies.length,
          conflicts: graph.conflictComponents.length,
          regions: firstResolution.regions.length,
          statuses: Object.freeze({ ...statusCounts }),
        }),
      );
    }

    console.info('WORK9_GENERATED_STRESS', JSON.stringify(diagnostics));
  });
});
