import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { analyzeSemeaiSeki } from './SemeaiSekiProof';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{
    readonly env?: Readonly<Record<string, string | undefined>>;
  }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_SEMEAI_SEKI_BENCHMARK === '1';
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
  readonly blackGroupKey: string;
  readonly whiteGroupKey: string;
  readonly knownSharedPoint: PointId;
}

interface AnalysisSnapshot {
  readonly sharedLiberties: number;
  readonly blackExclusiveLiberties: number;
  readonly whiteExclusiveLiberties: number;
  readonly blackApproachPoints: number;
  readonly whiteApproachPoints: number;
  readonly sekiStatus: string;
  readonly sekiReason: string;
  readonly killProofsExamined: boolean;
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

const makeFixture = (topology: Topology): Fixture => {
  const ordered = [...topology.points()].sort();
  const knownSharedPoint = ordered[0];
  if (!knownSharedPoint) throw new Error(`No points for ${topology.id}`);

  const neighbors = [...new Set(topology.neighbors(knownSharedPoint))].sort();
  const blackPoint = neighbors[0];
  const whitePoint = neighbors[1];
  if (!blackPoint || !whitePoint) {
    throw new Error(`Need two distinct neighbors for ${topology.id}`);
  }

  const board: Record<PointId, PointOccupancy> = {};
  for (const point of ordered) board[point] = 'empty';
  board[blackPoint] = 'black';
  board[whitePoint] = 'white';

  const state = Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black' as const,
    moveNumber: 120,
    consecutivePasses: 2,
    phase: 'endgame' as const,
    captures: Object.freeze({ black: 0, white: 0 }),
  });
  const graph = buildEndgameGraph(state, topology);
  const blackGroupKey = graph.pointOwner.get(blackPoint);
  const whiteGroupKey = graph.pointOwner.get(whitePoint);
  if (!blackGroupKey || !whiteGroupKey) {
    throw new Error(`Missing benchmark group identity for ${topology.id}`);
  }

  return Object.freeze({
    state,
    blackGroupKey,
    whiteGroupKey,
    knownSharedPoint,
  });
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
  const analysis = analyzeSemeaiSeki(
    fixture.state,
    topology,
    fixture.blackGroupKey,
    fixture.whiteGroupKey,
    Object.freeze({ includeKillProofs: false }),
  );
  if (!analysis) throw new Error(`No semeai relation for ${topology.id}`);
  expect(analysis.sharedLiberties).toContain(fixture.knownSharedPoint);

  const black = analysis.groups.find((group) => group.color === 'black');
  const white = analysis.groups.find((group) => group.color === 'white');
  if (!black || !white) throw new Error(`Missing color summaries for ${topology.id}`);

  return Object.freeze({
    sharedLiberties: analysis.sharedLiberties.length,
    blackExclusiveLiberties: black.exclusiveLiberties.length,
    whiteExclusiveLiberties: white.exclusiveLiberties.length,
    blackApproachPoints: black.approachPoints.length,
    whiteApproachPoints: white.approachPoints.length,
    sekiStatus: analysis.seki.status,
    sekiReason: analysis.seki.reason,
    killProofsExamined: analysis.killProofsExamined,
  });
};

const measure = (read: () => AnalysisSnapshot): Sample => {
  const started = performance.now();
  const snapshot = read();
  return Object.freeze({ runtimeMs: performance.now() - started, snapshot });
};

const runCase = (benchmarkCase: BenchmarkCase): void => {
  const fixture = makeFixture(benchmarkCase.topology);
  const read = (): AnalysisSnapshot => snapshotAnalysis(benchmarkCase.topology, fixture);

  for (let index = 0; index < WARMUP_RUNS; index += 1) read();

  const samples: Sample[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) samples.push(measure(read));

  const baseline = samples[0]!.snapshot;
  for (const sample of samples) expect(sample.snapshot).toEqual(baseline);
  const runtime = summary(samples);

  expect(baseline.sharedLiberties).toBeGreaterThan(0);
  expect(baseline.killProofsExamined).toBe(false);
  expect(runtime.p95RuntimeMs).toBeLessThanOrEqual(P95_CEILING_MS);
  expect(runtime.maxRuntimeMs).toBeLessThanOrEqual(MAX_CEILING_MS);

  console.log(
    `ENGINE2_SEMEAI_SEKI_BENCHMARK_RESULT ${JSON.stringify({
      case: benchmarkCase.label,
      logicalPoints: benchmarkCase.topology.points().length,
      ...baseline,
      ...runtime,
      p95RuntimeCeilingMs: P95_CEILING_MS,
      maxRuntimeCeilingMs: MAX_CEILING_MS,
      samples: SAMPLE_RUNS,
    })}`,
  );
};

const benchmarkDescribe = BENCHMARK_ENABLED ? describe : describe.skip;

benchmarkDescribe('SemeaiSekiProof E2-9 performance gate', () => {
  for (const benchmarkCase of cases) {
    it(benchmarkCase.label, { timeout: 60_000 }, () => runCase(benchmarkCase));
  }
});
