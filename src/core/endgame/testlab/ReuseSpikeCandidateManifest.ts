import type { ReuseSpikeCandidateId } from './ReuseSpikeBenchmark';

export type ReuseSpikeLicenseStatus = 'apache-2.0' | 'bsd-style' | 'undeclared';
export type ReuseSpikeExecutionMode =
  | 'in-process-permissive'
  | 'black-box-only'
  | 'native-permissive';

export type ReuseSpikeExecutionArtifact =
  | Readonly<{
      kind: 'npm-package';
      packageName: string;
      version: string;
      integrity: string;
      shasum: string;
    }>
  | Readonly<{
      kind: 'source-build';
      dependencyLock?: Readonly<{
        path: string;
        blobSha: string;
      }>;
    }>
  | Readonly<{
      kind: 'container-source-build';
      image: string;
      digest: string;
    }>;

export interface ReuseSpikeCandidateManifestEntry {
  readonly id: ReuseSpikeCandidateId;
  readonly repository: string;
  readonly revision: string;
  readonly upstreamBranch: string;
  readonly licenseStatus: ReuseSpikeLicenseStatus;
  readonly executionMode: ReuseSpikeExecutionMode;
  readonly executionArtifact: ReuseSpikeExecutionArtifact;
}

const sourceBuild = (
  dependencyLock?: Readonly<{ path: string; blobSha: string }>,
): ReuseSpikeExecutionArtifact =>
  Object.freeze({
    kind: 'source-build' as const,
    ...(dependencyLock === undefined
      ? {}
      : { dependencyLock: Object.freeze({ ...dependencyLock }) }),
  });

/**
 * Immutable Work 1 upstream snapshot. Benchmark numbers are meaningful only
 * when they can be traced to both an exact source revision and the executable
 * artifact/build boundary used for that candidate.
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
      executionArtifact: Object.freeze({
        kind: 'npm-package' as const,
        packageName: 'tsumego.js',
        version: '1.1.0',
        integrity:
          'sha512-W/MQDhaMKiM15wd8YRjonXgZm+T1YxZRhavvv0sDPDywEidgDzN8s5Jum/aU0GIruGz5L/GDygn2/TQ34+btcg==',
        shasum: 'bf82348af36f919d4942a5746eb49506a789b8e3',
      }),
    }),
    Object.freeze({
      id: 'cameron-martin',
      repository: 'cameron-martin/tsumego-solver',
      revision: '7408523ae34d9f890eef08d7f39fae683dee1a4e',
      upstreamBranch: 'master',
      licenseStatus: 'undeclared',
      executionMode: 'black-box-only',
      executionArtifact: sourceBuild({
        path: 'Cargo.lock',
        blobSha: 'bc18b817de7811efa91be5d16ebd95d703948faf',
      }),
    }),
    Object.freeze({
      id: 'relevance-zone',
      repository: 'rlglab/study-LD-RZ',
      revision: 'be5c678694b3d2326e9924dad4443e0910d52cdc',
      upstreamBranch: 'main',
      licenseStatus: 'undeclared',
      executionMode: 'black-box-only',
      executionArtifact: Object.freeze({
        kind: 'container-source-build' as const,
        image: 'rockmanray/gorzone',
        digest: 'sha256:1d1b6babbd6c5978c14394aad16aeffcff3106eb78574ee8a577bbeec596849f',
      }),
    }),
    Object.freeze({
      id: 'darkforest',
      repository: 'facebookresearch/darkforestGo',
      revision: 'ef1885ed5004dac8cbea2cbd3644706565af0876',
      upstreamBranch: 'master',
      licenseStatus: 'bsd-style',
      executionMode: 'native-permissive',
      executionArtifact: sourceBuild(),
    }),
  ]);

export const reuseSpikeCandidateManifestEntry = (
  id: ReuseSpikeCandidateId,
): ReuseSpikeCandidateManifestEntry => {
  const entry = REUSE_SPIKE_CANDIDATE_MANIFEST.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown reuse-spike candidate: ${id}`);
  return entry;
};
