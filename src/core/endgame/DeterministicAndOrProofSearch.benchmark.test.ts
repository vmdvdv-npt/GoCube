import { describe, expect, it } from 'vitest';
import {
  searchDeterministicAndOrProof,
  type DeterministicProofSearchAdapter,
  type DeterministicProofSearchResult,
  type ProofSearchExpansion,
  type ProofSearchRole,
  type ProofSearchTerminal,
} from './DeterministicAndOrProofSearch';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{
    readonly env?: Readonly<Record<string, string | undefined>>;
  }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_TRANSPOSITION_BENCHMARK === '1';
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 20;
const BRANCH_LEVELS = 14;
const NODE_BUDGET = 100_000;
const BASELINE_P95_CEILING_MS = 1000;
const OPTIMIZED_P95_CEILING_MS = 250;
const MAX_RUNTIME_CEILING_MS = 3000;

interface DagNode {
  readonly key: string;
  readonly role: ProofSearchRole;
  readonly terminal?: ProofSearchTerminal;
  readonly moves?: readonly DagMove[];
}

interface DagMove {
  readonly key: string;
  readonly child: DagNode;
}

interface Sample {
  readonly runtimeMs: number;
  readonly result: DeterministicProofSearchResult;
}

const adapter: DeterministicProofSearchAdapter<DagNode, DagMove> = Object.freeze({
  nodeKey: (node: DagNode): string => node.key,
  role: (node: DagNode): ProofSearchRole => node.role,
  terminal: (node: DagNode): ProofSearchTerminal | null => node.terminal ?? null,
  expand: (node: DagNode): ProofSearchExpansion<DagMove> =>
    Object.freeze({
      moves: node.moves ?? Object.freeze([] as DagMove[]),
      completeness: Object.freeze({ kind: 'complete' as const }),
    }),
  apply: (_node: DagNode, move: DagMove): DagNode => move.child,
  moveKey: (move: DagMove): string => move.key,
});

const makeConvergingDag = (): DagNode => {
  let node: DagNode = Object.freeze({
    key: `layer-${BRANCH_LEVELS}`,
    role: 'attacker' as const,
    terminal: Object.freeze({ outcome: 'proven-survival' as const }),
  });

  for (let level = BRANCH_LEVELS - 1; level >= 0; level -= 1) {
    const child = node;
    node = Object.freeze({
      key: `layer-${level}`,
      role: 'attacker' as const,
      moves: Object.freeze([
        Object.freeze({ key: `a-${level}`, child }),
        Object.freeze({ key: `b-${level}`, child }),
      ]),
    });
  }

  return node;
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
  for (const sample of samples) expect(sample.result).toEqual(baseline);
  return baseline;
};

const benchmarkDescribe = BENCHMARK_ENABLED ? describe : describe.skip;

benchmarkDescribe('DeterministicAndOrProofSearch E2-10 transposition performance gate', () => {
  it('collapses a converging deterministic DAG without changing proof semantics', () => {
    const root = makeConvergingDag();
    const baselineRead = (): DeterministicProofSearchResult =>
      searchDeterministicAndOrProof(
        root,
        adapter,
        Object.freeze({ nodeBudget: NODE_BUDGET, useTranspositions: false }),
      );
    const optimizedRead = (): DeterministicProofSearchResult =>
      searchDeterministicAndOrProof(
        root,
        adapter,
        Object.freeze({ nodeBudget: NODE_BUDGET }),
      );

    for (let index = 0; index < WARMUP_RUNS; index += 1) {
      baselineRead();
      optimizedRead();
    }

    const baselineSamples: Sample[] = [];
    const optimizedSamples: Sample[] = [];
    for (let index = 0; index < SAMPLE_RUNS; index += 1) {
      baselineSamples.push(measure(baselineRead));
      optimizedSamples.push(measure(optimizedRead));
    }

    const baseline = assertDeterminism(baselineSamples);
    const optimized = assertDeterminism(optimizedSamples);
    const baselineRuntime = summary(baselineSamples);
    const optimizedRuntime = summary(optimizedSamples);

    expect(optimized.outcome).toBe(baseline.outcome);
    expect(optimized.reason).toBe(baseline.reason);
    expect(optimized.principalVariation).toEqual(baseline.principalVariation);
    expect(optimized.maxDepth).toBe(baseline.maxDepth);
    expect(baseline.exploredNodes).toBe(2 ** (BRANCH_LEVELS + 1) - 1);
    expect(optimized.exploredNodes).toBe(BRANCH_LEVELS + 1);
    expect(optimized.transpositionHits).toBe(BRANCH_LEVELS);
    expect(optimized.transpositionEntries).toBe(BRANCH_LEVELS + 1);
    expect(baselineRuntime.p95RuntimeMs).toBeLessThanOrEqual(BASELINE_P95_CEILING_MS);
    expect(optimizedRuntime.p95RuntimeMs).toBeLessThanOrEqual(OPTIMIZED_P95_CEILING_MS);
    expect(baselineRuntime.maxRuntimeMs).toBeLessThanOrEqual(MAX_RUNTIME_CEILING_MS);
    expect(optimizedRuntime.maxRuntimeMs).toBeLessThanOrEqual(MAX_RUNTIME_CEILING_MS);

    const p95Speedup =
      optimizedRuntime.p95RuntimeMs > 0
        ? round(baselineRuntime.p95RuntimeMs / optimizedRuntime.p95RuntimeMs)
        : null;

    console.log(
      `ENGINE2_TRANSPOSITION_BENCHMARK_RESULT ${JSON.stringify({
        branchLevels: BRANCH_LEVELS,
        logicalDepth: BRANCH_LEVELS + 1,
        baselineExploredNodes: baseline.exploredNodes,
        optimizedExploredNodes: optimized.exploredNodes,
        transpositionHits: optimized.transpositionHits,
        transpositionEntries: optimized.transpositionEntries,
        baseline: baselineRuntime,
        optimized: optimizedRuntime,
        p95Speedup,
        samples: SAMPLE_RUNS,
      })}`,
    );
  }, 60_000);
});
