import { describe, expect, it } from 'vitest';
import { AssistedEndgameClassifier } from '../AssistedEndgameClassifier';
import type { EndgameClassification, EndgameProposal } from '../EndgameClassifier';
import { buildEndgameGraph } from '../EndgameGraphCore';
import { resolveTerritory } from '../TerritoryResolver';
import type { GameState, PointOccupancy } from '../../game/types';
import { ChineseScoring } from '../../scoring/ChineseScoring';
import { JapaneseScoring } from '../../scoring/JapaneseScoring';
import { CubeTopology } from '../../topology/CubeTopology';
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
  it('preserves two-eye proof/evidence and local scoring contribution across arbitrary relabel, Torus interior/seam, Cube interior/edge/corner', async () => {
    const lab = new EndgameTestLab();

    const torus = new TorusTopology(9);
    const torusInterior = lab.generate({
      kind: 'life-death-pattern',
      topology: torus,
      seed: 'work9-topology-torus-interior',
      pattern: 'two-eyes',
    });
    const torusSeam = lab.generate({
      kind: 'topology-stress',
      topology: torus,
      seed: 'work9-topology-torus-seam',
      mode: 'torus-seam',
      pattern: 'two-eyes',
    });

    const relabeledTorus = new RelabeledTopology(torus);
    const arbitraryState = relabelState(torusInterior.state, relabeledTorus);

    const cube = new CubeTopology(5);
    const cubeInterior = lab.generate({
      kind: 'life-death-pattern',
      topology: cube,
      seed: 'work9-topology-cube-interior',
      pattern: 'two-eyes',
    });
    const cubeEdge = lab.generate({
      kind: 'topology-stress',
      topology: cube,
      seed: 'work9-topology-cube-edge',
      mode: 'cube-edge',
      pattern: 'two-eyes',
    });
    const cubeCorner = lab.generate({
      kind: 'topology-stress',
      topology: cube,
      seed: 'work9-topology-cube-corner',
      mode: 'cube-corner',
      pattern: 'two-eyes',
    });

    const results = await Promise.all([
      assertTwoEyePipeline(arbitraryState, relabeledTorus),
      assertTwoEyePipeline(torusInterior.state, torus),
      assertTwoEyePipeline(torusSeam.state, torus),
      assertTwoEyePipeline(cubeInterior.state, cube),
      assertTwoEyePipeline(cubeEdge.state, cube),
      assertTwoEyePipeline(cubeCorner.state, cube),
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
          conflicts: graph.conflictComponents.length,
          regions: firstResolution.regions.length,
          statuses: Object.freeze({ ...statusCounts }),
        }),
      );
    }

    console.info('WORK9_GENERATED_STRESS', JSON.stringify(diagnostics));
  });
});
