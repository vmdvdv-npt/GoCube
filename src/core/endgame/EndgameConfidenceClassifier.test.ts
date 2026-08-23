import { describe, expect, it } from 'vitest';
import {
  classifyGroupConfidence,
  classifyPositionConfidence,
} from './EndgameConfidenceClassifier';
import { DEFAULT_ENDGAME_CONFIDENCE_POLICY } from './EndgameConfidencePolicy';
import { buildEndgameGraph } from './EndgameGraphCore';
import {
  buildEngine2ConfidenceCorpus,
  evaluateEngine2ConfidenceCorpus,
  type Engine2ConfidenceCorpusCase,
} from './testlab/Engine2ConfidenceCorpus';

const corpus = buildEngine2ConfidenceCorpus();

const corpusCase = (id: string): Engine2ConfidenceCorpusCase => {
  const found = corpus.find((item) => item.id === id);
  if (!found) throw new Error(`Missing confidence corpus case: ${id}`);
  return found;
};

const classifyCase = (id: string) => {
  const fixture = corpusCase(id);
  const graph = buildEndgameGraph(fixture.state, fixture.topology);
  const groupKey = graph.pointOwner.get(fixture.targetPoint);
  if (!groupKey) throw new Error(`Missing target group for ${id}`);
  const result = classifyGroupConfidence(
    fixture.state,
    fixture.topology,
    groupKey,
    fixture.optionsForGroup?.(groupKey) ?? {},
  );
  if (!result) throw new Error(`Missing confidence result for ${id}`);
  return Object.freeze({ fixture, graph, groupKey, result });
};

