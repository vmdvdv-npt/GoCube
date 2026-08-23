import { describe, expect, it } from 'vitest';
import { REUSE_SPIKE_CANDIDATES } from './ReuseSpikeBenchmarkSuite';
import {
  REUSE_SPIKE_CANDIDATE_MANIFEST,
  reuseSpikeCandidateManifestEntry,
} from './ReuseSpikeCandidateManifest';

describe('ReuseSpikeCandidateManifest', () => {
  it('pins exactly one immutable upstream revision for every benchmark candidate', () => {
    expect(REUSE_SPIKE_CANDIDATE_MANIFEST.map(({ id }) => id)).toEqual(REUSE_SPIKE_CANDIDATES);
    expect(new Set(REUSE_SPIKE_CANDIDATE_MANIFEST.map(({ revision }) => revision)).size).toBe(
      REUSE_SPIKE_CANDIDATE_MANIFEST.length,
    );

    for (const entry of REUSE_SPIKE_CANDIDATE_MANIFEST) {
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.repository).toMatch(/^[^/]+\/[^/]+$/);
      expect(Object.isFrozen(entry.executionArtifact)).toBe(true);
      expect(reuseSpikeCandidateManifestEntry(entry.id)).toBe(entry);
    }
  });

  it('keeps unlicensed upstreams black-box only', () => {
    const unlicensed = REUSE_SPIKE_CANDIDATE_MANIFEST.filter(
      ({ licenseStatus }) => licenseStatus === 'undeclared',
    );

    expect(unlicensed.map(({ id }) => id)).toEqual(['cameron-martin', 'relevance-zone']);
    expect(unlicensed.every(({ executionMode }) => executionMode === 'black-box-only')).toBe(true);
  });

  it('keeps permissive candidates explicitly separated from black-box-only candidates', () => {
    expect(reuseSpikeCandidateManifestEntry('tsumego-js')).toMatchObject({
      licenseStatus: 'apache-2.0',
      executionMode: 'in-process-permissive',
    });
    expect(reuseSpikeCandidateManifestEntry('darkforest')).toMatchObject({
      licenseStatus: 'bsd-style',
      executionMode: 'native-permissive',
    });
  });

  it('pins the published tsumego.js executable artifact independently from source', () => {
    expect(reuseSpikeCandidateManifestEntry('tsumego-js').executionArtifact).toEqual({
      kind: 'npm-package',
      packageName: 'tsumego.js',
      version: '1.1.0',
      integrity:
        'sha512-W/MQDhaMKiM15wd8YRjonXgZm+T1YxZRhavvv0sDPDywEidgDzN8s5Jum/aU0GIruGz5L/GDygn2/TQ34+btcg==',
      shasum: 'bf82348af36f919d4942a5746eb49506a789b8e3',
    });
  });

  it('pins black-box/native build boundaries for the remaining solvers', () => {
    expect(reuseSpikeCandidateManifestEntry('cameron-martin').executionArtifact).toEqual({
      kind: 'source-build',
      dependencyLock: {
        path: 'Cargo.lock',
        blobSha: 'bc18b817de7811efa91be5d16ebd95d703948faf',
      },
    });

    expect(reuseSpikeCandidateManifestEntry('relevance-zone').executionArtifact).toEqual({
      kind: 'container-source-build',
      image: 'rockmanray/gorzone',
      digest: 'sha256:1d1b6babbd6c5978c14394aad16aeffcff3106eb78574ee8a577bbeec596849f',
    });

    expect(reuseSpikeCandidateManifestEntry('darkforest').executionArtifact).toEqual({
      kind: 'source-build',
    });
  });
});
