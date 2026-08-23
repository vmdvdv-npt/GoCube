import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { createEndgameProofSearchNode } from './EndgameProofSearchGoAdapter';
import { analyzeTacticalExtensionMoves } from './TacticalExtensionProofSearchGoAdapter';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{
    readonly env?: Readonly<Record<string, string | undefined>>;
  }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_TACTICAL_BENCHMARK === '1';
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 20;
const P95_CEILING_MS = 250;
const MAX_CEILING_MS = 1000;
const EMPTY_POINT_COUNT = 8;

interface BenchmarkCase {
  readonly label: string;
  readonly topology: Topology;
}

interface AnalysisSnapshot {
  readonly candidates: number;
  readonly koDependentPoints: number;
  readonly examinedEmptyPoints: number;
  readonly reasonCounts: Readonly<Record<string, number>>;
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

const makeFixture = (topology: Topology) => {
  const points = [...topology.points()].sort();
  const emptyPoints = Object.freeze(points.slice(0, EMPTY_POINT_COUNT));
  const emptySet = new Set(emptyPoints);
  const targetPoint = points.find((point) => !emptySet.has(point));
  if (!targetPoint) throw new Error(`No occupied target point for ${topology.id}`);

  const state = makeState(topology, emptySet);
  const node = createEndgameProofSearchNode(
    topology,
    state,
    'black',
    Object.freeze([targetPoint]),
    'defender',
  );
  return Object.freeze({ state, node, emptyPoints });
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
  node: ReturnType<typeof createEndgameProofSearchNode>,
): AnalysisSnapshot => {
  const analysis = analyzeTacticalExtensionMoves(node, topology);
  const reasonCounts: Record<string, number> = {};
  for (const candidate of analysis.candidates) {
    for (const reason of candidate.reasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
  }
  return Object.freeze({
    candidates: analysis.candidates.length,
    koDependentPoints: analysis.koDependentPoints.length,
    examinedEmptyPoints: analysis.examinedEmptyPoints,
    reasonCounts: Object.freeze(reasonCounts),
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

const runCase = (benchmarkCase: BenchmarkCase): void => {
  const fixture = makeFixture(benchmarkCase.topology);
  const read = (): AnalysisSnapshot =>
    snapshotAnalysis(benchmarkCase.topology, fixture.node);

  for (let index = 0; index < WARMUP_RUNS; index += 1) read();

  const samples: Sample[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    samples.push(measure(read));
  }

  const baseline = samples[0]!.snapshot;
  for (const sample of samples) expect(sample.snapshot).toEqual(baseline);
  const runtime = summary(samples);

  expect(baseline.examinedEmptyPoints).toBe(fixture.emptyPoints.length);
  expect(baseline.koDependentPoints).toBe(0);
  expect(baseline.candidates).toBeGreaterThan(0);
  expect(runtime.p95RuntimeMs).toBeLessThanOrEqual(P95_CEILING_MS);
  expect(runtime.maxRuntimeMs).toBeLessThanOrEqual(MAX_CEILING_MS);

  console.log(
    `ENGINE2_TACTICAL_BENCHMARK_RESULT ${JSON.stringify({
      case: benchmarkCase.label,
      logicalPoints: benchmarkCase.topology.points().length,
      examinedEmptyPoints: baseline.examinedEmptyPoints,
      candidates: baseline.candidates,
      koDependentPoints: baseline.koDependentPoints,
      reasonCounts: baseline.reasonCounts,
      ...runtime,
      p95RuntimeCeilingMs: P95_CEILING_MS,
      maxRuntimeCeilingMs: MAX_CEILING_MS,
      samples: SAMPLE_RUNS,
    })}`,
  );
};

const benchmarkDescribe = BENCHMARK_ENABLED ? describe : describe.skip;

benchmarkDescribe('TacticalExtensionProofSearchGoAdapter E2-8 performance gate', () => {
  for (const benchmarkCase of cases) {
    it(
      benchmarkCase.label,
      { timeout: 60_000 },
      () => runCase(benchmarkCase),
    );
  }
});
