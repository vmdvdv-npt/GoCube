import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { createEndgameProofSearchNode } from './EndgameProofSearchGoAdapter';
import { buildEndgameGraph } from './EndgameGraphCore';
import {
  THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
  createThreeLibertyProofSearchGoAdapter,
} from './ThreeLibertyProofSearchGoAdapter';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{
    readonly env?: Readonly<Record<string, string | undefined>>;
  }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_THREE_LIBERTY_BENCHMARK === '1';
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 20;

const ATTACKER_P95_CEILING_MS = 100;
const ATTACKER_MAX_CEILING_MS = 500;
const DEFENDER_P95_CEILING_MS = 1000;
const DEFENDER_MAX_CEILING_MS = 3000;

type Workload = 'attacker-current-liberties' | 'defender-whole-board';

interface BenchmarkCase {
  readonly label: string;
  readonly topology: Topology;
}

interface Fixture {
  readonly state: GameState;
  readonly target: PointId;
  readonly emptyPoints: number;
}

interface ExpansionSnapshot {
  readonly moveKeys: readonly string[];
  readonly completenessKind: 'complete' | 'proof-safe-pruned' | 'incomplete';
  readonly completenessDetail: string;
}

interface Sample {
  readonly runtimeMs: number;
  readonly snapshot: ExpansionSnapshot;
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

const makeFixture = (topology: Topology): Fixture => {
  const points = [...topology.points()].sort();
  const target = points[0];
  if (!target) throw new Error('Topology has no points');

  const neighbors = [...new Set(topology.neighbors(target))].sort();
  if (neighbors.length !== 4) {
    throw new Error(`Expected four graph neighbors for ${target}, got ${neighbors.length}`);
  }

  const blocker = neighbors[0]!;
  const state = makeState(
    topology,
    Object.freeze({
      [target]: 'white' as const,
      [blocker]: 'black' as const,
    }),
  );

  const graph = buildEndgameGraph(state, topology);
  const key = graph.pointOwner.get(target);
  const targetGroup = key ? graph.groups.get(key) : null;
  if (!targetGroup || targetGroup.liberties.length !== 3) {
    throw new Error(`Expected exactly three target liberties for ${target}`);
  }

  return Object.freeze({
    state,
    target,
    emptyPoints: points.length - 2,
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

const snapshotExpansion = (
  topology: Topology,
  fixture: Fixture,
  workload: Workload,
): ExpansionSnapshot => {
  const role = workload === 'attacker-current-liberties' ? 'attacker' : 'defender';
  const node = createEndgameProofSearchNode(
    topology,
    fixture.state,
    'white',
    Object.freeze([fixture.target]),
    role,
  );
  const adapter = createThreeLibertyProofSearchGoAdapter(topology);
  const expansion = adapter.expand(node);
  const completenessDetail =
    expansion.completeness.kind === 'incomplete'
      ? expansion.completeness.reason
      : expansion.completeness.kind === 'proof-safe-pruned'
        ? expansion.completeness.certificate
        : '';

  return Object.freeze({
    moveKeys: Object.freeze(expansion.moves.map((move) => adapter.moveKey(move))),
    completenessKind: expansion.completeness.kind,
    completenessDetail,
  });
};

const measure = (read: () => ExpansionSnapshot): Sample => {
  const started = performance.now();
  const snapshot = read();
  return Object.freeze({
    runtimeMs: performance.now() - started,
    snapshot,
  });
};

const assertDeterminism = (samples: readonly Sample[]): ExpansionSnapshot => {
  const baseline = samples[0]!.snapshot;
  for (const sample of samples) {
    expect(sample.snapshot.moveKeys).toEqual(baseline.moveKeys);
    expect(sample.snapshot.completenessKind).toBe(baseline.completenessKind);
    expect(sample.snapshot.completenessDetail).toBe(baseline.completenessDetail);
  }
  return baseline;
};

const runCase = (benchmarkCase: BenchmarkCase, workload: Workload): void => {
  const fixture = makeFixture(benchmarkCase.topology);
  const read = (): ExpansionSnapshot =>
    snapshotExpansion(benchmarkCase.topology, fixture, workload);

  for (let index = 0; index < WARMUP_RUNS; index += 1) read();

  const samples: Sample[] = [];
  for (let index = 0; index < SAMPLE_RUNS; index += 1) {
    samples.push(measure(read));
  }

  const baseline = assertDeterminism(samples);
  const runtime = summary(samples);
  const attacker = workload === 'attacker-current-liberties';
  const p95CeilingMs = attacker ? ATTACKER_P95_CEILING_MS : DEFENDER_P95_CEILING_MS;
  const maxCeilingMs = attacker ? ATTACKER_MAX_CEILING_MS : DEFENDER_MAX_CEILING_MS;

  if (attacker) {
    expect(baseline.completenessKind).toBe('incomplete');
    expect(baseline.completenessDetail).toBe(
      THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
    );
    expect(baseline.moveKeys).toHaveLength(3);
    expect(baseline.moveKeys.every((moveKey) => moveKey.startsWith('place:'))).toBe(true);
  } else {
    expect(baseline.completenessKind).toBe('complete');
    expect(baseline.completenessDetail).toBe('');
    expect(baseline.moveKeys).toHaveLength(fixture.emptyPoints + 1);
    expect(baseline.moveKeys[baseline.moveKeys.length - 1]).toBe('pass');
  }

  expect(runtime.p95RuntimeMs).toBeLessThanOrEqual(p95CeilingMs);
  expect(runtime.maxRuntimeMs).toBeLessThanOrEqual(maxCeilingMs);

  console.log(
    `ENGINE2_THREE_LIBERTY_BENCHMARK_RESULT ${JSON.stringify({
      case: benchmarkCase.label,
      workload,
      logicalPoints: benchmarkCase.topology.points().length,
      emptyPoints: fixture.emptyPoints,
      generatedMoves: baseline.moveKeys.length,
      completeness: baseline.completenessKind,
      ...runtime,
      p95RuntimeCeilingMs: p95CeilingMs,
      maxRuntimeCeilingMs: maxCeilingMs,
      samples: SAMPLE_RUNS,
    })}`,
  );
};

const benchmarkDescribe = BENCHMARK_ENABLED ? describe : describe.skip;

benchmarkDescribe('ThreeLibertyProofSearchGoAdapter E2-5 performance gate', () => {
  for (const benchmarkCase of cases) {
    for (const workload of [
      'attacker-current-liberties',
      'defender-whole-board',
    ] as const) {
      it(
        `${benchmarkCase.label} / ${workload}`,
        { timeout: 60_000 },
        () => runCase(benchmarkCase, workload),
      );
    }
  }
});
