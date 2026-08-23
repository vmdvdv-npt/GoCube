import { describe, expect, it } from 'vitest';
import type { ReuseSpikeSolverAdapter } from './ReuseSpikeBenchmark';
import {
  REUSE_SPIKE_CANDIDATES,
  runReuseSpikeBenchmarkSuite,
} from './ReuseSpikeBenchmarkSuite';
import type { ReuseSpikeCorpusCase } from './ReuseSpikeCorpus';

const corpus: readonly ReuseSpikeCorpusCase[] = Object.freeze([
  Object.freeze({
    id: 'shared',
    sourceStatus: 'dead',
    position: Object.freeze({
      boardSize: 9,
      currentPlayer: 'white' as const,
      stones: Object.freeze([{ row: 4, column: 4, color: 'black' as const }]),
      targetCoordinates: Object.freeze([{ row: 4, column: 4 }]),
    }),
    sgf: '(;FF[4]GM[1]SZ[9]PL[W]AB[ee]MA[ee])',
  }),
]);

const adapter = (
  id: ReuseSpikeSolverAdapter['id'],
  calls: string[],
): ReuseSpikeSolverAdapter => ({
  id,
  revision: `${id}-fixture`,
  async solve(problem) {
    calls.push(`${id}:${problem.id}`);
    return { outcome: 'target-captured' };
  },
});

describe('ReuseSpikeBenchmarkSuite', () => {
  it('runs all candidates in the canonical order over the same corpus', async () => {
    const calls: string[] = [];
    const adapters = [
      adapter('darkforest', calls),
      adapter('tsumego-js', calls),
      adapter('relevance-zone', calls),
      adapter('cameron-martin', calls),
    ];

    const summaries = await runReuseSpikeBenchmarkSuite(adapters, corpus, () => 0);

    expect(summaries.map(({ candidate }) => candidate)).toEqual(REUSE_SPIKE_CANDIDATES);
    expect(calls).toEqual(REUSE_SPIKE_CANDIDATES.map((id) => `${id}:shared`));
    expect(summaries.every(({ matches }) => matches === 1)).toBe(true);
  });

  it('rejects missing or duplicate candidates instead of silently comparing different sets', async () => {
    const calls: string[] = [];
    const complete = REUSE_SPIKE_CANDIDATES.map((id) => adapter(id, calls));

    await expect(runReuseSpikeBenchmarkSuite(complete.slice(1), corpus, () => 0)).rejects.toThrow(
      'Missing reuse-spike adapters: tsumego-js',
    );
    await expect(
      runReuseSpikeBenchmarkSuite([...complete, adapter('darkforest', calls)], corpus, () => 0),
    ).rejects.toThrow('Duplicate reuse-spike adapter: darkforest');
  });
});
