import { describe, expect, it } from 'vitest';
import { runEngine2AdversarialCorpus } from './Engine2AdversarialCorpus';

type BenchmarkGlobal = typeof globalThis & {
  readonly process?: Readonly<{
    readonly env?: Readonly<Record<string, string | undefined>>;
  }>;
};

const BENCHMARK_ENABLED =
  (globalThis as BenchmarkGlobal).process?.env?.ENGINE2_FINAL_EVALUATION_BENCHMARK === '1';
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = 20;
const P95_CEILING_MS = 500;
const MAX_CEILING_MS = 2000;

interface Snapshot {
  readonly totalCases: number;
  readonly passedCases: number;
  readonly authoritativePositiveCases: number;
  readonly failClosedCases: number;
  readonly falseAuthoritativeConclusions: number;
  readonly totalExploredNodes: number;
  readonly transpositionHits: number;
}

interface Sample {
  readonly runtimeMs: number;
  readonly snapshot: Snapshot;
}

const percentile = (sorted: readonly number[], fraction: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
};

const round = (value: number): number => Math.round(value * 1000) / 1000;

const snapshot = (): Snapshot => {
  const evaluation = runEngine2AdversarialCorpus();
  expect(evaluation.failedCaseIds).toEqual([]);
  return Object.freeze({
    totalCases: evaluation.totalCases,
    passedCases: evaluation.passedCases,
    authoritativePositiveCases: evaluation.authoritativePositiveCases,
    failClosedCases: evaluation.failClosedCases,
    falseAuthoritativeConclusions: evaluation.falseAuthoritativeConclusions,
    totalExploredNodes: evaluation.totalExploredNodes,
    transpositionHits: evaluation.transpositionHits,
  });
};

const measure = (): Sample => {
  const started = performance.now();
  const result = snapshot();
  return Object.freeze({ runtimeMs: performance.now() - started, snapshot: result });
};

const benchmarkDescribe = BENCHMARK_ENABLED ? describe : describe.skip;

benchmarkDescribe('Engine 2 E2-11 final evaluation performance gate', () => {
  it('runs the complete adversarial corpus within the interactive CPU budget', { timeout: 60_000 }, () => {
    for (let index = 0; index < WARMUP_RUNS; index += 1) snapshot();

    const samples: Sample[] = [];
    for (let index = 0; index < SAMPLE_RUNS; index += 1) samples.push(measure());

    const baseline = samples[0]!.snapshot;
    for (const sample of samples) expect(sample.snapshot).toEqual(baseline);

    const runtimes = samples
      .map((sample) => sample.runtimeMs)
      .sort((left, right) => left - right);
    const medianRuntimeMs = round(percentile(runtimes, 0.5));
    const p95RuntimeMs = round(percentile(runtimes, 0.95));
    const maxRuntimeMs = round(runtimes[runtimes.length - 1] ?? 0);

    expect(baseline.totalCases).toBe(18);
    expect(baseline.passedCases).toBe(baseline.totalCases);
    expect(baseline.falseAuthoritativeConclusions).toBe(0);
    expect(baseline.transpositionHits).toBeGreaterThan(0);
    expect(p95RuntimeMs).toBeLessThanOrEqual(P95_CEILING_MS);
    expect(maxRuntimeMs).toBeLessThanOrEqual(MAX_CEILING_MS);

    console.log(
      `ENGINE2_FINAL_EVALUATION_BENCHMARK_RESULT ${JSON.stringify({
        ...baseline,
        medianRuntimeMs,
        p95RuntimeMs,
        maxRuntimeMs,
        p95RuntimeCeilingMs: P95_CEILING_MS,
        maxRuntimeCeilingMs: MAX_CEILING_MS,
        samples: SAMPLE_RUNS,
      })}`,
    );
  });
});
