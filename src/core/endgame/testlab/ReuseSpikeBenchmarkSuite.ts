import {
  runReuseSpikeBenchmark,
  type ReuseSpikeBenchmarkSummary,
  type ReuseSpikeCandidateId,
  type ReuseSpikeClock,
  type ReuseSpikeSolverAdapter,
} from './ReuseSpikeBenchmark';
import {
  buildReuseSpikeCorpus,
  type ReuseSpikeCorpusCase,
} from './ReuseSpikeCorpus';

export const REUSE_SPIKE_CANDIDATES: readonly ReuseSpikeCandidateId[] = Object.freeze([
  'tsumego-js',
  'cameron-martin',
  'relevance-zone',
  'darkforest',
]);

const orderedAdapters = (
  adapters: readonly ReuseSpikeSolverAdapter[],
): readonly ReuseSpikeSolverAdapter[] => {
  const byId = new Map<ReuseSpikeCandidateId, ReuseSpikeSolverAdapter>();
  for (const adapter of adapters) {
    if (byId.has(adapter.id)) {
      throw new Error(`Duplicate reuse-spike adapter: ${adapter.id}`);
    }
    byId.set(adapter.id, adapter);
  }

  const missing = REUSE_SPIKE_CANDIDATES.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`Missing reuse-spike adapters: ${missing.join(', ')}`);
  }
  if (byId.size !== REUSE_SPIKE_CANDIDATES.length) {
    throw new Error('Unexpected reuse-spike adapter set');
  }

  return Object.freeze(
    REUSE_SPIKE_CANDIDATES.map((id) => {
      const adapter = byId.get(id);
      if (!adapter) throw new Error(`Missing reuse-spike adapter: ${id}`);
      return adapter;
    }),
  );
};

/**
 * Runs every Work 1 candidate over the exact same frozen corpus, in a fixed
 * candidate order. The suite itself does not parallelize candidates or cases so
 * wall-time and node/work metrics are not distorted by host contention.
 */
export const runReuseSpikeBenchmarkSuite = async (
  adapters: readonly ReuseSpikeSolverAdapter[],
  corpus: readonly ReuseSpikeCorpusCase[] = buildReuseSpikeCorpus(),
  now: ReuseSpikeClock = () => performance.now(),
): Promise<readonly ReuseSpikeBenchmarkSummary[]> => {
  const summaries: ReuseSpikeBenchmarkSummary[] = [];

  for (const adapter of orderedAdapters(adapters)) {
    summaries.push(await runReuseSpikeBenchmark(adapter, corpus, now));
  }

  return Object.freeze(summaries);
};
