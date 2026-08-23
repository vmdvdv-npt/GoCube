import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph } from './EndgameGraphCore';
import {
  readTwoLibertyTacticsPruned,
  type TwoLibertyPrunedTacticalResult,
} from './TwoLibertyPrunedTacticalReader';
import {
  readTwoLibertyTactics,
  type TwoLibertyTacticalResult,
} from './TwoLibertyTacticalReader';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{
    readonly env?: Readonly<Record<string, string | undefined>>;
  }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_BENCHMARK === '1';
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 20;

type Workload = 'dense-local' | 'sparse-max-empty';
type ReaderMode = 'exhaustive' | 'proof-pruned';

interface BenchmarkCase {
  readonly label: string;
  readonly topology: Topology;
}

interface Fixture {
  readonly state: GameState;
  readonly target: PointId;
  readonly emptyPoints: number;
}

interface Sample<T> {
  readonly runtimeMs: number;
  readonly result: T;
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

const makeFixture = (topology: Topology, workload: Workload): Fixture => {
  const points = [...topology.points()].sort();
  const target = points[0];
  if (!target) throw new Error('Topology has no points');

  const neighbors = [...new Set(topology.neighbors(target))].sort();
  if (neighbors.length < 4) {
    throw new Error(`Expected four graph neighbors for ${target}, got ${neighbors.length}`);
  }

  const liberties = new Set<PointId>(neighbors.slice(0, 2));
  const blockers = new Set<PointId>(neighbors.slice(2));
  const board: Record<PointId, PointOccupancy> = {};

  for (const point of points) {
    if (point === target) {
      board[point] = 'white';
      continue;
    }

    if (liberties.has(point)) {
      board[point] = 'empty';
      continue;
    }

    if (workload === 'dense-local') {
      board[point] = 'black';
      continue;
    }

    board[point] = blockers.has(point) ? 'black' : 'empty';
  }

  const state: GameState = Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 100,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });

  const graph = buildEndgameGraph(state, topology);
  const targetGroupKey = graph.pointOwner.get(target);
  const targetGroup = targetGroupKey ? graph.groups.get(targetGroupKey) : null;
  if (!targetGroup || targetGroup.liberties.length !== 2) {
    throw new Error(
      `Benchmark fixture must have exactly two liberties; ${target} has ${targetGroup?.liberties.length ?? 0}`,
    );
  }

  return Object.freeze({
    state,
    target,
    emptyPoints: points.filter((point) => state.board[point] === 'empty').length,
  });
};

const targetGroupKeyFor = (topology: Topology, fixture: Fixture): string => {
  const graph = buildEndgameGraph(fixture.state, topology);
  const targetGroupKey = graph.pointOwner.get(fixture.target);
  if (!targetGroupKey) throw new Error(`Missing target group at ${fixture.target}`);
  return targetGroupKey;
};

const readExhaustive = (
  topology: Topology,
  fixture: Fixture,
): TwoLibertyTacticalResult => {
  const graph = buildEndgameGraph(fixture.state, topology);
  const targetGroupKey = graph.pointOwner.get(fixture.target);
  if (!targetGroupKey) throw new Error(`Missing target group at ${fixture.target}`);

  const result = readTwoLibertyTactics(
    fixture.state,
    topology,
    graph,
    targetGroupKey,
  );
  if (!result) throw new Error(`Exhaustive reader rejected benchmark target ${fixture.target}`);
  return result;
};

const readPruned = (
  topology: Topology,
  fixture: Fixture,
): TwoLibertyPrunedTacticalResult => {
  const graph = buildEndgameGraph(fixture.state, topology);
  const targetGroupKey = graph.pointOwner.get(fixture.target);
  if (!targetGroupKey) throw new Error(`Missing target group at ${fixture.target}`);

  const result = readTwoLibertyTacticsPruned(
    fixture.state,
    topology,
    graph,
    targetGroupKey,
  );
  if (!result) throw new Error(`Pruned reader rejected benchmark target ${fixture.target}`);
  return result;
};

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

const measure = <T>(read: () => T): Sample<T> => {
  const started = performance.now();
  const result = read();
  return Object.freeze({ runtimeMs: performance.now() - started, result });
};

const runtimeSummary = (samples: readonly Sample<unknown>[]) => {
  const runtimes = samples
    .map((sample) => sample.runtimeMs)
    .sort((left, right) => left - right);
  return Object.freeze({
    medianRuntimeMs: round(percentile(runtimes, 0.5)),
    p95RuntimeMs: round(percentile(runtimes, 0.95)),
    maxRuntimeMs: round(runtimes[runtimes.length - 1] ?? 0),
  });
};

const assertExhaustiveDeterminism = (
  samples: readonly Sample<TwoLibertyTacticalResult>[],
): TwoLibertyTacticalResult => {
  const baseline = samples[0]!.result;
  for (const sample of samples) {
    expect(sample.result.outcome).toBe(baseline.outcome);
    expect(sample.result.exploredNodes).toBe(baseline.exploredNodes);
    expect(sample.result.maxDepth).toBe(baseline.maxDepth);
    expect(sample.result.defenderFirst.examinedPlacements).toBe(
      baseline.defenderFirst.examinedPlacements,
    );
    expect(sample.result.defenderFirst.legalPlacements).toBe(
      baseline.defenderFirst.legalPlacements,
    );
  }
  return baseline;
};

