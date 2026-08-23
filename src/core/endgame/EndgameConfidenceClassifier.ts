import type { GameState } from '../game/types';
import type { Topology } from '../topology/Topology';
import {
  generateDeadCandidates,
  verifyDeadCandidate,
  type AutomaticDeadProof,
} from './AutomaticDeadProof';
import {
  generateSekiCandidates,
  verifySekiCandidate,
  type AutomaticSekiProof,
} from './AutomaticSekiProof';
import {
  BENSON_PASS_ALIVE_ALGORITHM,
  buildBensonPassAliveProof,
  provePassAlive,
  type BensonPassAliveProof,
} from './BensonPassAlive';
import {
  DEFAULT_ENDGAME_CONFIDENCE_POLICY,
  ENDGAME_CONFIDENCE_ALGORITHM,
  type EndgameConfidencePolicy,
} from './EndgameConfidencePolicy';
import {
  createEndgameConfidenceAnalysisContext,
  extractEndgameGroupStructuralFeatures,
  type EndgameConfidenceAnalysisContext,
  type EndgameGroupStructuralFeatures,
} from './EndgameGroupFeatureExtractor';
import { readOneLibertyTactics, type OneLibertyTacticalResult } from './OneLibertyTacticalReader';
import { analyzeSmallEyeSpace, type SmallEyeSpaceAnalysis } from './SmallEyeSpaceAnalyzer';

export type EndgameConfidenceLabel = 'alive' | 'dead' | 'seki' | 'unresolved';
export type EndgameResolvedConfidenceLabel = Exclude<EndgameConfidenceLabel, 'unresolved'>;

export interface EndgameConfidenceScores {
  readonly alive: number;
  readonly dead: number;
  readonly seki: number;
}

export interface EndgameConfidenceFeatures extends EndgameGroupStructuralFeatures {
  readonly smallEyeMinEyes: number | null;
  readonly smallEyeMaxEyes: number | null;
  readonly smallEyeComplete: boolean;
}

