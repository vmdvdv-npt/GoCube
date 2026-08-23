import { describe, expect, it } from 'vitest';
import type {
  EndgameConfidenceResult,
  EndgamePositionConfidenceResult,
} from './EndgameConfidenceClassifier';
import {
  selectAutomaticEndgameStatus,
  selectAutomaticPositionStatuses,
} from './EndgameConfidenceAutoSelector';
import {
  DEFAULT_ENDGAME_CONFIDENCE_AUTO_SELECTION_POLICY,
  ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM,
} from './EndgameConfidenceAutoSelectionPolicy';
import { ENDGAME_CONFIDENCE_ALGORITHM } from './EndgameConfidencePolicy';
import {
  buildEngine2ConfidenceAutoSelectionCorpus,
  evaluateEngine2ConfidenceAutoSelectionCorpus,
  type Engine2ConfidenceAutoSelectionCorpusCase,
} from './testlab/Engine2ConfidenceAutoSelectionCorpus';
import { evaluateEngine2ConfidenceCorpus } from './testlab/Engine2ConfidenceCorpus';

const corpus = buildEngine2ConfidenceAutoSelectionCorpus();

const corpusCase = (id: string): Engine2ConfidenceAutoSelectionCorpusCase => {
  const found = corpus.find((item) => item.id === id);
  if (!found) throw new Error(`Missing E2-12c corpus case: ${id}`);
  return found;
};

const decision = (id: string) => {
  const fixture = corpusCase(id);
  return selectAutomaticEndgameStatus(fixture.result, fixture.options);
};

const selected = (id: string) => {
  const result = decision(id);
  if (result.outcome !== 'selected') throw new Error(`Expected selected result for ${id}`);
  return result;
};

const positionFrom = (results: readonly EndgameConfidenceResult[]): EndgamePositionConfidenceResult =>
  Object.freeze({
    algorithm: ENDGAME_CONFIDENCE_ALGORITHM,
    threshold: 0.9,
    results: Object.freeze([...results]),
    diagnostics: Object.freeze({
      graphBuilds: 1 as const,
      deepProofSearchInvocations: 0 as const,
      localizedEyeSearchInvocations: 0,
      localizedEyeExploredNodes: 0,
    }),
  });

