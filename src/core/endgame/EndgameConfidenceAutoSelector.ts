import type {
  EndgameConfidenceLabel,
  EndgameConfidenceProofEvidence,
  EndgameConfidenceResult,
  EndgameConfidenceScores,
  EndgamePositionConfidenceResult,
  EndgameResolvedConfidenceLabel,
} from './EndgameConfidenceClassifier';
import { ENDGAME_CONFIDENCE_ALGORITHM } from './EndgameConfidencePolicy';
import {
  DEFAULT_ENDGAME_CONFIDENCE_AUTO_SELECTION_POLICY,
  ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM,
  type EndgameConfidenceAutoSelectionPolicy,
  type EndgameConfidenceBand,
} from './EndgameConfidenceAutoSelectionPolicy';

const STATUS_ORDER = Object.freeze(['alive', 'dead', 'seki'] as const);
const RAW_LABELS = Object.freeze(['alive', 'dead', 'seki', 'unresolved'] as const);

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isResolvedLabel = (value: unknown): value is EndgameResolvedConfidenceLabel =>
  typeof value === 'string' && (STATUS_ORDER as readonly string[]).includes(value);

const isRawLabel = (value: unknown): value is EndgameConfidenceLabel =>
  typeof value === 'string' && (RAW_LABELS as readonly string[]).includes(value);

const isScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const roundDiagnostic = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export interface EndgameConfidenceAutoStrictProof {
  readonly label: EndgameResolvedConfidenceLabel;
  readonly algorithm: string;
}

export interface EndgameConfidenceAutoSelectionOptions {
  readonly policy?: EndgameConfidenceAutoSelectionPolicy;
  /** Optional already-computed strict evidence not embedded in the E2-12b result. */
  readonly strictProofEvidence?: readonly EndgameConfidenceAutoStrictProof[];
}

export interface EndgameConfidenceAutoPositionSelectionOptions {
  readonly policy?: EndgameConfidenceAutoSelectionPolicy;
  readonly strictProofEvidenceByGroup?: Readonly<
    Record<string, readonly EndgameConfidenceAutoStrictProof[]>
  >;
}

export type EndgameConfidenceAutoSelectionMode = 'strict-proof' | 'confidence';
export type EndgameConfidenceAutoSelectionFailure =
  | 'invalid-input'
  | 'invalid-policy'
  | 'contradictory-strict-authority';

interface EndgameConfidenceAutoSelectionDiagnostics {
  readonly additionalGraphBuilds: 0;
  readonly additionalConfidenceAnalyses: 0;
  readonly deepProofSearchInvocations: 0;
}

export interface EndgameConfidenceAutoSelectedResult {
  readonly outcome: 'selected';
  readonly selectorAlgorithm: typeof ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM;
  readonly sourceAlgorithm: typeof ENDGAME_CONFIDENCE_ALGORITHM;
  readonly groupKey: string;
  readonly rawLabel: EndgameConfidenceLabel;
  readonly status: EndgameResolvedConfidenceLabel;
  readonly mode: EndgameConfidenceAutoSelectionMode;
  readonly confidenceBand: EndgameConfidenceBand;
  readonly selectedScore: number;
  readonly runnerUpScore: number;
  readonly margin: number;
  readonly scores: EndgameConfidenceScores;
  readonly exactTie: boolean;
  readonly tieBreakApplied: boolean;
  readonly selectorReason: string;
  readonly reasons: readonly string[];
  readonly sourceReasons: readonly string[];
  readonly strictProofAlgorithms: readonly string[];
  readonly diagnostics: EndgameConfidenceAutoSelectionDiagnostics;
}

export interface EndgameConfidenceAutoFailureResult {
  readonly outcome: 'technical-failure';
  readonly selectorAlgorithm: typeof ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM;
  readonly sourceAlgorithm: string | null;
  readonly groupKey: string | null;
  readonly rawLabel: EndgameConfidenceLabel | null;
  readonly failure: EndgameConfidenceAutoSelectionFailure;
  readonly reasons: readonly string[];
  readonly scores: EndgameConfidenceScores | null;
  readonly diagnostics: EndgameConfidenceAutoSelectionDiagnostics;
}