export interface EndgameConfidenceProofEvidence {
  readonly label: EndgameResolvedConfidenceLabel;
  readonly algorithm: string;
  readonly source: 'automatic' | 'provided';
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface EndgameProvidedConfidenceProof {
  readonly groupKey: string;
  readonly label: EndgameResolvedConfidenceLabel;
  readonly algorithm: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface EndgameConfidenceSearchDiagnostics {
  /** E2-12b never invokes the generic/global AND/OR proof tree itself. */
  readonly deepProofSearchInvoked: false;
  readonly localizedEyeSearchInvoked: boolean;
  readonly localizedEyeExploredNodes: number;
}

export interface EndgameConfidenceResult {
  readonly algorithm: typeof ENDGAME_CONFIDENCE_ALGORITHM;
  readonly groupKey: string;
  readonly label: EndgameConfidenceLabel;
  readonly scores: EndgameConfidenceScores;
  readonly threshold: number;
  readonly features: EndgameConfidenceFeatures;
  readonly reasons: readonly string[];
  readonly proofEvidence: readonly EndgameConfidenceProofEvidence[];
  readonly search: EndgameConfidenceSearchDiagnostics;
}

export interface EndgamePositionConfidenceResult {
  readonly algorithm: typeof ENDGAME_CONFIDENCE_ALGORITHM;
  readonly threshold: number;
  readonly results: readonly EndgameConfidenceResult[];
  readonly diagnostics: Readonly<{
    readonly graphBuilds: 1;
    readonly deepProofSearchInvocations: 0;
    readonly localizedEyeSearchInvocations: number;
    readonly localizedEyeExploredNodes: number;
  }>;
}

export interface EndgameConfidenceOptions {
  readonly threshold?: number;
  readonly policy?: EndgameConfidencePolicy;
  readonly providedProofEvidence?: readonly EndgameProvidedConfidenceProof[];
  readonly enableLocalizedEyeAnalysis?: boolean;
}

type AutomaticProof = BensonPassAliveProof | AutomaticDeadProof | OneLibertyTacticalResult | AutomaticSekiProof;

interface PreparedConfidenceContext {
  readonly analysis: EndgameConfidenceAnalysisContext;
  readonly automaticProofs: ReadonlyMap<string, readonly EndgameConfidenceProofEvidence[]>;
  readonly providedProofs: ReadonlyMap<string, readonly EndgameConfidenceProofEvidence[]>;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const roundScore = (value: number): number =>
  Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

const proofEvidence = (
  label: EndgameResolvedConfidenceLabel,
  source: 'automatic' | 'provided',
  algorithm: string,
  evidence: AutomaticProof | Readonly<Record<string, unknown>>,
): EndgameConfidenceProofEvidence =>
  Object.freeze({ label, source, algorithm, evidence: Object.freeze({ ...evidence }) });

const pushProof = (
  map: Map<string, EndgameConfidenceProofEvidence[]>,
  groupKey: string,
  evidence: EndgameConfidenceProofEvidence,
): void => {
  const current = map.get(groupKey) ?? [];
  current.push(evidence);
  map.set(groupKey, current);
};

const prepareAutomaticProofs = (
  analysis: EndgameConfidenceAnalysisContext,
): ReadonlyMap<string, readonly EndgameConfidenceProofEvidence[]> => {
  const proofs = new Map<string, EndgameConfidenceProofEvidence[]>();
  const aliveGroupKeys = new Set<string>();

  for (const color of ['black', 'white'] as const) {
    for (const [groupKey, vitalRegions] of provePassAlive(
      color,
      analysis.graph.groups,
      analysis.graph.emptyRegions,
    )) {
      aliveGroupKeys.add(groupKey);
      const evidence = buildBensonPassAliveProof(vitalRegions);
      pushProof(
        proofs,
        groupKey,
        proofEvidence('alive', 'automatic', BENSON_PASS_ALIVE_ALGORITHM, evidence),
      );
    }
  }

  const deadGroupKeys = new Set<string>();
  for (const candidate of generateDeadCandidates(analysis.graph.groups, aliveGroupKeys)) {
    const verification = verifyDeadCandidate(candidate, {
      state: analysis.state,
      topology: analysis.topology,
      groups: analysis.graph.groups,
      pointOwner: analysis.graph.pointOwner,
      passAliveGroupKeys: aliveGroupKeys,
    });
    if (!verification.proven) continue;
    deadGroupKeys.add(candidate.groupKey);
    pushProof(
      proofs,
      candidate.groupKey,
      proofEvidence('dead', 'automatic', verification.evidence.algorithm, verification.evidence),
    );
  }

  for (const group of [...analysis.graph.groups.values()].sort((left, right) =>
    compareStrings(left.key, right.key),
  )) {
    if (aliveGroupKeys.has(group.key) || deadGroupKeys.has(group.key) || group.liberties.length !== 1) {
      continue;
    }
    const tactical = readOneLibertyTactics(
      analysis.state,
      analysis.topology,
      analysis.graph,
      group.key,
    );
    if (tactical?.outcome !== 'proven-dead') continue;
    deadGroupKeys.add(group.key);
    pushProof(
      proofs,
      group.key,
      proofEvidence('dead', 'automatic', tactical.algorithm, tactical),
    );
  }

  const excluded = new Set<string>([...aliveGroupKeys, ...deadGroupKeys]);
  for (const candidate of generateSekiCandidates(analysis.graph.groups, excluded)) {
    const verification = verifySekiCandidate(candidate, {
      state: analysis.state,
      topology: analysis.topology,
      groups: analysis.graph.groups,
      pointOwner: analysis.graph.pointOwner,
    });
    if (!verification.proven) continue;
    for (const groupKey of candidate.groupKeys) {
      pushProof(
        proofs,
        groupKey,
        proofEvidence('seki', 'automatic', verification.evidence.algorithm, verification.evidence),
      );
    }
  }

  return new Map(
    [...proofs.entries()].map(([groupKey, entries]) => [
      groupKey,
      Object.freeze([...entries].sort((left, right) => {
        const label = compareStrings(left.label, right.label);
        return label !== 0 ? label : compareStrings(left.algorithm, right.algorithm);
      })),
    ]),
  );
};

const prepareProvidedProofs = (
  provided: readonly EndgameProvidedConfidenceProof[] | undefined,
): ReadonlyMap<string, readonly EndgameConfidenceProofEvidence[]> => {
  const result = new Map<string, EndgameConfidenceProofEvidence[]>();
  for (const item of provided ?? []) {
    if (!item.groupKey || !item.algorithm) {
      throw new Error('Provided confidence proof requires non-empty groupKey and algorithm');
    }
    pushProof(
      result,
      item.groupKey,
      proofEvidence(
        item.label,
        'provided',
        item.algorithm,
        item.evidence ?? Object.freeze({ algorithm: item.algorithm }),
      ),
    );
  }
  return new Map(
    [...result.entries()].map(([groupKey, entries]) => [
      groupKey,
      Object.freeze([...entries].sort((left, right) => {
        const label = compareStrings(left.label, right.label);
        return label !== 0 ? label : compareStrings(left.algorithm, right.algorithm);
      })),
    ]),
  );
};

const prepareContext = (
  state: GameState,
  topology: Topology,
  providedProofEvidence: readonly EndgameProvidedConfidenceProof[] | undefined,
): PreparedConfidenceContext => {
  const analysis = createEndgameConfidenceAnalysisContext(state, topology);
  return Object.freeze({
    analysis,
    automaticProofs: prepareAutomaticProofs(analysis),
    providedProofs: prepareProvidedProofs(providedProofEvidence),
  });
};

const isLargeOpenRegion = (
  features: EndgameGroupStructuralFeatures,
  policy: EndgameConfidencePolicy,
): boolean =>
  features.largestAdjacentRegionSize >= policy.largeOpenRegionPoints ||
  features.largestAdjacentRegionFraction >= policy.largeOpenRegionFraction;

const isVeryLargeOpenRegion = (
  features: EndgameGroupStructuralFeatures,
  policy: EndgameConfidencePolicy,
): boolean => features.largestAdjacentRegionFraction >= policy.veryLargeOpenRegionFraction;

const isNarrowBottleneck = (
  features: EndgameGroupStructuralFeatures,
  policy: EndgameConfidencePolicy,
): boolean =>
  isLargeOpenRegion(features, policy) &&
  features.largestRegionFrontierWidth <= policy.narrowFrontierMaximum &&
  features.broadEscapeCount < policy.broadEscapeCount;

const isEnclosed = (
  features: EndgameGroupStructuralFeatures,
  policy: EndgameConfidencePolicy,
): boolean =>
  features.directEnemyEdgeRatio >= policy.highDirectEnemyEdgeRatio &&
  features.broadEscapeCount < policy.broadEscapeCount;

const runLocalizedEyeAnalysis = (
  prepared: PreparedConfidenceContext,
  features: EndgameGroupStructuralFeatures,
  policy: EndgameConfidencePolicy,
  enabled: boolean,
  hasAuthoritativeProof: boolean,
): SmallEyeSpaceAnalysis | null => {
  if (!enabled || hasAuthoritativeProof || !features.smallEyeEligible) return null;
  return analyzeSmallEyeSpace(
    prepared.analysis.state,
    prepared.analysis.topology,
    features.groupKey,
    Object.freeze({
      maxRegionPoints: policy.smallEyeMaxRegionPoints,
      nodeBudget: policy.smallEyeNodeBudget,
    }),
  );
};

const evaluateHeuristicScores = (
  structural: EndgameGroupStructuralFeatures,
  eyeAnalysis: SmallEyeSpaceAnalysis | null,
  policy: EndgameConfidencePolicy,
): Readonly<{ scores: EndgameConfidenceScores; reasons: readonly string[] }> => {
  let alive = policy.baseScores.alive;
  let dead = policy.baseScores.dead;
  let seki = policy.baseScores.seki;
  const reasons: string[] = [];
  const largeOpenRegion = isLargeOpenRegion(structural, policy);
  const veryLargeOpenRegion = isVeryLargeOpenRegion(structural, policy);
  const narrowBottleneck = isNarrowBottleneck(structural, policy);
  const enclosed = isEnclosed(structural, policy);

  if (structural.libertyCount >= policy.largeLibertyCount) {
    alive += policy.aliveWeights.libertyLarge;
    reasons.push('large-liberty-set');
  }
  if (structural.libertyCount >= policy.veryLargeLibertyCount) {
    alive += policy.aliveWeights.libertyVeryLarge;
    reasons.push('very-large-liberty-set');
  }
  if (largeOpenRegion) {
    alive += policy.aliveWeights.openRegionLarge;
    reasons.push('large-adjacent-open-region');
  }
  if (veryLargeOpenRegion) {
    alive += policy.aliveWeights.openRegionVeryLarge;
    reasons.push('very-large-open-region');
  }
  if (structural.broadEscapeCount >= policy.broadEscapeCount) {
    alive += policy.aliveWeights.escapeBreadth;
    reasons.push('multiple-broad-escape-liberties');
  }
  if (structural.largestRegionFrontierWidth >= policy.broadEscapeCount) {
    alive += policy.aliveWeights.frontierBreadth;
    reasons.push('wide-open-region-frontier');
  }
  if (structural.nearestEnemyDistance === null || structural.nearestEnemyDistance >= policy.safeEnemyDistance) {
    alive += policy.aliveWeights.enemyFar;
    reasons.push('nearest-enemy-far');
  }
  if (structural.nearestEnemyDistance === null || structural.nearestEnemyDistance >= policy.remoteEnemyDistance) {
    alive += policy.aliveWeights.enemyRemote;
    reasons.push('nearest-enemy-remote');
  }
  if (
    structural.contestedLibertyRatio < policy.highContestedLibertyRatio &&
    structural.directEnemyEdgeRatio < policy.highDirectEnemyEdgeRatio &&
    structural.localEnemyDensity < policy.highLocalEnemyDensity
  ) {
    alive += policy.aliveWeights.lowPressure;
    reasons.push('low-local-enemy-pressure');
  }
  if (structural.friendlyConnectionCount > 0) {
    alive += policy.aliveWeights.friendlyConnection;
    reasons.push('friendly-connection-options');
  }
  if (eyeAnalysis?.complete && eyeAnalysis.minEyes >= 2) {
    alive += policy.aliveWeights.twoEyes;
    reasons.push('two-eye-local-analysis');
  }

  if (structural.immediateAtari) {
    dead += policy.deadWeights.atari;
    reasons.push('immediate-atari');
  }
  if (structural.libertyCount === 2) {
    dead += policy.deadWeights.twoLiberties;
    reasons.push('two-liberty-danger');
  }
  if (structural.contestedLibertyRatio >= policy.highContestedLibertyRatio) {
    dead += policy.deadWeights.contestedLiberties;
    reasons.push('high-contested-liberty-ratio');
  }
  if (structural.directEnemyEdgeRatio >= policy.highDirectEnemyEdgeRatio) {
    dead += policy.deadWeights.directEnemyContact;
    reasons.push('high-direct-enemy-contact');
  }
  if (structural.localEnemyDensity >= policy.highLocalEnemyDensity) {
    dead += policy.deadWeights.localEnemyPressure;
    reasons.push('high-local-enemy-pressure');
  }
  if (narrowBottleneck) {
    dead += policy.deadWeights.narrowBottleneck;
    reasons.push('narrow-open-region-bottleneck');
  }
  if (structural.broadEscapeCount === 0) {
    dead += policy.deadWeights.noBroadEscape;
    reasons.push('no-broad-escape');
  }
  if (!largeOpenRegion) {
    dead += policy.deadWeights.smallOpenSpace;
    reasons.push('small-adjacent-open-space');
  }

  if (structural.immediateAtari) {
    alive = Math.min(alive, policy.caps.atariAlive);
    reasons.push('alive-cap:atari');
  }
  if (structural.libertyCount === 2) {
    alive = Math.min(alive, policy.caps.twoLibertyAlive);
    reasons.push('alive-cap:two-liberties');
  }
  if (narrowBottleneck) {
    alive = Math.min(alive, policy.caps.narrowBottleneckAlive);
    reasons.push('alive-cap:narrow-bottleneck');
  }
  if (enclosed) {
    alive = Math.min(alive, policy.caps.enclosedAlive);
    reasons.push('alive-cap:local-enclosure');
  }
  if (largeOpenRegion && structural.broadEscapeCount >= policy.broadEscapeCount) {
    dead = Math.min(dead, policy.caps.broadEscapeDead);
    reasons.push('dead-cap:broad-open-escape');
  }
  if (structural.immediateAtari && structural.expansionLibertyCount > 0) {
    dead = Math.min(dead, policy.caps.expandingAtariDead);
    reasons.push('dead-cap:expandable-atari');
  }
  if (structural.libertyCount === 2 && structural.expansionLibertyCount > 0) {
    dead = Math.min(dead, policy.caps.expandingTwoLibertyDead);
    reasons.push('dead-cap:expandable-two-liberty-group');
  }

  return Object.freeze({
    scores: Object.freeze({
      alive: roundScore(alive),
      dead: roundScore(dead),
      seki: roundScore(seki),
    }),
    reasons: Object.freeze(reasons),
  });
};

const selectLabel = (
  scores: EndgameConfidenceScores,
  threshold: number,
  dominanceMargin: number,
): Readonly<{ label: EndgameConfidenceLabel; reason: string }> => {
  const ordered = (['alive', 'dead', 'seki'] as const)
    .map((label) => Object.freeze({ label, score: scores[label] }))
    .sort((left, right) => right.score - left.score || compareStrings(left.label, right.label));
  const above = ordered.filter((entry) => entry.score >= threshold);
  if (above.length > 1) return Object.freeze({ label: 'unresolved', reason: 'confidence-conflict' });
  if (above.length === 0) return Object.freeze({ label: 'unresolved', reason: 'below-threshold' });
  const winner = above[0]!;
  const runnerUp = ordered.find((entry) => entry.label !== winner.label)!;
  if (winner.score - runnerUp.score < dominanceMargin) {
    return Object.freeze({ label: 'unresolved', reason: 'insufficient-dominance' });
  }
  return Object.freeze({ label: winner.label, reason: `selected:${winner.label}` });
};

const classifyPreparedGroup = (
  prepared: PreparedConfidenceContext,
  groupKey: string,
  threshold: number,
  policy: EndgameConfidencePolicy,
  enableLocalizedEyeAnalysis: boolean,
): EndgameConfidenceResult | null => {
  const structural = extractEndgameGroupStructuralFeatures(prepared.analysis, groupKey, policy);
  if (!structural) return null;

  const proofs = Object.freeze([
    ...(prepared.automaticProofs.get(groupKey) ?? []),
    ...(prepared.providedProofs.get(groupKey) ?? []),
  ].sort((left, right) => {
    const label = compareStrings(left.label, right.label);
    if (label !== 0) return label;
    const source = compareStrings(left.source, right.source);
    return source !== 0 ? source : compareStrings(left.algorithm, right.algorithm);
  }));
  const eyeAnalysis = runLocalizedEyeAnalysis(
    prepared,
    structural,
    policy,
    enableLocalizedEyeAnalysis,
    proofs.length > 0,
  );
  const heuristic = evaluateHeuristicScores(structural, eyeAnalysis, policy);
  const proofLabels = new Set(proofs.map((proof) => proof.label));
  const scores: EndgameConfidenceScores = Object.freeze({
    alive: proofLabels.has('alive') ? 1 : heuristic.scores.alive,
    dead: proofLabels.has('dead') ? 1 : heuristic.scores.dead,
    seki: proofLabels.has('seki') ? 1 : heuristic.scores.seki,
  });
  const selection = selectLabel(scores, threshold, policy.dominanceMargin);
  const features: EndgameConfidenceFeatures = Object.freeze({
    ...structural,
    smallEyeMinEyes: eyeAnalysis?.minEyes ?? null,
    smallEyeMaxEyes: eyeAnalysis?.maxEyes ?? null,
    smallEyeComplete: eyeAnalysis?.complete ?? false,
  });
  const reasons = Object.freeze([
    ...proofs.map((proof) => `proof:${proof.label}:${proof.algorithm}`),
    ...heuristic.reasons,
    selection.reason,
  ]);

  return Object.freeze({
    algorithm: ENDGAME_CONFIDENCE_ALGORITHM,
    groupKey,
    label: selection.label,
    scores,
    threshold,
    features,
    reasons,
    proofEvidence: proofs,
    search: Object.freeze({
      deepProofSearchInvoked: false as const,
      localizedEyeSearchInvoked: eyeAnalysis !== null,
      localizedEyeExploredNodes: eyeAnalysis?.exploredNodes ?? 0,
    }),
  });
};

const resolveOptions = (
  options: EndgameConfidenceOptions,
): Readonly<{
  policy: EndgameConfidencePolicy;
  threshold: number;
  enableLocalizedEyeAnalysis: boolean;
}> => {
  const policy = options.policy ?? DEFAULT_ENDGAME_CONFIDENCE_POLICY;
  const threshold = options.threshold ?? policy.defaultThreshold;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Endgame confidence threshold must be in [0, 1]');
  }
  return Object.freeze({
    policy,
    threshold,
    enableLocalizedEyeAnalysis: options.enableLocalizedEyeAnalysis ?? true,
  });
};

export const classifyGroupConfidence = (
  state: GameState,
  topology: Topology,
  groupKey: string,
  options: EndgameConfidenceOptions = {},
): EndgameConfidenceResult | null => {
  const resolved = resolveOptions(options);
  const prepared = prepareContext(state, topology, options.providedProofEvidence);
  return classifyPreparedGroup(
    prepared,
    groupKey,
    resolved.threshold,
    resolved.policy,
    resolved.enableLocalizedEyeAnalysis,
  );
};

export const classifyPositionConfidence = (
  state: GameState,
  topology: Topology,
  options: EndgameConfidenceOptions = {},
): EndgamePositionConfidenceResult => {
  const resolved = resolveOptions(options);
  const prepared = prepareContext(state, topology, options.providedProofEvidence);
  const results = Object.freeze(
    [...prepared.analysis.graph.groups.keys()]
      .sort(compareStrings)
      .map((groupKey) =>
        classifyPreparedGroup(
          prepared,
          groupKey,
          resolved.threshold,
          resolved.policy,
          resolved.enableLocalizedEyeAnalysis,
        ),
      )
      .filter((result): result is EndgameConfidenceResult => result !== null),
  );

  return Object.freeze({
    algorithm: ENDGAME_CONFIDENCE_ALGORITHM,
    threshold: resolved.threshold,
    results,
    diagnostics: Object.freeze({
      graphBuilds: 1 as const,
      deepProofSearchInvocations: 0 as const,
      localizedEyeSearchInvocations: results.filter((result) => result.search.localizedEyeSearchInvoked).length,
      localizedEyeExploredNodes: results.reduce(
        (sum, result) => sum + result.search.localizedEyeExploredNodes,
        0,
      ),
    }),
  });
};