const assertPrunedDeterminism = (
  samples: readonly Sample<TwoLibertyPrunedTacticalResult>[],
): TwoLibertyPrunedTacticalResult => {
  const baseline = samples[0]!.result;
  for (const sample of samples) {
    expect(sample.result.outcome).toBe(baseline.outcome);
    expect(sample.result.exploredNodes).toBe(baseline.exploredNodes);
    expect(sample.result.maxDepth).toBe(baseline.maxDepth);
    expect(sample.result.defenderFirst.examinedPlacements).toBe(
      baseline.defenderFirst.examinedPlacements,
    );
    expect(sample.result.defenderFirst.legalPlacements).toBe(
      baseline.defenderFirst.legalPlacements,
    );
    expect(sample.result.defenderFirst.deepEvaluatedPlacements).toBe(
      baseline.defenderFirst.deepEvaluatedPlacements,
    );
    expect(sample.result.defenderFirst.certifiedIrrelevantPlacements).toBe(
      baseline.defenderFirst.certifiedIrrelevantPlacements,
    );
  }
  return baseline;
};

const logRecord = (
  benchmarkCase: BenchmarkCase,
  fixture: Fixture,
  workload: Workload,
  mode: ReaderMode,
  baseline: TwoLibertyTacticalResult | TwoLibertyPrunedTacticalResult,
  samples: readonly Sample<unknown>[],
) => {
  const common = {
    case: benchmarkCase.label,
    workload,
    mode,
    logicalPoints: benchmarkCase.topology.points().length,
    emptyPoints: fixture.emptyPoints,
    examinedDefenderMoves: baseline.defenderFirst.examinedPlacements,
    legalDefenderMoves: baseline.defenderFirst.legalPlacements,
    exploredNodes: baseline.exploredNodes,
    maxDepth: baseline.maxDepth,
    outcome: baseline.outcome,
    defenderResult: baseline.defenderFirst.result,
    ...runtimeSummary(samples),
    samples: SAMPLE_RUNS,
  };

  const record =
    mode === 'proof-pruned'
      ? Object.freeze({
          ...common,
          deepEvaluatedDefenderMoves: (baseline as TwoLibertyPrunedTacticalResult)
            .defenderFirst.deepEvaluatedPlacements,
          certifiedIrrelevantDefenderMoves: (baseline as TwoLibertyPrunedTacticalResult)
            .defenderFirst.certifiedIrrelevantPlacements,
          causalConePoints: (baseline as TwoLibertyPrunedTacticalResult).pruning.relevance
            .causalConePoints.length,
        })
      : Object.freeze(common);

  console.log(`ENGINE2_BENCHMARK_RESULT ${JSON.stringify(record)}`);
};

const runCase = (benchmarkCase: BenchmarkCase, workload: Workload) => {
  const fixture = makeFixture(benchmarkCase.topology, workload);
  targetGroupKeyFor(benchmarkCase.topology, fixture);

  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    readExhaustive(benchmarkCase.topology, fixture);
    readPruned(benchmarkCase.topology, fixture);
  }

  const exhaustiveSamples: Sample<TwoLibertyTacticalResult>[] = [];
  const prunedSamples: Sample<TwoLibertyPrunedTacticalResult>[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    exhaustiveSamples.push(
      measure(() => readExhaustive(benchmarkCase.topology, fixture)),
    );
    prunedSamples.push(
      measure(() => readPruned(benchmarkCase.topology, fixture)),
    );
  }

  const exhaustive = assertExhaustiveDeterminism(exhaustiveSamples);
  const pruned = assertPrunedDeterminism(prunedSamples);

  expect(exhaustive.defenderFirst.result).not.toBe('budget-exhausted');
  expect(pruned.defenderFirst.result).not.toBe('budget-exhausted');
  expect(exhaustive.outcome).not.toBe('proven-dead');
  if (pruned.outcome === 'proven-dead') expect(exhaustive.outcome).toBe('proven-dead');

  logRecord(
    benchmarkCase,
    fixture,
    workload,
    'exhaustive',
    exhaustive,
    exhaustiveSamples,
  );
  logRecord(
    benchmarkCase,
    fixture,
    workload,
    'proof-pruned',
    pruned,
    prunedSamples,
  );
};

const benchmarkDescribe = BENCHMARK_ENABLED ? describe : describe.skip;

benchmarkDescribe('TwoLibertyTacticalReader E2-3c/E2-3d performance comparison', () => {
  for (const benchmarkCase of cases) {
    for (const workload of ['dense-local', 'sparse-max-empty'] as const) {
      it(
        `${benchmarkCase.label} / ${workload}`,
        { timeout: 180_000 },
        () => runCase(benchmarkCase, workload),
      );
    }
  }
});
