import {
  classifyGroupConfidence,
  type EndgameConfidenceFeatures,
  type EndgameConfidenceLabel,
  type EndgameConfidenceResult,
  type EndgameConfidenceScores,
  type EndgameResolvedConfidenceLabel,
} from '../EndgameConfidenceClassifier';
import {
  selectAutomaticEndgameStatus,
  type EndgameConfidenceAutoSelectionFailure,
  type EndgameConfidenceAutoSelectionMode,
  type EndgameConfidenceAutoSelectionOptions,
} from '../EndgameConfidenceAutoSelector';
import { ENDGAME_CONFIDENCE_ALGORITHM } from '../EndgameConfidencePolicy';
import type { EndgameConfidenceBand } from '../EndgameConfidenceAutoSelectionPolicy';
import { buildEndgameGraph } from '../EndgameGraphCore';
import { buildEngine2ConfidenceCorpus } from './Engine2ConfidenceCorpus';

export const ENGINE2_CONFIDENCE_AUTO_SELECTION_CORPUS_VERSION =
  'engine2-confidence-auto-selection-corpus-v1';

export interface Engine2ConfidenceAutoSelectionExpectation {
  readonly expectedRawLabel: EndgameConfidenceLabel;
  readonly expectedAutomaticStatus?: EndgameResolvedConfidenceLabel;
  readonly expectedMode?: EndgameConfidenceAutoSelectionMode;
  readonly expectedBand?: EndgameConfidenceBand;
  readonly expectedSelectorReason?: string;
  readonly expectedTechnicalFailure?: EndgameConfidenceAutoSelectionFailure;
}

export interface Engine2ConfidenceAutoSelectionCorpusCase {
  readonly id: string;
  readonly category:
    | 'alive'
    | 'dead'
    | 'seki'
    | 'raw-unresolved'
    | 'tie'
    | 'strict-precedence'
    | 'technical-conflict'
    | 'topology';
  readonly result: EndgameConfidenceResult;
  readonly options?: EndgameConfidenceAutoSelectionOptions;
  readonly validNormal: boolean;
  readonly expectation: Engine2ConfidenceAutoSelectionExpectation;
}

export interface Engine2ConfidenceAutoSelectionCorpusEvaluation {
  readonly corpusVersion: typeof ENGINE2_CONFIDENCE_AUTO_SELECTION_CORPUS_VERSION;
  readonly totalCases: number;
  readonly validNormalCases: number;
  readonly automaticSelections: number;
  readonly technicalFailures: number;
  readonly strictSelections: number;
  readonly confidenceSelections: number;
  readonly highCount: number;
  readonly mediumCount: number;
  readonly lowCount: number;
  readonly exactTies: number;
  readonly rawUnresolvedCases: number;
  readonly rawUnresolvedSuccessfullyAutoSelected: number;
  readonly deterministicMismatches: number;
  readonly expectedStatusMatches: number;
  readonly expectedStatusMismatches: number;
  readonly designedCorpusAgreement: number;
  readonly automaticCoverage: number;
  readonly failedCaseIds: readonly string[];
}

const featuresFor = (groupKey: string): EndgameConfidenceFeatures => Object.freeze({
  groupKey,
  color: 'black',
  stoneCount: 1,
  libertyCount: 4,
  immediateAtari: false,
  adjacentEmptyRegionCount: 1,
  adjacentOpenSpaceSize: 12,
  largestAdjacentRegionSize: 12,
  largestAdjacentRegionFraction: 0.1,
  largestRegionFrontierWidth: 3,
  expansionLibertyCount: 3,
  broadEscapeCount: 3,
  contestedLibertyCount: 0,
  contestedLibertyRatio: 0,
  directEnemyEdgeCount: 0,
  outwardEdgeCount: 4,
  directEnemyEdgeRatio: 0,
  nearestEnemyDistance: 6,
  enemyStoneCountWithinRadius: 0,
  enemyGroupCountWithinRadius: 0,
  localReachablePointCount: 12,
  localEnemyDensity: 0,
  friendlyConnectionCount: 0,
  sharedLibertyCount: 0,
  strictEyeRegionCount: 0,
  friendlyEyeRegionCount: 0,
  smallEyeEligible: false,
  smallEyeMinEyes: null,
  smallEyeMaxEyes: null,
  smallEyeComplete: false,
});