export type EndgameConfidenceAutoSelectionResult =
  | EndgameConfidenceAutoSelectedResult
  | EndgameConfidenceAutoFailureResult;

export interface EndgameConfidenceAutoPositionSelectionResult {
  readonly selectorAlgorithm: typeof ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM;
  readonly sourceAlgorithm: typeof ENDGAME_CONFIDENCE_ALGORITHM;
  readonly decisions: readonly EndgameConfidenceAutoSelectionResult[];
  readonly diagnostics: Readonly<{
    readonly sourceGraphBuilds: number;
    readonly sourceDeepProofSearchInvocations: number;
    readonly additionalGraphBuilds: 0;
    readonly additionalConfidenceAnalyses: 0;
    readonly deepProofSearchInvocations: 0;
    readonly automaticSelections: number;
    readonly technicalFailures: number;
    readonly strictSelections: number;
    readonly confidenceSelections: number;
    readonly highCount: number;
    readonly mediumCount: number;
    readonly lowCount: number;
    readonly exactTies: number;
    readonly rawUnresolvedCases: number;
    readonly rawUnresolvedAutoSelected: number;
  }>;
}

interface NormalizedInput {
  readonly sourceAlgorithm: typeof ENDGAME_CONFIDENCE_ALGORITHM;
  readonly groupKey: string;
  readonly rawLabel: EndgameConfidenceLabel;
  readonly scores: EndgameConfidenceScores;
  readonly sourceReasons: readonly string[];
  readonly embeddedProofs: readonly EndgameConfidenceAutoStrictProof[];
}

interface ProofParseResult {
  readonly proofs: readonly EndgameConfidenceAutoStrictProof[];
  readonly errors: readonly string[];
}

const EMPTY_DIAGNOSTICS: EndgameConfidenceAutoSelectionDiagnostics = Object.freeze({
  additionalGraphBuilds: 0 as const,
  additionalConfidenceAnalyses: 0 as const,
  deepProofSearchInvocations: 0 as const,
});

const copyScores = (scores: Record<string, unknown>): EndgameConfidenceScores | null => {
  const alive = scores.alive;
  const dead = scores.dead;
  const seki = scores.seki;
  if (!isScore(alive) || !isScore(dead) || !isScore(seki)) return null;
  return Object.freeze({ alive, dead, seki });
};

const parseProofArray = (value: unknown, prefix: string): ProofParseResult => {
  if (!Array.isArray(value)) {
    return Object.freeze({ proofs: Object.freeze([]), errors: Object.freeze([`${prefix}:not-array`]) });
  }
  const proofs: EndgameConfidenceAutoStrictProof[] = [];
  const errors: string[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`${prefix}:${index}:not-object`);
      return;
    }
    if (!isResolvedLabel(entry.label)) {
      errors.push(`${prefix}:${index}:invalid-label`);
      return;
    }
    if (typeof entry.algorithm !== 'string' || entry.algorithm.trim().length === 0) {
      errors.push(`${prefix}:${index}:invalid-algorithm`);
      return;
    }
    proofs.push(Object.freeze({ label: entry.label, algorithm: entry.algorithm }));
  });
  return Object.freeze({ proofs: Object.freeze(proofs), errors: Object.freeze(errors) });
};

