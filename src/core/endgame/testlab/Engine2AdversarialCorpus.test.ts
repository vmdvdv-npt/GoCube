import { describe, expect, it } from 'vitest';
import {
  ENGINE2_ADVERSARIAL_CORPUS_VERSION,
  runEngine2AdversarialCorpus,
} from './Engine2AdversarialCorpus';

describe('Engine 2 E2-11 adversarial corpus', () => {
  it('passes the fixed final-evaluation corpus with zero false authoritative conclusions', () => {
    const evaluation = runEngine2AdversarialCorpus();

    expect(evaluation.corpusVersion).toBe(ENGINE2_ADVERSARIAL_CORPUS_VERSION);
    expect(evaluation.totalCases).toBe(18);
    expect(evaluation.passedCases).toBe(evaluation.totalCases);
    expect(evaluation.failedCaseIds).toEqual([]);
    expect(evaluation.falseAuthoritativeConclusions).toBe(0);
    expect(evaluation.authoritativePositiveCases).toBeGreaterThanOrEqual(6);
    expect(evaluation.failClosedCases).toBeGreaterThanOrEqual(6);
    expect(evaluation.totalExploredNodes).toBeGreaterThan(0);
    expect(evaluation.transpositionHits).toBeGreaterThan(0);
  });

  it('covers every Engine 2 proof layer and explicit topology/core boundaries', () => {
    const evaluation = runEngine2AdversarialCorpus();
    const categories = new Set(evaluation.observations.map((entry) => entry.category));

    expect(categories).toEqual(
      new Set([
        'one-liberty',
        'two-liberty',
        'three-liberty',
        'four-liberty',
        'eye-space',
        'tactical-extension',
        'semeai-seki',
        'topology',
        'and-or-core',
      ]),
    );
  });

  it('keeps all adversarial boundary cases non-authoritative', () => {
    const evaluation = runEngine2AdversarialCorpus();
    const boundaryCases = evaluation.observations.filter((entry) => entry.mustNotProve);

    expect(boundaryCases.map((entry) => entry.id).sort()).toEqual([
      'and-or-budget-exhaustion-propagates',
      'and-or-incomplete-defender-universal-proof-blocked',
      'one-liberty-unknown-root-ko',
      'seki-third-group-boundary',
      'small-eye-budget-fail-closed',
      'three-liberty-incomplete-attack-boundary',
      'two-liberty-remote-root-ko',
    ]);
    expect(evaluation.falseAuthoritativeConclusions).toBe(0);
  });

  it('is deterministic byte-for-byte across repeated corpus runs', () => {
    const first = runEngine2AdversarialCorpus();
    const second = runEngine2AdversarialCorpus();

    expect(second).toEqual(first);
  });
});
