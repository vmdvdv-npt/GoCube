import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology, cubePointId, type CubeFace } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { classifyGroupConfidence, classifyPositionConfidence } from './EndgameConfidenceClassifier';
import { buildEndgameGraph } from './EndgameGraphCore';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{ readonly env?: Readonly<Record<string, string | undefined>> }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_CONFIDENCE_BENCHMARK === '1';
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 20;
const PER_GROUP_P95_CEILING_MS = 50;
const POSITION_P95_CEILING_MS = 100;
const PER_GROUP_MAX_CEILING_MS = 200;
const POSITION_MAX_CEILING_MS = 400;

interface BenchmarkCase {
  readonly label: string;
  readonly topology: Topology;
  readonly state: GameState;
  readonly targetPoint: PointId;
}

interface RuntimeSummary {
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

const makeState = (
  topology: Topology,
  occupied: Readonly<Record<PointId, Exclude<PointOccupancy, 'empty'>>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupied[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 200,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const sparseTorus = (): BenchmarkCase => {
  const topology = new TorusTopology(19);
  return Object.freeze({
    label: 'sparse-torus-19x19',
    topology,
    state: makeState(topology, Object.freeze({
      '9,9': 'white', '10,9': 'white', '0,0': 'black', '1,0': 'black',
    })),
    targetPoint: '9,9',
  });
};

const mediumTorus = (): BenchmarkCase => {
  const topology = new TorusTopology(19);
  const occupied: Record<PointId, 'black' | 'white'> = {};
  const coordinates = [1, 5, 9, 13, 17];
  for (let yi = 0; yi < coordinates.length; yi += 1) {
    for (let xi = 0; xi < coordinates.length; xi += 1) {
      const x = coordinates[xi]!;
      const y = coordinates[yi]!;
      occupied[`${x},${y}`] = (xi + yi) % 2 === 0 ? 'black' : 'white';
    }
  }
  return Object.freeze({
    label: 'medium-density-torus-19x19',
    topology,
    state: makeState(topology, Object.freeze(occupied)),
    targetPoint: '9,9',
  });
};

const representativeCube = (): BenchmarkCase => {
  const topology = new CubeTopology(5);
  const occupied: Record<PointId, 'black' | 'white'> = {};
  const faces: readonly CubeFace[] = Object.freeze(['front', 'back', 'left', 'right', 'top', 'bottom']);
  faces.forEach((face, index) => {
    occupied[cubePointId(face, 2, 2)] = index % 2 === 0 ? 'black' : 'white';
  });
  return Object.freeze({
    label: 'representative-cube-5x5',
    topology,
    state: makeState(topology, Object.freeze(occupied)),
    targetPoint: cubePointId('front', 2, 2),
  });
};

const manyGroupsTorus = (): BenchmarkCase => {
  const topology = new TorusTopology(19);
  const occupied: Record<PointId, 'black' | 'white'> = {};
  const coordinates = [1, 4, 7, 10, 13, 16];
  for (let yi = 0; yi < coordinates.length; yi += 1) {
    for (let xi = 0; xi < coordinates.length; xi += 1) {
      const x = coordinates[xi]!;
      const y = coordinates[yi]!;
      occupied[`${x},${y}`] = (xi + yi) % 2 === 0 ? 'white' : 'black';
    }
  }
  return Object.freeze({
    label: 'multi-group-torus-19x19',
    topology,
    state: makeState(topology, Object.freeze(occupied)),
    targetPoint: '10,10',
  });
};

const cases = Object.freeze([
  sparseTorus(),
  mediumTorus(),
  representativeCube(),
  manyGroupsTorus(),
]);

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
};
const round = (value: number): number => Math.round(value * 1000) / 1000;
const summarize = (values: readonly number[]): RuntimeSummary => {
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    medianMs: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
  });
};
const measure = (run: () => unknown): number => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

const runBenchmarkCase = (benchmarkCase: BenchmarkCase) => {
  const graph = buildEndgameGraph(benchmarkCase.state, benchmarkCase.topology);
  const groupKey = graph.pointOwner.get(benchmarkCase.targetPoint);
  if (!groupKey) throw new Error(`Benchmark target missing: ${benchmarkCase.label}`);
  const perGroup = () => classifyGroupConfidence(benchmarkCase.state, benchmarkCase.topology, groupKey);
  const position = () => classifyPositionConfidence(benchmarkCase.state, benchmarkCase.topology);

  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    perGroup();
    position();
  }

  const perGroupSamples: number[] = [];
  const positionSamples: number[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    perGroupSamples.push(measure(perGroup));
    positionSamples.push(measure(position));
  }
  const perGroupSummary = summarize(perGroupSamples);
  const positionSummary = summarize(positionSamples);
  const positionResult = position();
  const targetResult = perGroup();

  console.info('[E2-12b confidence benchmark]', JSON.stringify({
    label: benchmarkCase.label,
    groupCount: positionResult.results.length,
    perGroup: perGroupSummary,
    wholePosition: positionSummary,
    targetLabel: targetResult?.label ?? 'missing',
    targetScores: targetResult?.scores ?? null,
    deepProofSearchInvocations: positionResult.diagnostics.deepProofSearchInvocations,
  }));

  expect(targetResult).not.toBeNull();
  expect(positionResult.diagnostics.deepProofSearchInvocations).toBe(0);
  expect(perGroupSummary.p95Ms).toBeLessThan(PER_GROUP_P95_CEILING_MS);
  expect(perGroupSummary.maxMs).toBeLessThan(PER_GROUP_MAX_CEILING_MS);
  expect(positionSummary.p95Ms).toBeLessThan(POSITION_P95_CEILING_MS);
  expect(positionSummary.maxMs).toBeLessThan(POSITION_MAX_CEILING_MS);
};

(BENCHMARK_ENABLED ? describe : describe.skip)('E2-12b confidence classifier benchmark', () => {
  for (const benchmarkCase of cases) {
    it(benchmarkCase.label, () => runBenchmarkCase(benchmarkCase));
  }
});