const validatePolicy = (policy: EndgameConfidenceAutoSelectionPolicy): readonly string[] => {
  const errors: string[] = [];
  if (policy.algorithm !== ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM) {
    errors.push('policy:algorithm-mismatch');
  }
  if (!isScore(policy.highScoreThreshold)) errors.push('policy:invalid-high-threshold');
  if (!isScore(policy.mediumScoreThreshold)) errors.push('policy:invalid-medium-threshold');
  if (!isScore(policy.highDominanceMargin)) errors.push('policy:invalid-high-dominance-margin');
  if (
    isScore(policy.highScoreThreshold) &&
    isScore(policy.mediumScoreThreshold) &&
    policy.highScoreThreshold < policy.mediumScoreThreshold
  ) {
    errors.push('policy:high-threshold-below-medium');
  }
  const tieOrder = policy.tieBreakOrder;
  if (
    !Array.isArray(tieOrder) ||
    tieOrder.length !== STATUS_ORDER.length ||
    tieOrder.some((label) => !isResolvedLabel(label)) ||
    new Set(tieOrder).size !== STATUS_ORDER.length
  ) {
    errors.push('policy:invalid-tie-break-order');
  }
  return Object.freeze(errors);
};

const normalizeInput = (
  value: unknown,
): Readonly<{ input: NormalizedInput | null; errors: readonly string[] }> => {
  if (!isRecord(value)) {
    return Object.freeze({ input: null, errors: Object.freeze(['input:not-object']) });
  }

  const errors: string[] = [];
  if (value.algorithm !== ENDGAME_CONFIDENCE_ALGORITHM) errors.push('input:algorithm-mismatch');
  const groupKey = typeof value.groupKey === 'string' && value.groupKey.trim().length > 0
    ? value.groupKey
    : null;
  if (groupKey === null) errors.push('input:invalid-group-key');
  const rawLabel = isRawLabel(value.label) ? value.label : null;
  if (rawLabel === null) errors.push('input:invalid-raw-label');
  if (!isScore(value.threshold)) errors.push('input:invalid-threshold');

  const scores = isRecord(value.scores) ? copyScores(value.scores) : null;
  if (scores === null) errors.push('input:invalid-scores');

  let sourceReasons: readonly string[] = Object.freeze([]);
  if (!Array.isArray(value.reasons) || value.reasons.some((reason) => typeof reason !== 'string')) {
    errors.push('input:invalid-reasons');
  } else {
    sourceReasons = Object.freeze([...value.reasons] as string[]);
  }

  const parsedProofs = parseProofArray(value.proofEvidence, 'input-proof');
  errors.push(...parsedProofs.errors);

  if (errors.length > 0 || groupKey === null || rawLabel === null || scores === null) {
    return Object.freeze({ input: null, errors: Object.freeze(errors) });
  }

  return Object.freeze({
    input: Object.freeze({
      sourceAlgorithm: ENDGAME_CONFIDENCE_ALGORITHM,
      groupKey,
      rawLabel,
      scores,
      sourceReasons,
      embeddedProofs: parsedProofs.proofs,
    }),
    errors: Object.freeze([]),
  });
};

const failureResult = (
  value: unknown,
  failure: EndgameConfidenceAutoSelectionFailure,
  reasons: readonly string[],
): EndgameConfidenceAutoFailureResult => {
  const record = isRecord(value) ? value : null;
  const sourceAlgorithm = typeof record?.algorithm === 'string' ? record.algorithm : null;
  const groupKey = typeof record?.groupKey === 'string' && record.groupKey.trim().length > 0
    ? record.groupKey
    : null;
  const rawLabel = isRawLabel(record?.label) ? record.label : null;
  const scores = isRecord(record?.scores) ? copyScores(record.scores) : null;
  return Object.freeze({
    outcome: 'technical-failure' as const,
    selectorAlgorithm: ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM,
    sourceAlgorithm,
    groupKey,
    rawLabel,
    failure,
    reasons: Object.freeze([...reasons]),
    scores,
    diagnostics: EMPTY_DIAGNOSTICS,
  });
};

const combinedStrictProofs = (
  embedded: readonly EndgameConfidenceAutoStrictProof[],
  additional: readonly EndgameConfidenceAutoStrictProof[],
): readonly EndgameConfidenceAutoStrictProof[] => Object.freeze(
  [...embedded, ...additional].sort((left, right) => {
    const labelOrder = STATUS_ORDER.indexOf(left.label) - STATUS_ORDER.indexOf(right.label);
    return labelOrder !== 0 ? labelOrder : compareStrings(left.algorithm, right.algorithm);
  }),
);

