import type { GameState } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import type {
  EndgameAnalysisContext,
  EndgameClassifier,
  EndgameEvidence,
  EndgameGroupProposal,
  EndgameProposal,
} from './EndgameClassifier';
import {
  classifyPositionConfidence,
  type EndgamePositionConfidenceResult,
} from './EndgameConfidenceClassifier';
import {
  selectAutomaticPositionStatuses,
  type EndgameConfidenceAutoPositionSelectionResult,
  type EndgameConfidenceAutoSelectionResult,
} from './EndgameConfidenceAutoSelector';
import {
  canonicalizeEndgameGroup,
  endgameGroupId,
} from './EndgameGroupIdentity';

export const CONFIDENCE_AUTO_ENDGAME_CLASSIFIER_ALGORITHM =
  'engine2-confidence-auto-endgame-classifier-v1';

export interface ConfidenceAutoEndgameClassifierDependencies {
  readonly classifyPosition: (
    state: GameState,
    topology: Topology,
  ) => EndgamePositionConfidenceResult;
  readonly selectPosition: (
    position: EndgamePositionConfidenceResult,
  ) => EndgameConfidenceAutoPositionSelectionResult;
}

const DEFAULT_DEPENDENCIES: ConfidenceAutoEndgameClassifierDependencies = Object.freeze({
  classifyPosition: classifyPositionConfidence,
  selectPosition: selectAutomaticPositionStatuses,
});

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const copyScores = (
  scores: Readonly<{ alive: number; dead: number; seki: number }> | null,
): Readonly<{ alive: number; dead: number; seki: number }> | null =>
  scores ? Object.freeze({ alive: scores.alive, dead: scores.dead, seki: scores.seki }) : null;

const selectionEvidence = (
  decision: EndgameConfidenceAutoSelectionResult,
  position: EndgamePositionConfidenceResult,
  selection: EndgameConfidenceAutoPositionSelectionResult,
): EndgameEvidence => {
  const shared = {
    algorithm: selection.selectorAlgorithm,
    adapterAlgorithm: CONFIDENCE_AUTO_ENDGAME_CLASSIFIER_ALGORITHM,
    sourceAlgorithm: decision.sourceAlgorithm,
    outcome: decision.outcome,
    rawLabel: decision.rawLabel,
    scores: copyScores(decision.scores),
    analysisDiagnostics: Object.freeze({
      sourceGraphBuilds: selection.diagnostics.sourceGraphBuilds,
      sourceDeepProofSearchInvocations: selection.diagnostics.sourceDeepProofSearchInvocations,
      additionalGraphBuilds: selection.diagnostics.additionalGraphBuilds,
      additionalConfidenceAnalyses: selection.diagnostics.additionalConfidenceAnalyses,
      selectorDeepProofSearchInvocations: selection.diagnostics.deepProofSearchInvocations,
      confidenceGraphBuilds: position.diagnostics.graphBuilds,
      confidenceDeepProofSearchInvocations: position.diagnostics.deepProofSearchInvocations,
    }),
  } as const;

  if (decision.outcome === 'technical-failure') {
    return Object.freeze({
      ...shared,
      failure: decision.failure,
      reasons: Object.freeze([...decision.reasons]),
    });
  }

  return Object.freeze({
    ...shared,
    selectedStatus: decision.status,
    mode: decision.mode,
    confidenceBand: decision.confidenceBand,
    selectedScore: decision.selectedScore,
    runnerUpScore: decision.runnerUpScore,
    margin: decision.margin,
    exactTie: decision.exactTie,
    tieBreakApplied: decision.tieBreakApplied,
    selectorReason: decision.selectorReason,
    reasons: Object.freeze([...decision.reasons]),
    sourceReasons: Object.freeze([...decision.sourceReasons]),
    strictProofAlgorithms: Object.freeze([...decision.strictProofAlgorithms]),
  });
};

export const mapConfidenceAutoSelectionToEndgameProposal = (
  groups: readonly (readonly PointId[])[],
  position: EndgamePositionConfidenceResult,
  selection: EndgameConfidenceAutoPositionSelectionResult,
): EndgameProposal => {
  const groupsById = new Map<string, readonly PointId[]>();
  for (const inputGroup of groups) {
    const points = canonicalizeEndgameGroup(inputGroup);
    if (points.length === 0) throw new Error('Confidence auto endgame group must contain points');
    const id = endgameGroupId(points);
    if (groupsById.has(id)) throw new Error(`Duplicate confidence auto endgame group: ${id}`);
    groupsById.set(id, points);
  }

  const proposals: EndgameGroupProposal[] = [];
  const seen = new Set<string>();
  for (const decision of selection.decisions) {
    const groupKey = decision.groupKey;
    if (!groupKey) {
      throw new Error('Confidence auto selector returned a decision without canonical group identity');
    }
    const points = groupsById.get(groupKey);
    if (!points) throw new Error(`Confidence auto selector returned unknown group: ${groupKey}`);
    if (seen.has(groupKey)) {
      throw new Error(`Confidence auto selector returned duplicate group: ${groupKey}`);
    }
    seen.add(groupKey);

    proposals.push(Object.freeze({
      points,
      status: decision.outcome === 'selected' ? decision.status : 'unresolved',
      source: 'automatic' as const,
      evidence: selectionEvidence(decision, position, selection),
    }));
  }

  if (seen.size !== groupsById.size) {
    const missing = [...groupsById.keys()]
      .filter((groupKey) => !seen.has(groupKey))
      .sort(compareStrings);
    throw new Error(`Confidence auto selector omitted endgame groups: ${missing.join(',')}`);
  }

  return Object.freeze(
    proposals.sort((left, right) =>
      compareStrings(endgameGroupId(left.points), endgameGroupId(right.points)),
    ),
  );
};

/**
 * E2-12d application adapter. One analyze call performs exactly one whole-position
 * E2-12b confidence analysis and one E2-12c selector composition, then maps the
 * result into the existing EndgameProposal lifecycle owned by GameSession.
 */
export class ConfidenceAutoEndgameClassifier implements EndgameClassifier {
  constructor(
    private readonly dependencies: ConfidenceAutoEndgameClassifierDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    const position = this.dependencies.classifyPosition(context.state, context.topology);
    const selection = this.dependencies.selectPosition(position);
    return mapConfidenceAutoSelectionToEndgameProposal(context.groups, position, selection);
  }
}
