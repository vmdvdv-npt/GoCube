import { expect, test } from '@playwright/test';

test('Final Group Judge browser benchmark: Cube 4/7 and Torus 9/19', async ({ page }) => {
  await page.goto('/');

  const samples = await page.evaluate(async () => {
    const benchmarkModulePath = '/src/core/endgame/FinalGroupJudgeBenchmark.ts';
    const benchmark = await import(/* @vite-ignore */ benchmarkModulePath);
    return benchmark.runFinalGroupJudgeBrowserBenchmark();
  });

  console.log(`FINAL_GROUP_JUDGE_BROWSER_BENCHMARK ${JSON.stringify(samples)}`);

  expect(samples.map((sample) => sample.name)).toEqual([
    'Cube 4',
    'Cube 7',
    'Torus 9',
    'Torus 19',
  ]);

  for (const sample of samples) {
    expect(sample.totalAnalysisMilliseconds).toBeGreaterThanOrEqual(0);
    expect(sample.groupCount).toBeGreaterThan(0);
    expect(sample.emptyRegionCount).toBeGreaterThan(0);
    expect(sample.bensonIterations).toBeGreaterThanOrEqual(2);
    expect(
      sample.counts.alive +
        sample.counts.dead +
        sample.counts.seki +
        sample.counts.unresolved,
    ).toBe(sample.groupCount);
  }
});
