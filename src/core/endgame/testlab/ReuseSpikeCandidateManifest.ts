import type { ReuseSpikeCandidateId } from './ReuseSpikeBenchmark';

export type ReuseSpikeLicenseStatus = 'apache-2.0' | 'bsd-style' | 'undeclared';
export type ReuseSpikeExecutionMode =
  | 'in-process-permissive'
  | 'black-box-only'
  | 'native-permissive';

export interface ReuseSpikeCandidateManifestEntry {
  readonly id: ReuseSpikeCandidateId;
  readonly repository: string;
  readonly revision: string;
  readonly upstreamBranch: string;
  readonly licenseStatus: ReuseSpikeLicenseStatus;
  readonly executionMode: ReuseSpikeExecutionMode;
}

/**
 * Immutable Work 1 upstream snapshot. Benchmark numbers are meaningful only
 * when they can be traced back to exact solver revisions.
 */
export const REUSE_SPIKE_CANDIDATE_MANIFEST: readonly ReuseSpikeCandidateManifestEntry[] =
  Object.freeze([
    Object.freeze({
      id: 'tsumego-js',
      repository: 'd180cf/tsumego.js',
      revision: '58a079aac928c7bd59dc398d014f1f2b743f692e',
      upstreamBranch: 'master',
      licenseStatus: 'apache-2.0',
      executionMode: 'in-process-permissive',
    }),
    Object.freeze({
      id: 'cameron-martin',
      repository: 'cameron-martin/tsumego-solver',
      revision: '7408523ae34d9f890eef08d7f39fae683dee1a4e',
      upstreamBranch: 'master',
      licenseStatus: 'undeclared',
      executionMode: 'black-box-only',
    }),
    Object.freeze({
      id: 'relevance-zone',
      repository: 'rlglab/study-LD-RZ',
      revision: 'be5c678694b3d2326e9924dad4443e0910d52cdc',
      upstreamBranch: 'main',
      licenseStatus: 'undeclared',
      executionMode: 'black-box-only',
    }),
    Object.freeze({
      id: 'darkforest',
      repository: 'facebookresearch/darkforestGo',
      revision: 'ef1885ed5004dac8cbea2cbd3644706565af0876',
      upstreamBranch: 'master',
      licenseStatus: 'bsd-style',
      executionMode: 'native-permissive',
    }),
  ]);

export const reuseSpikeCandidateManifestEntry = (
  id: ReuseSpikeCandidateId,
): ReuseSpikeCandidateManifestEntry => {
  const entry = REUSE_SPIKE_CANDIDATE_MANIFEST.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown reuse-spike candidate: ${id}`);
  return entry;
};