describe('E2-12c EndgameConfidenceAutoSelector', () => {
  it('selects high, medium and low alive without turning low confidence into unresolved', () => {
    expect(selected('high-confidence-alive')).toMatchObject({ status: 'alive', confidenceBand: 'high', mode: 'confidence' });
    expect(selected('medium-confidence-alive')).toMatchObject({ status: 'alive', confidenceBand: 'medium', mode: 'confidence' });
    expect(selected('low-confidence-alive')).toMatchObject({ status: 'alive', confidenceBand: 'low', mode: 'confidence' });
  });

  it('selects dead whenever dead is the true maximum, including below the raw high-confidence threshold', () => {
    expect(selected('high-confidence-dead')).toMatchObject({ status: 'dead', confidenceBand: 'high' });
    expect(selected('low-confidence-dead')).toMatchObject({ status: 'dead', confidenceBand: 'low', rawLabel: 'unresolved' });
  });

  it('treats seki as a first-class max-score category without requiring strict proof', () => {
    expect(selected('high-confidence-seki')).toMatchObject({ status: 'seki', confidenceBand: 'high', mode: 'confidence' });
    expect(selected('medium-confidence-seki')).toMatchObject({ status: 'seki', confidenceBand: 'medium', mode: 'confidence' });
  });

  it('auto-selects all three statuses from raw unresolved results', () => {
    expect(selected('raw-unresolved-auto-alive')).toMatchObject({ rawLabel: 'unresolved', status: 'alive' });
    expect(selected('raw-unresolved-auto-dead')).toMatchObject({ rawLabel: 'unresolved', status: 'dead' });
    expect(selected('raw-unresolved-auto-seki')).toMatchObject({ rawLabel: 'unresolved', status: 'seki' });
  });

  it('uses the explicit alive > dead > seki policy only for exact equality', () => {
    expect(selected('exact-alive-dead-tie')).toMatchObject({
      status: 'alive', exactTie: true, tieBreakApplied: true, selectorReason: 'exact-tie-fallback:alive', margin: 0,
    });
    expect(selected('exact-dead-seki-tie')).toMatchObject({
      status: 'dead', exactTie: true, tieBreakApplied: true, selectorReason: 'exact-tie-fallback:dead', margin: 0,
    });
    expect(selected('exact-three-way-tie')).toMatchObject({
      status: 'alive', exactTie: true, tieBreakApplied: true, selectorReason: 'exact-tie-fallback:alive', margin: 0,
    });
    expect(DEFAULT_ENDGAME_CONFIDENCE_AUTO_SELECTION_POLICY.tieBreakOrder).toEqual(['alive', 'dead', 'seki']);
  });

  it('does not treat a near tie as a tie and selects the real maximum', () => {
    expect(selected('near-tie-real-max')).toMatchObject({
      status: 'alive', exactTie: false, tieBreakApplied: false, selectorReason: 'max-score-selected:alive', margin: 0.001,
    });
  });

  it('lets strict alive authority override a dead confidence winner', () => {
    expect(selected('strict-alive-overrides-dead-score')).toMatchObject({
      status: 'alive', mode: 'strict-proof', confidenceBand: 'high', selectedScore: 0.02,
    });
  });

  it('lets strict dead authority override an alive confidence winner', () => {
    expect(selected('strict-dead-overrides-alive-score')).toMatchObject({
      status: 'dead', mode: 'strict-proof', confidenceBand: 'high', selectedScore: 0.03,
    });
  });

  it('lets strict seki authority override an alternative confidence winner', () => {
    expect(selected('strict-seki-overrides-alive-score')).toMatchObject({
      status: 'seki', mode: 'strict-proof', confidenceBand: 'high', selectedScore: 0.04,
    });
  });

  it('uses strict proof evidence already embedded by E2-12b', () => {
    const base = corpusCase('high-confidence-dead').result;
    const withProof: EndgameConfidenceResult = Object.freeze({
      ...base,
      proofEvidence: Object.freeze([
        Object.freeze({
          label: 'alive' as const,
          algorithm: 'embedded-strict-alive-v1',
          source: 'provided' as const,
          evidence: Object.freeze({ certificate: 'test' }),
        }),
      ]),
    });
    const result = selectAutomaticEndgameStatus(withProof);
    expect(result).toMatchObject({ outcome: 'selected', status: 'alive', mode: 'strict-proof' });
  });

  it('fails contradictory strict authority closed instead of applying tie priority', () => {
    expect(decision('contradictory-strict-authority')).toMatchObject({
      outcome: 'technical-failure',
      failure: 'contradictory-strict-authority',
    });
  });

  it('keeps low confidence distinct from technical failure', () => {
    expect(decision('low-confidence-alive')).toMatchObject({ outcome: 'selected', confidenceBand: 'low' });
    expect(decision('contradictory-strict-authority')).toMatchObject({ outcome: 'technical-failure' });
  });

  it('rejects missing, NaN, infinite and out-of-range scores without clamping', () => {
    const base = corpusCase('low-confidence-alive').result;
    const invalidScores: readonly unknown[] = [
      Object.freeze({ alive: 0.5, dead: 0.4 }),
      Object.freeze({ alive: Number.NaN, dead: 0.4, seki: 0.1 }),
      Object.freeze({ alive: Number.POSITIVE_INFINITY, dead: 0, seki: 0 }),
      Object.freeze({ alive: -0.2, dead: 0.8, seki: 0.4 }),
      Object.freeze({ alive: 1.4, dead: 0, seki: 0 }),
    ];
    for (const badScores of invalidScores) {
      const malformed = Object.freeze({ ...base, scores: badScores });
      expect(selectAutomaticEndgameStatus(malformed)).toMatchObject({
        outcome: 'technical-failure', failure: 'invalid-input',
      });
    }
  });

  it('rejects invalid group identity and malformed raw label', () => {
    const base = corpusCase('low-confidence-alive').result;
    expect(selectAutomaticEndgameStatus(Object.freeze({ ...base, groupKey: '' }))).toMatchObject({
      outcome: 'technical-failure', failure: 'invalid-input',
    });
    expect(selectAutomaticEndgameStatus(Object.freeze({ ...base, label: 'maybe' }))).toMatchObject({
      outcome: 'technical-failure', failure: 'invalid-input',
    });
  });

  it('rejects malformed selector policy instead of silently changing tie semantics', () => {
    const malformedPolicy = Object.freeze({
      ...DEFAULT_ENDGAME_CONFIDENCE_AUTO_SELECTION_POLICY,
      tieBreakOrder: Object.freeze(['seki', 'seki', 'alive'] as const),
    });
    expect(selectAutomaticEndgameStatus(corpusCase('exact-three-way-tie').result, {
      policy: malformedPolicy,
    })).toMatchObject({ outcome: 'technical-failure', failure: 'invalid-policy' });
  });

  it('is byte-for-byte deterministic on repeated execution', () => {
    for (const fixture of corpus) {
      const first = selectAutomaticEndgameStatus(fixture.result, fixture.options);
      const second = selectAutomaticEndgameStatus(fixture.result, fixture.options);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }
  });

  it('does not mutate or reinterpret the E2-12b raw label', () => {
    const fixture = corpusCase('low-confidence-alive');
    const before = JSON.stringify(fixture.result);
    const result = selectAutomaticEndgameStatus(fixture.result, fixture.options);
    expect(result).toMatchObject({ rawLabel: 'unresolved', outcome: 'selected', status: 'alive' });
    expect(JSON.stringify(fixture.result)).toBe(before);
    expect(fixture.result.label).toBe('unresolved');
  });

  it('preserves the existing E2-12b 16-case raw corpus unchanged', () => {
    const evaluation = evaluateEngine2ConfidenceCorpus();
    expect(evaluation.totalCases).toBe(16);
    expect(evaluation.passedCases).toBe(16);
    expect(evaluation.failedCaseIds).toEqual([]);
  });

  it('passes the 20-case E2-12c designed corpus with 100% normal automatic coverage', () => {
    const evaluation = evaluateEngine2ConfidenceAutoSelectionCorpus();
    expect(evaluation).toMatchObject({
      corpusVersion: 'engine2-confidence-auto-selection-corpus-v1',
      totalCases: 20,
      validNormalCases: 19,
      automaticSelections: 19,
      technicalFailures: 1,
      strictSelections: 3,
      confidenceSelections: 16,
      highCount: 8,
      mediumCount: 2,
      lowCount: 9,
      exactTies: 3,
      rawUnresolvedCases: 12,
      rawUnresolvedSuccessfullyAutoSelected: 11,
      deterministicMismatches: 0,
      expectedStatusMatches: 19,
      expectedStatusMismatches: 0,
      designedCorpusAgreement: 20,
      automaticCoverage: 1,
      failedCaseIds: [],
    });
  });

  it('preserves Torus seam and Cube face-edge source classifications through selection', () => {
    expect(selected('torus19-seam-source-result')).toMatchObject({ status: 'alive', mode: 'confidence', confidenceBand: 'high' });
    expect(selected('cube5-face-edge-source-result')).toMatchObject({ status: 'alive', mode: 'confidence', confidenceBand: 'high' });
  });

  it('sorts position decisions deterministically without rebuilding graph or rerunning confidence analysis', () => {
    const a = corpusCase('raw-unresolved-auto-alive').result;
    const b = corpusCase('raw-unresolved-auto-dead').result;
    const c = corpusCase('raw-unresolved-auto-seki').result;
    const result = selectAutomaticPositionStatuses(positionFrom([c, a, b]));
    expect(result.selectorAlgorithm).toBe(ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM);
    expect(result.decisions.map((item) => item.groupKey)).toEqual(
      [a.groupKey, b.groupKey, c.groupKey].sort(),
    );
    expect(result.diagnostics).toMatchObject({
      sourceGraphBuilds: 1,
      sourceDeepProofSearchInvocations: 0,
      additionalGraphBuilds: 0,
      additionalConfidenceAnalyses: 0,
      deepProofSearchInvocations: 0,
      automaticSelections: 3,
      technicalFailures: 0,
    });
  });

  it('keeps a 36-group prepared position selector-only and fully auto-selected', () => {
    const base = corpusCase('raw-unresolved-auto-alive').result;
    const results = Object.freeze(Array.from({ length: 36 }, (_, index) => Object.freeze({
      ...base,
      groupKey: `prepared-group-${String(index).padStart(2, '0')}`,
      reasons: Object.freeze([`prepared-group:${index}`]),
    }) as EndgameConfidenceResult));
    const result = selectAutomaticPositionStatuses(positionFrom([...results].reverse()));
    expect(result.decisions).toHaveLength(36);
    expect(result.decisions.every((item) => item.outcome === 'selected')).toBe(true);
    expect(result.diagnostics).toMatchObject({
      automaticSelections: 36,
      technicalFailures: 0,
      additionalGraphBuilds: 0,
      additionalConfidenceAnalyses: 0,
      deepProofSearchInvocations: 0,
    });
    expect(result.decisions.map((item) => item.groupKey)).toEqual(
      [...result.decisions.map((item) => item.groupKey)].sort(),
    );
  });
});
