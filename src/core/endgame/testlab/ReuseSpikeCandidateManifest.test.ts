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
});
