import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { analyzeSmallEyeSpace } from './SmallEyeSpaceAnalyzer';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{
    readonly env?: Readonly<Record<string, string | undefined>>;
  }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_SMALL_EYE_BENCHMARK === '1';
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 20;
const P95_CEILING_MS = 250;
const MAX_CEILING_MS = 1000;

interface BenchmarkCase {
  readonly label: string;
  readonly topology: Topology;
}

interface Fixture {
  readonly state: GameState;
  readonly targetGroupKey: string;
  readonly regionPoints: readonly PointId[];
}

interface AnalysisSnapshot {
  readonly minEyes: number;
  readonly maxEyes: number;
  readonly attackVitalPoints: readonly PointId[];
  readonly defenseVitalPoints: readonly PointId[];
  readonly complete: boolean;
  readonly koDependent: boolean;
  readonly exploredNodes: number;
  readonly maxDepth: number;
  readonly unresolvedReasons: readonly string[];
}

interface Sample {
  readonly runtimeMs: number;
  readonly snapshot: AnalysisSnapshot;
}

const cases: readonly BenchmarkCase[] = Object.freeze([
  Object.freeze({ label: 'torus-9x9', topology: new TorusTopology(9) }),
  Object.freeze({ label: 'torus-13x13', topology: new TorusTopology(13) }),
  Object.freeze({ label: 'torus-19x19', topology: new TorusTopology(19) }),
  Object.freeze({ label: 'cube-2x2', topology: new CubeTopology(2) }),
  Object.freeze({ label: 'cube-4x4', topology: new CubeTopology(4) }),
  Object.freeze({ label: 'cube-5x5', topology: new CubeTopology(5) }),
  Object.freeze({ label: 'cube-7x7', topology: new CubeTopology(7) }),
]);

const makeState = (
  topology: Topology,
  emptyPoints: ReadonlySet<PointId>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) {
    board[point] = emptyPoints.has(point) ? 'empty' : 'black';
  }
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 120,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const makeFixture = (topology: Topology): Fixture => {
  const points = [...topology.points()].sort();
  for (const first of points) {
    for (const second of [...new Set(topology.neighbors(first))].sort()) {
      if (second === first) continue;
      const regionPoints = Object.freeze([first, second].sort());
      const state = makeState(topology, new Set(regionPoints));
      const graph = buildEndgameGraph(state, topology);
      const region = graph.emptyRegions.find((candidate) =>
        candidate.points.includes(first),
      );
      if (
        !region ||
        region.points.length !== 2 ||
        region.boundaryGroups.length !== 1
      ) {
        continue;
      }

      const targetGroupKey = region.boundaryGroups[0]!;
      const target = graph.groups.get(targetGroupKey);
      if (!target || target.color !== 'black') continue;

      return Object.freeze({
        state,
        targetGroupKey,
        regionPoints,
      });
    }
  }

  throw new Error(`Could not build strict two-point eye fixture for ${topology.id}`);
};

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

const summary = (samples: readonly Sample[]) => {
  const runtimes = samples
    .map((sample) => sample.runtimeMs)
    .sort((left, right) => left - right);
  return Object.freeze({
    medianRuntimeMs: round(percentile(runtimes, 0.5)),
    p95RuntimeMs: round(percentile(runtimes, 0.95)),
    maxRuntimeMs: round(runtimes[runtimes.length - 1] ?? 0),
  });
};

const snapshotAnalysis = (
  topology: Topology,
  fixture: Fixture,
): AnalysisSnapshot => {
  const result = analyzeSmallEyeSpace(
    fixture.state,
    topology,
    fixture.targetGroupKey,
  );
  if (!result) throw new Error('Expected eye-space analysis');

  return Object.freeze({
    minEyes: result.minEyes,
    maxEyes: result.maxEyes,
    attackVitalPoints: result.attackVitalPoints,
    defenseVitalPoints: result.defenseVitalPoints,
    complete: result.complete,
    koDependent: result.koDependent,
    exploredNodes: result.exploredNodes,
    maxDepth: result.maxDepth,
    unresolvedReasons: result.unresolvedReasons,
  });
};

const measure = (read: () => AnalysisSnapshot): Sample => {
  const started = performance.now();
  const snapshot = read();
  return Object.freeze({
    runtimeMs: performance.now() - started,
    snapshot,
  });
};

const assertDeterminism = (samples: readonly Sample[]): AnalysisSnapshot => {
  const baseline = samples[0]!.snapshot;
  for (const sample of samples) {
    expect(sample.snapshot).toEqual(baseline);
  }
  return baseline;
};

const runCase = (benchmarkCase: BenchmarkCase): void => {
  const fixture = makeFixture(benchmarkCase.topology);
  const read = (): AnalysisSnapshot =>
    snapshotAnalysis(benchmarkCase.topology, fixture);

  for (let index = 0; index < WARMUP_RUNS; index += 1) read();

  const samples: Sample[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    samples.push(measure(read));
  }

  const baseline = assertDeterminism(samples);
  const runtime = summary(samples);

  expect(baseline.complete).toBe(true);
  expect(baseline.koDependent).toBe(false);
  expect(baseline.unresolvedReasons).toEqual([]);
  expect(baseline.exploredNodes).toBeGreaterThan(0);
  expect(runtime.p95RuntimeMs).toBeLessThanOrEqual(P95_CEILING_MS);
  expect(runtime.maxRuntimeMs).toBeLessThanOrEqual(MAX_CEILING_MS);

  console.log(
    `ENGINE2_SMALL_EYE_BENCHMARK_RESULT ${JSON.stringify({
      case: benchmarkCase.label,
      logicalPoints: benchmarkCase.topology.points().length,
      regionPoints: fixture.regionPoints.length,
      minEyes: baseline.minEyes,
      maxEyes: baseline.maxEyes,
      attackVitalPoints: baseline.attackVitalPoints,
      defenseVitalPoints: baseline.defenseVitalPoints,
      exploredNodes: baseline.exploredNodes,
      maxDepth: baseline.maxDepth,
      ...runtime,
      p95RuntimeCeilingMs: P95_CEILING_MS,
      maxRuntimeCeilingMs: MAX_CEILING_MS,
      samples: SAMPLE_RUNS,
    })}`,
  );
};

const benchmarkDescribe = BENCHMARK_ENABLED ? describe : describe.skip;

benchmarkDescribe('SmallEyeSpaceAnalyzer E2-7 performance gate', () => {
  for (const benchmarkCase of cases) {
    it(
      benchmarkCase.label,
      { timeout: 60_000 },
      () => runCase(benchmarkCase),
    );
  }
});