const rawResult = (
  id: string,
  label: EndgameConfidenceLabel,
  scores: EndgameConfidenceScores,
): EndgameConfidenceResult => Object.freeze({
  algorithm: ENDGAME_CONFIDENCE_ALGORITHM,
  groupKey: `auto-corpus:${id}`,
  label,
  scores: Object.freeze({ alive: scores.alive, dead: scores.dead, seki: scores.seki }),
  threshold: 0.9,
  features: featuresFor(`auto-corpus:${id}`),
  reasons: Object.freeze([`auto-selection-corpus:${id}`]),
  proofEvidence: Object.freeze([]),
  search: Object.freeze({
    deepProofSearchInvoked: false as const,
    localizedEyeSearchInvoked: false,
    localizedEyeExploredNodes: 0,
  }),
});

const strictProof = (
  label: EndgameResolvedConfidenceLabel,
  algorithm: string,
) => Object.freeze({ label, algorithm });

const scores = (alive: number, dead: number, seki: number): EndgameConfidenceScores =>
  Object.freeze({ alive, dead, seki });

const syntheticCase = (
  id: string,
  category: Engine2ConfidenceAutoSelectionCorpusCase['category'],
  rawLabel: EndgameConfidenceLabel,
  rawScores: EndgameConfidenceScores,
  expectation: Omit<Engine2ConfidenceAutoSelectionExpectation, 'expectedRawLabel'>,
  options?: EndgameConfidenceAutoSelectionOptions,
  validNormal = true,
): Engine2ConfidenceAutoSelectionCorpusCase => Object.freeze({
  id,
  category,
  result: rawResult(id, rawLabel, rawScores),
  options,
  validNormal,
  expectation: Object.freeze({ expectedRawLabel: rawLabel, ...expectation }),
});

const confidenceCorpusResult = (id: string): EndgameConfidenceResult => {
  const fixture = buildEngine2ConfidenceCorpus().find((item) => item.id === id);
  if (!fixture) throw new Error(`Missing E2-12b corpus fixture: ${id}`);
  const graph = buildEndgameGraph(fixture.state, fixture.topology);
  const groupKey = graph.pointOwner.get(fixture.targetPoint);
  if (!groupKey) throw new Error(`Missing E2-12b corpus target group: ${id}`);
  const result = classifyGroupConfidence(
    fixture.state,
    fixture.topology,
    groupKey,
    fixture.optionsForGroup?.(groupKey) ?? Object.freeze({}),
  );
  if (!result) throw new Error(`Missing E2-12b confidence result: ${id}`);
  return result;
};

