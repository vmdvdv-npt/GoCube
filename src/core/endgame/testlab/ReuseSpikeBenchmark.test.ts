import { describe, expect, it } from 'vitest';
import {
  runReuseSpikeBenchmark,
  type ReuseSpikeSolverAdapter,
} from './ReuseSpikeBenchmark';
import type { ReuseSpikeCorpusCase } from './ReuseSpikeCorpus';

const problem = (
  id: string,
  sourceStatus: ReuseSpikeCorpusCase['sourceStatus'],
): ReuseSpikeCorpusCase =>
  Object.freeze({
    id,
    sourceStatus,
    position: Object.freeze({
      boardSize: 9,
      currentPlayer: 'black' as const,
      stones: Object.freeze([]),
      targetCoordinates: Object.freeze([]),
    }),
    sgf: '(;FF[4]GM[1]SZ[9]PL[B])',
  });

describe('ReuseSpikeBenchmark', () => {
  it('runs the same corpus sequentially and keeps failures comparable', async () => {
    const calls: string[] = [];
    const adapter: ReuseSpikeSolverAdapter = {
      id: 'tsumego-js',
      revision: 'fixture-revision',
      async solve(input) {
        calls.push(input.id);
        if (input.id === 'broken') throw new Error('solver crashed');
        return { outcome: 'target-captured', nodes: 17, move: 'B[aa]' };
      },
    };
    const ticks = [0, 5, 5, 12];
    let tick = 0;

    const result = await runReuseSpikeBenchmark(
      adapter,
      [problem('known', 'dead'), problem('broken', 'unknown')],
      () => ticks[tick++] ?? 12,
    );

    expect(calls).toEqual(['known', 'broken']);
    expect(result).toMatchObject({
      candidate: 'tsumego-js',
      revision: 'fixture-revision',
      totalCases: 2,
      scoredCases: 1,
      matches: 1,
      mismatches: 0,
      errors: 1,
      unsupported: 0,
      totalElapsedMs: 12,
      meanElapsedMs: 6,
      totalNodes: 17,
    });
    expect(result.cases).toEqual([
      expect.objectContaining({
        id: 'known',
        solverOutcome: 'target-captured',
        correctness: 'match',
        elapsedMs: 5,
        nodes: 17,
        move: 'B[aa]',
      }),
      expect.objectContaining({
        id: 'broken',
        solverOutcome: 'error',
        correctness: 'not-scored',
        elapsedMs: 7,
        detail: 'solver crashed',
      }),
    ]);
  });

  it('counts unsupported results as mismatches only when an answer is known', async () => {
    const adapter: ReuseSpikeSolverAdapter = {
      id: 'darkforest',
      revision: 'fixture-revision',
      async solve() {
        return { outcome: 'unsupported' };
      },
    };

    const result = await runReuseSpikeBenchmark(
      adapter,
      [problem('known', 'alive'), problem('unknown', 'unknown')],
      () => 0,
    );

    expect(result).toMatchObject({
      totalCases: 2,
      scoredCases: 1,
      matches: 0,
      mismatches: 1,
      unsupported: 2,
      errors: 0,
    });
    expect(result.cases.map(({ correctness }) => correctness)).toEqual([
      'mismatch',
      'not-scored',
    ]);
  });

  it('does not treat unresolved source classification as a known answer', async () => {
    const adapter: ReuseSpikeSolverAdapter = {
      id: 'relevance-zone',
      revision: 'fixture-revision',
      async solve() {
        return { outcome: 'target-survives' };
      },
    };

    const result = await runReuseSpikeBenchmark(
      adapter,
      [problem('not-proof', 'unresolved')],
      () => 0,
    );

    expect(result).toMatchObject({
      totalCases: 1,
      scoredCases: 0,
      matches: 0,
      mismatches: 0,
    });
    expect(result.cases[0]?.correctness).toBe('not-scored');
  });

  it('returns stable zero cost for an empty corpus', async () => {
    const adapter: ReuseSpikeSolverAdapter = {
      id: 'cameron-martin',
      revision: 'fixture-revision',
      async solve() {
        return { outcome: 'unknown' };
      },
    };

    const result = await runReuseSpikeBenchmark(adapter, [], () => 123);

    expect(result).toMatchObject({
      totalCases: 0,
      scoredCases: 0,
      matches: 0,
      mismatches: 0,
      totalElapsedMs: 0,
      meanElapsedMs: 0,
    });
  });
});
