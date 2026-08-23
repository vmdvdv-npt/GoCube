import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import {
  searchDeterministicAndOrProof,
  type DeterministicProofSearchResult,
} from './DeterministicAndOrProofSearch';
import {
  createEndgameProofSearchGoAdapter,
  createEndgameProofSearchNode,
} from './EndgameProofSearchGoAdapter';
import { buildEndgameGraph } from './EndgameGraphCore';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{
    readonly env?: Readonly<Record<string, string | undefined>>;
  }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_GENERIC_BENCHMARK === '1';
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 20;
const P95_RUNTIME_CEILING_MS = 250;
const MAX_RUNTIME_CEILING_MS = 1000;

type Workload = 'one-lib-positive-terminal' | 'incomplete-non-terminal';

interface BenchmarkCase {
  readonly label: string;
  readonly topology: Topology;
}

interface Fixture {
  readonly state: GameState;
  readonly target: PointId;
  readonly expectedOutcome: 'proven-kill' | 'unresolved';
}

interface Sample {
  readonly runtimeMs: number;
  readonly result: DeterministicProofSearchResult;
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
  occupied: Readonly<Record<PointId, Exclude<PointOccupancy, 'empty'>>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupied[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 100,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const makeFixture = (topology: Topology, workload: Workload): Fixture => {
  const points = [...topology.points()].sort();
  const target = points[0];
  if (!target) throw new Error('Topology has no points');

  if (workload === 'incomplete-non-terminal') {
    const state = makeState(topology, Object.freeze({ [target]: 'white' }));
    const graph = buildEndgameGraph(state, topology);
    const key = graph.pointOwner.get(target);
    const group = key ? graph.groups.get(key) : null;
    if (!group || group.liberties.length < 3) {
      throw new Error(`Expected >=3 liberties for incomplete fixture at ${target}`);
    }
    return Object.freeze({ state, target, expectedOutcome: 'unresolved' as const });
  }

  const neighbors = [...new Set(topology.neighbors(target))].sort();
  if (neighbors.length !== 4) {
    throw new Error(`Expected four graph neighbors for ${target}, got ${neighbors.length}`);
  }
  const liberty = neighbors[0]!;
  const occupied: Record<PointId, Exclude<PointOccupancy, 'empty'>> = {
    [target]: 'white',
  };
  for (const blocker of neighbors.slice(1)) occupied[blocker] = 'black';

  const state = makeState(topology, Object.freeze(occupied));
  const graph = buildEndgameGraph(state, topology);
  const key = graph.pointOwner.get(target);
  const group = key ? graph.groups.get(key) : null;
  if (!group || group.liberties.length !== 1 || group.liberties[0] !== liberty) {
    throw new Error(`Expected exactly one liberty for positive fixture at ${target}`);
  }
  return Object.freeze({ state, target, expectedOutcome: 'proven-kill' as const });
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

const measure = (read: () => DeterministicProofSearchResult): Sample => {
  const started = performance.now();
  const result = read();
  return Object.freeze({ runtimeMs: performance.now() - started, result });
};

const assertDeterminism = (samples: readonly Sample[]): DeterministicProofSearchResult => {
  const baseline = samples[0]!.result;
  for (const sample of samples) {
    expect(sample.result.outcome).toBe(baseline.outcome);
    expect(sample.result.reason).toBe(baseline.reason);
    expect(sample.result.exploredNodes).toBe(baseline.exploredNodes);
    expect(sample.result.maxDepth).toBe(baseline.maxDepth);
    expect(sample.result.principalVariation).toEqual(baseline.principalVariation);
    expect(sample.result.proofSafePruningCertificates).toEqual(
      baseline.proofSafePruningCertificates,
    );
  }
  return baseline;
};

const runCase = (benchmarkCase: BenchmarkCase, workload: Workload): void => {
  const fixture = makeFixture(benchmarkCase.topology, workload);
  const node = createEndgameProofSearchNode(
    benchmarkCase.topology,
    fixture.state,
    'white',
    Object.freeze([fixture.target]),
    'attacker',
  );
  const adapter = createEndgameProofSearchGoAdapter(benchmarkCase.topology);
  const read = (): DeterministicProofSearchResult =>
    searchDeterministicAndOrProof(node, adapter);

  for (let index = 0; index < WARMUP_RUNS; index += 1) read();

  const samples: Sample[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    samples.push(measure(read));
  }

  const baseline = assertDeterminism(samples);
  const runtime = summary(samples);

  expect(baseline.outcome).toBe(fixture.expectedOutcome);
  expect(baseline.exploredNodes).toBe(1);
  expect(baseline.maxDepth).toBe(1);
  expect(runtime.p95RuntimeMs).toBeLessThanOrEqual(P95_RUNTIME_CEILING_MS);
  expect(runtime.maxRuntimeMs).toBeLessThanOrEqual(MAX_RUNTIME_CEILING_MS);

  console.log(
    `ENGINE2_GENERIC_BENCHMARK_RESULT ${JSON.stringify({
      case: benchmarkCase.label,
      workload,
      logicalPoints: benchmarkCase.topology.points().length,
      outcome: baseline.outcome,
      reason: baseline.reason,
      exploredNodes: baseline.exploredNodes,
      maxDepth: baseline.maxDepth,
      ...runtime,
      p95RuntimeCeilingMs: P95_RUNTIME_CEILING_MS,
      maxRuntimeCeilingMs: MAX_RUNTIME_CEILING_MS,
      samples: SAMPLE_RUNS,
    })}`,
  );
};

const benchmarkDescribe = BENCHMARK_ENABLED ? describe : describe.skip;

benchmarkDescribe('EndgameProofSearchGoAdapter E2-4c performance gate', () => {
  for (const benchmarkCase of cases) {
    for (const workload of [
      'one-lib-positive-terminal',
      'incomplete-non-terminal',
    ] as const) {
      it(
        `${benchmarkCase.label} / ${workload}`,
        { timeout: 60_000 },
        () => runCase(benchmarkCase, workload),
      );
    }
  }
});