export const buildEngine2ConfidenceAutoSelectionCorpus = ():
readonly Engine2ConfidenceAutoSelectionCorpusCase[] => Object.freeze([
  syntheticCase(
    'high-confidence-alive', 'alive', 'alive', scores(0.94, 0.03, 0.03),
    Object.freeze({ expectedAutomaticStatus: 'alive', expectedMode: 'confidence', expectedBand: 'high', expectedSelectorReason: 'max-score-selected:alive' }),
  ),
  syntheticCase(
    'medium-confidence-alive', 'alive', 'unresolved', scores(0.72, 0.18, 0.1),
    Object.freeze({ expectedAutomaticStatus: 'alive', expectedMode: 'confidence', expectedBand: 'medium', expectedSelectorReason: 'max-score-selected:alive' }),
  ),
  syntheticCase(
    'low-confidence-alive', 'alive', 'unresolved', scores(0.46, 0.43, 0.11),
    Object.freeze({ expectedAutomaticStatus: 'alive', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'max-score-selected:alive' }),
  ),
  syntheticCase(
    'high-confidence-dead', 'dead', 'dead', scores(0.03, 0.94, 0.03),
    Object.freeze({ expectedAutomaticStatus: 'dead', expectedMode: 'confidence', expectedBand: 'high', expectedSelectorReason: 'max-score-selected:dead' }),
  ),
  syntheticCase(
    'low-confidence-dead', 'dead', 'unresolved', scores(0.3, 0.62, 0.08),
    Object.freeze({ expectedAutomaticStatus: 'dead', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'max-score-selected:dead' }),
  ),
  syntheticCase(
    'high-confidence-seki', 'seki', 'seki', scores(0.03, 0.03, 0.94),
    Object.freeze({ expectedAutomaticStatus: 'seki', expectedMode: 'confidence', expectedBand: 'high', expectedSelectorReason: 'max-score-selected:seki' }),
  ),
  syntheticCase(
    'medium-confidence-seki', 'seki', 'unresolved', scores(0.15, 0.14, 0.71),
    Object.freeze({ expectedAutomaticStatus: 'seki', expectedMode: 'confidence', expectedBand: 'medium', expectedSelectorReason: 'max-score-selected:seki' }),
  ),
  syntheticCase(
    'raw-unresolved-auto-alive', 'raw-unresolved', 'unresolved', scores(0.54, 0.34, 0.12),
    Object.freeze({ expectedAutomaticStatus: 'alive', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'max-score-selected:alive' }),
  ),
  syntheticCase(
    'raw-unresolved-auto-dead', 'raw-unresolved', 'unresolved', scores(0.27, 0.55, 0.18),
    Object.freeze({ expectedAutomaticStatus: 'dead', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'max-score-selected:dead' }),
  ),
  syntheticCase(
    'raw-unresolved-auto-seki', 'raw-unresolved', 'unresolved', scores(0.28, 0.31, 0.41),
    Object.freeze({ expectedAutomaticStatus: 'seki', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'max-score-selected:seki' }),
  ),
  syntheticCase(
    'exact-alive-dead-tie', 'tie', 'unresolved', scores(0.4, 0.4, 0.2),
    Object.freeze({ expectedAutomaticStatus: 'alive', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'exact-tie-fallback:alive' }),
  ),
  syntheticCase(
    'exact-dead-seki-tie', 'tie', 'unresolved', scores(0.2, 0.4, 0.4),
    Object.freeze({ expectedAutomaticStatus: 'dead', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'exact-tie-fallback:dead' }),
  ),
  syntheticCase(
    'exact-three-way-tie', 'tie', 'unresolved', scores(0.33, 0.33, 0.33),
    Object.freeze({ expectedAutomaticStatus: 'alive', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'exact-tie-fallback:alive' }),
  ),
  syntheticCase(
    'near-tie-real-max', 'tie', 'unresolved', scores(0.46, 0.459, 0.081),
    Object.freeze({ expectedAutomaticStatus: 'alive', expectedMode: 'confidence', expectedBand: 'low', expectedSelectorReason: 'max-score-selected:alive' }),
  ),
  syntheticCase(
    'strict-alive-overrides-dead-score', 'strict-precedence', 'dead', scores(0.02, 0.97, 0.01),
    Object.freeze({ expectedAutomaticStatus: 'alive', expectedMode: 'strict-proof', expectedBand: 'high', expectedSelectorReason: 'strict-proof-selected:alive' }),
    Object.freeze({ strictProofEvidence: Object.freeze([strictProof('alive', 'corpus-strict-alive-v1')]) }),
  ),
  syntheticCase(
    'strict-dead-overrides-alive-score', 'strict-precedence', 'alive', scores(0.96, 0.03, 0.01),
    Object.freeze({ expectedAutomaticStatus: 'dead', expectedMode: 'strict-proof', expectedBand: 'high', expectedSelectorReason: 'strict-proof-selected:dead' }),
    Object.freeze({ strictProofEvidence: Object.freeze([strictProof('dead', 'corpus-strict-dead-v1')]) }),
  ),
  syntheticCase(
    'strict-seki-overrides-alive-score', 'strict-precedence', 'alive', scores(0.91, 0.05, 0.04),
    Object.freeze({ expectedAutomaticStatus: 'seki', expectedMode: 'strict-proof', expectedBand: 'high', expectedSelectorReason: 'strict-proof-selected:seki' }),
    Object.freeze({ strictProofEvidence: Object.freeze([strictProof('seki', 'corpus-strict-seki-v1')]) }),
  ),
  syntheticCase(
    'contradictory-strict-authority', 'technical-conflict', 'unresolved', scores(0.4, 0.35, 0.25),
    Object.freeze({ expectedTechnicalFailure: 'contradictory-strict-authority' }),
    Object.freeze({ strictProofEvidence: Object.freeze([
      strictProof('alive', 'corpus-conflicting-alive-v1'),
      strictProof('dead', 'corpus-conflicting-dead-v1'),
    ]) }),
    false,
  ),
  Object.freeze({
    id: 'torus19-seam-source-result',
    category: 'topology' as const,
    result: confidenceCorpusResult('torus19-seam-open-space'),
    validNormal: true,
    expectation: Object.freeze({
      expectedRawLabel: 'alive' as const,
      expectedAutomaticStatus: 'alive' as const,
      expectedMode: 'confidence' as const,
      expectedBand: 'high' as const,
      expectedSelectorReason: 'max-score-selected:alive',
    }),
  }),
  Object.freeze({
    id: 'cube5-face-edge-source-result',
    category: 'topology' as const,
    result: confidenceCorpusResult('cube5-face-edge-open-space'),
    validNormal: true,
    expectation: Object.freeze({
      expectedRawLabel: 'alive' as const,
      expectedAutomaticStatus: 'alive' as const,
      expectedMode: 'confidence' as const,
      expectedBand: 'high' as const,
      expectedSelectorReason: 'max-score-selected:alive',
    }),
  }),
]);