const uniqueAlgorithms = (
  proofs: readonly EndgameConfidenceAutoStrictProof[],
  label: EndgameResolvedConfidenceLabel,
): readonly string[] => Object.freeze(
  [...new Set(proofs.filter((proof) => proof.label === label).map((proof) => proof.algorithm))]
    .sort(compareStrings),
);

const confidenceBand = (
  input: NormalizedInput,
  status: EndgameResolvedConfidenceLabel,
  selectedScore: number,
  margin: number,
  policy: EndgameConfidenceAutoSelectionPolicy,
): EndgameConfidenceBand => {
  if (input.rawLabel === status) return 'high';
  if (selectedScore >= policy.highScoreThreshold && margin >= policy.highDominanceMargin) return 'high';
  if (selectedScore >= policy.mediumScoreThreshold) return 'medium';
  return 'low';
};

const selectedResult = (
  input: NormalizedInput,
  status: EndgameResolvedConfidenceLabel,
  mode: EndgameConfidenceAutoSelectionMode,
  band: EndgameConfidenceBand,
  exactTie: boolean,
  selectorReason: string,
  strictProofAlgorithms: readonly string[],
): EndgameConfidenceAutoSelectedResult => {
  const selectedScore = input.scores[status];
  const runnerUpScore = Math.max(
    ...STATUS_ORDER.filter((label) => label !== status).map((label) => input.scores[label]),
  );
  const reasons = mode === 'strict-proof'
    ? Object.freeze([
        `strict-proof-selected:${status}`,
        ...strictProofAlgorithms.map((algorithm) => `strict-proof-algorithm:${algorithm}`),
      ])
    : Object.freeze([
        selectorReason,
        `confidence-band:${band}`,
        `raw-label:${input.rawLabel}`,
      ]);

  return Object.freeze({
    outcome: 'selected' as const,
    selectorAlgorithm: ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM,
    sourceAlgorithm: input.sourceAlgorithm,
    groupKey: input.groupKey,
    rawLabel: input.rawLabel,
    status,
    mode,
    confidenceBand: band,
    selectedScore,
    runnerUpScore,
    margin: roundDiagnostic(selectedScore - runnerUpScore),
    scores: input.scores,
    exactTie,
    tieBreakApplied: exactTie,
    selectorReason,
    reasons,
    sourceReasons: input.sourceReasons,
    strictProofAlgorithms,
    diagnostics: EMPTY_DIAGNOSTICS,
  });
};