describe('E2-12b EndgameConfidenceClassifier', () => {
  it('classifies the primary sparse Torus 19x19 two-stone open-space group alive above 0.95', () => {
    const { result } = classifyCase('torus19-two-stone-open-space');
    expect(result.label).toBe('alive');
    expect(result.scores.alive).toBeGreaterThanOrEqual(0.95);
    expect(result.threshold).toBe(0.9);
    expect(result.reasons).toContain('large-adjacent-open-region');
    expect(result.reasons).toContain('multiple-broad-escape-liberties');
  });

  it('classifies an isolated sparse Torus 19x19 stone with remote enemy as high-confidence alive', () => {
    const { result } = classifyCase('torus19-isolated-open-space');
    expect(result.label).toBe('alive');
    expect(result.scores.alive).toBeGreaterThanOrEqual(0.9);
    expect(result.features.nearestEnemyDistance).toBeGreaterThanOrEqual(
      DEFAULT_ENDGAME_CONFIDENCE_POLICY.remoteEnemyDistance,
    );
  });

  it('does not auto-alive a group in immediate atari even when a huge empty region lies beyond the escape', () => {
    const { result } = classifyCase('torus19-expandable-atari');
    expect(result.label).toBe('unresolved');
    expect(result.scores.alive).toBeLessThan(0.9);
    expect(result.features.immediateAtari).toBe(true);
    expect(result.reasons).toContain('alive-cap:atari');
  });

  it('keeps a large region behind a narrow contested Torus exit below the alive threshold', () => {
    const { result } = classifyCase('torus19-narrow-contested-exit');
    expect(result.label).toBe('unresolved');
    expect(result.scores.alive).toBeLessThan(0.9);
    expect(result.features.largestAdjacentRegionSize).toBeGreaterThan(
      DEFAULT_ENDGAME_CONFIDENCE_POLICY.largeOpenRegionPoints,
    );
    expect(result.features.largestRegionFrontierWidth).toBeLessThanOrEqual(
      DEFAULT_ENDGAME_CONFIDENCE_POLICY.narrowFrontierMaximum,
    );
    expect(result.reasons).toContain('alive-cap:narrow-bottleneck');
  });

  it('assigns maximal dead confidence to an enclosed one-liberty group with an existing strict proof', () => {
    const { result } = classifyCase('one-liberty-strict-dead');
    expect(result.label).toBe('dead');
    expect(result.scores.dead).toBe(1);
    expect(result.proofEvidence.some((proof) => proof.label === 'dead')).toBe(true);
  });

  it('assigns maximal alive confidence to a Benson/pass-alive group', () => {
    const { result } = classifyCase('benson-two-vital-regions');
    expect(result.label).toBe('alive');
    expect(result.scores.alive).toBe(1);
    expect(result.proofEvidence).toContainEqual(
      expect.objectContaining({ label: 'alive', algorithm: 'benson-pass-alive-v1' }),
    );
  });

  it('preserves the existing strict one-liberty dead evidence as authoritative confidence', () => {
    const { result } = classifyCase('one-liberty-strict-dead');
    expect(result.proofEvidence).toContainEqual(
      expect.objectContaining({ label: 'dead', algorithm: 'one-liberty-tactical-reader-v1' }),
    );
    expect(result.scores.dead).toBe(1);
  });

  it('assigns maximal seki confidence only when the existing strict seki certificate is present', () => {
    for (const id of ['strict-seki-black', 'strict-seki-white']) {
      const { result } = classifyCase(id);
      expect(result.label).toBe('seki');
      expect(result.scores.seki).toBe(1);
      expect(result.proofEvidence).toContainEqual(
        expect.objectContaining({ label: 'seki', algorithm: 'closed-mutual-two-liberties-seki-v1' }),
      );
    }
  });

  it('leaves an ambiguous three-liberty contact fight unresolved', () => {
    const { result } = classifyCase('ambiguous-three-liberty-contact');
    expect(result.label).toBe('unresolved');
    expect(Math.max(result.scores.alive, result.scores.dead, result.scores.seki)).toBeLessThan(0.9);
  });

  it('treats Torus seam connectivity as ordinary graph adjacency', () => {
    const { result } = classifyCase('torus19-seam-open-space');
    expect(result.features.stoneCount).toBe(2);
    expect(result.label).toBe('alive');
    expect(result.scores.alive).toBeGreaterThanOrEqual(0.9);
  });

  it('treats Cube face-edge connectivity as ordinary graph adjacency', () => {
    const { result } = classifyCase('cube5-face-edge-open-space');
    expect(result.features.stoneCount).toBe(2);
    expect(result.label).toBe('alive');
    expect(result.scores.alive).toBeGreaterThanOrEqual(0.9);
  });

  it('is byte-for-byte deterministic for scores, features, reasons and evidence', () => {
    const first = classifyCase('torus19-two-stone-open-space');
    const second = classifyCase('torus19-two-stone-open-space');
    expect(JSON.stringify(second.result)).toBe(JSON.stringify(first.result));
  });

  it('fails conflicting high-confidence evidence closed instead of using iteration order', () => {
    const { result } = classifyCase('contradictory-provided-proofs');
    expect(result.scores.alive).toBe(1);
    expect(result.scores.dead).toBe(1);
    expect(result.label).toBe('unresolved');
    expect(result.reasons).toContain('confidence-conflict');
  });

  it('does not invoke deep proof search for the sparse Torus 19x19 acceptance case', () => {
    const { result } = classifyCase('torus19-two-stone-open-space');
    expect(result.search.deepProofSearchInvoked).toBe(false);
    expect(result.search.localizedEyeSearchInvoked).toBe(false);
    expect(result.search.localizedEyeExploredNodes).toBe(0);
  });

  it('whole-position classification reuses one graph and agrees with per-group classification', () => {
    const fixture = corpusCase('torus19-two-stone-open-space');
    const whole = classifyPositionConfidence(fixture.state, fixture.topology);
    expect(whole.diagnostics.graphBuilds).toBe(1);
    expect(whole.diagnostics.deepProofSearchInvocations).toBe(0);
    expect(whole.results.length).toBeGreaterThan(1);

    for (const result of whole.results) {
      const perGroup = classifyGroupConfidence(fixture.state, fixture.topology, result.groupKey);
      expect(perGroup).toEqual(result);
    }
  });

  it('passes the deterministic 16-case confidence corpus with meaningful score ranges', () => {
    const evaluation = evaluateEngine2ConfidenceCorpus();
    expect(evaluation.totalCases).toBe(16);
    expect(evaluation.passedCases).toBe(16);
    expect(evaluation.failedCaseIds).toEqual([]);
    expect(evaluation.labelCounts.alive).toBeGreaterThanOrEqual(7);
    expect(evaluation.labelCounts.dead).toBeGreaterThanOrEqual(1);
    expect(evaluation.labelCounts.seki).toBe(2);
    expect(evaluation.labelCounts.unresolved).toBeGreaterThanOrEqual(4);
  });
});