const agreesWithExpectation = (
  corpusCase: Engine2ConfidenceAutoSelectionCorpusCase,
): Readonly<{ agreement: boolean; statusMatch: boolean; deterministic: boolean }> => {
  const first = selectAutomaticEndgameStatus(corpusCase.result, corpusCase.options);
  const second = selectAutomaticEndgameStatus(corpusCase.result, corpusCase.options);
  const deterministic = JSON.stringify(first) === JSON.stringify(second);
  const expected = corpusCase.expectation;
  if (expected.expectedTechnicalFailure) {
    return Object.freeze({
      agreement: deterministic && first.outcome === 'technical-failure' && first.failure === expected.expectedTechnicalFailure,
      statusMatch: false,
      deterministic,
    });
  }
  const statusMatch = first.outcome === 'selected' && first.status === expected.expectedAutomaticStatus;
  return Object.freeze({
    agreement:
      deterministic &&
      first.outcome === 'selected' &&
      first.rawLabel === expected.expectedRawLabel &&
      first.status === expected.expectedAutomaticStatus &&
      first.mode === expected.expectedMode &&
      first.confidenceBand === expected.expectedBand &&
      first.selectorReason === expected.expectedSelectorReason,
    statusMatch,
    deterministic,
  });
};

export const evaluateEngine2ConfidenceAutoSelectionCorpus = ():
Engine2ConfidenceAutoSelectionCorpusEvaluation => {
  const cases = buildEngine2ConfidenceAutoSelectionCorpus();
  let automaticSelections = 0;
  let technicalFailures = 0;
  let strictSelections = 0;
  let confidenceSelections = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let exactTies = 0;
  let rawUnresolvedCases = 0;
  let rawUnresolvedSuccessfullyAutoSelected = 0;
  let deterministicMismatches = 0;
  let expectedStatusMatches = 0;
  let designedCorpusAgreement = 0;
  let normalAutomaticSelections = 0;
  const failedCaseIds: string[] = [];

  for (const corpusCase of cases) {
    const decision = selectAutomaticEndgameStatus(corpusCase.result, corpusCase.options);
    const check = agreesWithExpectation(corpusCase);
    if (!check.deterministic) deterministicMismatches += 1;
    if (check.statusMatch) expectedStatusMatches += 1;
    if (check.agreement) designedCorpusAgreement += 1;
    else failedCaseIds.push(corpusCase.id);
    if (corpusCase.result.label === 'unresolved') rawUnresolvedCases += 1;

    if (decision.outcome === 'technical-failure') {
      technicalFailures += 1;
      continue;
    }
    automaticSelections += 1;
    if (corpusCase.validNormal) normalAutomaticSelections += 1;
    if (decision.mode === 'strict-proof') strictSelections += 1;
    else confidenceSelections += 1;
    if (decision.confidenceBand === 'high') highCount += 1;
    else if (decision.confidenceBand === 'medium') mediumCount += 1;
    else lowCount += 1;
    if (decision.exactTie) exactTies += 1;
    if (decision.rawLabel === 'unresolved') rawUnresolvedSuccessfullyAutoSelected += 1;
  }

  const validNormalCases = cases.filter((corpusCase) => corpusCase.validNormal).length;
  return Object.freeze({
    corpusVersion: ENGINE2_CONFIDENCE_AUTO_SELECTION_CORPUS_VERSION,
    totalCases: cases.length,
    validNormalCases,
    automaticSelections,
    technicalFailures,
    strictSelections,
    confidenceSelections,
    highCount,
    mediumCount,
    lowCount,
    exactTies,
    rawUnresolvedCases,
    rawUnresolvedSuccessfullyAutoSelected,
    deterministicMismatches,
    expectedStatusMatches,
    expectedStatusMismatches: validNormalCases - expectedStatusMatches,
    designedCorpusAgreement,
    automaticCoverage: validNormalCases === 0 ? 1 : normalAutomaticSelections / validNormalCases,
    failedCaseIds: Object.freeze(failedCaseIds),
  });
};