export const selectAutomaticEndgameStatus = (
  result: EndgameConfidenceResult | unknown,
  options: EndgameConfidenceAutoSelectionOptions = {},
): EndgameConfidenceAutoSelectionResult => {
  const policy = options.policy ?? DEFAULT_ENDGAME_CONFIDENCE_AUTO_SELECTION_POLICY;
  const policyErrors = validatePolicy(policy);
  if (policyErrors.length > 0) return failureResult(result, 'invalid-policy', policyErrors);

  const normalized = normalizeInput(result);
  if (!normalized.input) return failureResult(result, 'invalid-input', normalized.errors);
  const input = normalized.input;

  const additionalProofs = parseProofArray(options.strictProofEvidence ?? [], 'additional-proof');
  if (additionalProofs.errors.length > 0) {
    return failureResult(result, 'invalid-input', additionalProofs.errors);
  }
  const proofs = combinedStrictProofs(input.embeddedProofs, additionalProofs.proofs);
  const strictLabels = STATUS_ORDER.filter((label) => proofs.some((proof) => proof.label === label));
  if (strictLabels.length > 1) {
    const algorithms = Object.freeze([...new Set(proofs.map((proof) => proof.algorithm))].sort(compareStrings));
    return failureResult(
      result,
      'contradictory-strict-authority',
      Object.freeze([
        `strict-authority-conflict:${strictLabels.join(',')}`,
        ...algorithms.map((algorithm) => `strict-proof-algorithm:${algorithm}`),
      ]),
    );
  }

  if (strictLabels.length === 1) {
    const status = strictLabels[0]!;
    return selectedResult(
      input,
      status,
      'strict-proof',
      'high',
      false,
      `strict-proof-selected:${status}`,
      uniqueAlgorithms(proofs, status),
    );
  }

  const maximum = Math.max(input.scores.alive, input.scores.dead, input.scores.seki);
  const tiedTop = STATUS_ORDER.filter((label) => input.scores[label] === maximum);
  const status = policy.tieBreakOrder.find((label) => tiedTop.includes(label));
  if (!status) {
    return failureResult(result, 'invalid-policy', Object.freeze(['policy:tie-break-cannot-select']));
  }
  const runnerUpScore = Math.max(
    ...STATUS_ORDER.filter((label) => label !== status).map((label) => input.scores[label]),
  );
  const margin = roundDiagnostic(input.scores[status] - runnerUpScore);
  const exactTie = tiedTop.length > 1;
  const selectorReason = exactTie
    ? `exact-tie-fallback:${status}`
    : `max-score-selected:${status}`;

  return selectedResult(
    input,
    status,
    'confidence',
    confidenceBand(input, status, input.scores[status], margin, policy),
    exactTie,
    selectorReason,
    Object.freeze([]),
  );
};

export const selectAutomaticPositionStatuses = (
  position: EndgamePositionConfidenceResult,
  options: EndgameConfidenceAutoPositionSelectionOptions = {},
): EndgameConfidenceAutoPositionSelectionResult => {
  const decisions = Object.freeze(
    [...position.results]
      .sort((left, right) => compareStrings(left.groupKey, right.groupKey))
      .map((result) => selectAutomaticEndgameStatus(result, Object.freeze({
        policy: options.policy,
        strictProofEvidence: options.strictProofEvidenceByGroup?.[result.groupKey] ?? Object.freeze([]),
      }))),
  );
  const selected = decisions.filter(
    (decision): decision is EndgameConfidenceAutoSelectedResult => decision.outcome === 'selected',
  );

  return Object.freeze({
    selectorAlgorithm: ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM,
    sourceAlgorithm: ENDGAME_CONFIDENCE_ALGORITHM,
    decisions,
    diagnostics: Object.freeze({
      sourceGraphBuilds: position.diagnostics.graphBuilds,
      sourceDeepProofSearchInvocations: position.diagnostics.deepProofSearchInvocations,
      additionalGraphBuilds: 0 as const,
      additionalConfidenceAnalyses: 0 as const,
      deepProofSearchInvocations: 0 as const,
      automaticSelections: selected.length,
      technicalFailures: decisions.length - selected.length,
      strictSelections: selected.filter((decision) => decision.mode === 'strict-proof').length,
      confidenceSelections: selected.filter((decision) => decision.mode === 'confidence').length,
      highCount: selected.filter((decision) => decision.confidenceBand === 'high').length,
      mediumCount: selected.filter((decision) => decision.confidenceBand === 'medium').length,
      lowCount: selected.filter((decision) => decision.confidenceBand === 'low').length,
      exactTies: selected.filter((decision) => decision.exactTie).length,
      rawUnresolvedCases: decisions.filter((decision) => decision.rawLabel === 'unresolved').length,
      rawUnresolvedAutoSelected: selected.filter((decision) => decision.rawLabel === 'unresolved').length,
    }),
  });
};

// Compile-time check that the embedded proof shape remains compatible with the selector's strict evidence view.
const _proofCompatibility: EndgameConfidenceAutoStrictProof | null = null as EndgameConfidenceProofEvidence | null;
void _proofCompatibility;
