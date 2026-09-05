import type {
  EndgameAnalysisContext,
  EndgameGroupProposal,
  EndgameProposal,
} from './EndgameClassifier';
import {
  tryBuildEndgameStaticGraph,
  type EndgameStoneString,
} from './EndgameStaticGraph';
import { endgameGroupId } from './EndgameGroupIdentity';
import {
  readLocalLifeDeathAsync,
  type LocalLifeDeathOrderResult,
  type LocalLifeDeathResult,
} from './LocalLifeDeathReader';
import {
  buildRelevanceZone,
  collectBensonSafeGroupKeys,
  type RelevanceZoneResult,
} from './RelevanceZone';
import {
  readTacticalCaptureAsync,
  type TacticalReadOutcome,
  type TacticalReadResult,
} from './TacticalReader';
import type { AndOrProofTrace } from './AndOrSearchCore';
import {
  analyzeBoundedSemeaiAsync,
  type BoundedSemeaiOutcome,
  type BoundedSemeaiResult,
} from './SemeaiSearch';
import {
  analyzeDynamicSeki,
  type DynamicSekiInitiationOutcome,
  type DynamicSekiResult,
} from './SekiSearch';
import {
  DEFAULT_COOPERATIVE_QUANTUM_MILLISECONDS,
  ProofSearchControl,
} from './ProofSearchControl';

export const FINAL_PROOF_SEARCH_ALGORITHM = 'final-proof-search-v2';

export type FinalProofTierName =
  | 'candidate-preparation'
  | 'tactical'
  | 'local-life-death'
  | 'semeai'
  | 'dynamic-seki'
  | 'finalizing';

export interface FinalProofSearchBudget {
  readonly softWallClockMilliseconds: number;
  readonly hardWallClockMilliseconds: number;
  readonly maxGlobalNodes: number;
  readonly maxZonePoints: number;
  readonly tacticalNodeBudget: number;
  readonly tacticalMaxTargetLiberties: number;
  readonly tierNodeBudgets: readonly number[];
  readonly semeaiNodeBudget: number;
  readonly sekiNodeBudget: number;
  readonly cooperativeQuantumMilliseconds: number;
}

export const DEFAULT_FINAL_PROOF_SEARCH_BUDGET: FinalProofSearchBudget = Object.freeze({
  softWallClockMilliseconds: 3_000,
  hardWallClockMilliseconds: 4_500,
  maxGlobalNodes: 60_000,
  maxZonePoints: 96,
  tacticalNodeBudget: 300,
  tacticalMaxTargetLiberties: 3,
  tierNodeBudgets: Object.freeze([300, 1_500, 6_000]),
  semeaiNodeBudget: 3_000,
  sekiNodeBudget: 1_500,
  cooperativeQuantumMilliseconds: DEFAULT_COOPERATIVE_QUANTUM_MILLISECONDS,
});

const TACTICAL_SAFETY_MAX_DEPTH = 64;

export type FinalProofSearchStopReason =
  | 'complete'
  | 'incomplete-context'
  | 'soft-time-budget'
  | 'hard-time-budget'
  | 'global-node-budget'
  | 'cancelled';

export interface FinalProofSearchProgress {
  readonly algorithm: typeof FINAL_PROOF_SEARCH_ALGORITHM;
  readonly analysisId: string;
  readonly groupsTotal: number;
  readonly groupsCompleted: number;
  readonly groupsPending: number;
  readonly currentGroup: string | null;
  readonly currentTier: number;
  readonly currentTierName: FinalProofTierName;
  readonly currentTierIndex: number;
  readonly currentTierBudget: number;
  readonly exploredNodes: number;
  readonly elapsedMilliseconds: number;
  /** Compatibility aliases retained for existing diagnostics/UI consumers. */
  readonly totalUnresolvedGroups: number;
  readonly completedGroups: number;
  readonly resolvedAutomatically: number;
  readonly remainingUnresolved: number;
  readonly currentGroupKey: string | null;
}

export interface FinalProofSearchDiagnostics extends FinalProofSearchProgress {
  readonly stopReason: FinalProofSearchStopReason;
  readonly attempts: number;
  readonly deadlineReachedAt: number | null;
  readonly lastOperation: string;
  readonly maxObservedCooperativeSliceMilliseconds: number;
  readonly resolvedByTier: Readonly<{
    tactical: number;
    localLifeDeath: number;
    semeai: number;
    seki: number;
  }>;
  readonly nodesByTier: Readonly<{
    tactical: number;
    localLifeDeath: number;
    semeai: number;
    seki: number;
  }>;
  readonly elapsedMillisecondsByTier: Readonly<{
    candidatePreparation: number;
    tactical: number;
    localLifeDeath: number;
    semeai: number;
    seki: number;
  }>;
  readonly diagnosticFailures: Readonly<{
    zoneTooLarge: number;
    zoneOpenBoundary: number;
    zoneWholeTopology: number;
    targetIdentityUncertain: number;
    noUsefulLocalCandidate: number;
    nodeBudget: number;
    timeBudget: number;
    ko: number;
    cycle: number;
    incompleteEnumeration: number;
  }>;
  readonly outcomes: Readonly<{
    alive: number;
    dead: number;
    seki: number;
    unresolvedBudget: number;
    unresolvedBoundary: number;
    koDependent: number;
    unresolvedCycle: number;
    unresolvedIncomplete: number;
    unresolvedOther: number;
  }>;
}

export interface FinalProofSearchResult {
  readonly proposal: EndgameProposal;
  readonly diagnostics: FinalProofSearchDiagnostics;
}

export interface FinalProofSearchOptions {
  readonly budget?: Partial<FinalProofSearchBudget>;
  readonly onProgress?: (progress: FinalProofSearchProgress) => void;
  readonly now?: () => number;
  readonly analysisId?: string;
  readonly shouldStop?: () => boolean;
  readonly control?: ProofSearchControl;
  readonly yieldControl?: () => Promise<void>;
}

interface Candidate {
  readonly proposalIndex: number;
  readonly group: EndgameStoneString;
  readonly zone: RelevanceZoneResult;
}

interface PairCandidate {
  readonly left: Candidate;
  readonly right: Candidate;
  readonly sharedLiberties: readonly string[];
}

type UnresolvedKind = 'budget' | 'time' | 'boundary' | 'ko' | 'cycle' | 'incomplete' | 'other';

type MutableTierCounters = {
  tactical: number;
  localLifeDeath: number;
  semeai: number;
  seki: number;
};

type MutableElapsedCounters = {
  candidatePreparation: number;
  tactical: number;
  localLifeDeath: number;
  semeai: number;
  seki: number;
};

type MutableFailureCounters = {
  zoneTooLarge: number;
  zoneOpenBoundary: number;
  zoneWholeTopology: number;
  targetIdentityUncertain: number;
  noUsefulLocalCandidate: number;
  nodeBudget: number;
  timeBudget: number;
  ko: number;
  cycle: number;
  incompleteEnumeration: number;
};

const nowMilliseconds = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const createAnalysisId = (): string => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `final-proof-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const resolveFinalProofSearchBudget = (
  partial: Partial<FinalProofSearchBudget> | undefined,
): FinalProofSearchBudget => {
  const merged = {
    ...DEFAULT_FINAL_PROOF_SEARCH_BUDGET,
    ...partial,
    tierNodeBudgets: partial?.tierNodeBudgets ?? DEFAULT_FINAL_PROOF_SEARCH_BUDGET.tierNodeBudgets,
  };
  if (!Number.isFinite(merged.softWallClockMilliseconds) || merged.softWallClockMilliseconds < 0) {
    throw new Error('softWallClockMilliseconds must be non-negative');
  }
  if (!Number.isFinite(merged.hardWallClockMilliseconds) || merged.hardWallClockMilliseconds < merged.softWallClockMilliseconds) {
    throw new Error('hardWallClockMilliseconds must be >= soft budget');
  }
  if (!Number.isInteger(merged.maxGlobalNodes) || merged.maxGlobalNodes < 0) {
    throw new Error('maxGlobalNodes must be a non-negative integer');
  }
  if (!Number.isInteger(merged.maxZonePoints) || merged.maxZonePoints < 1) {
    throw new Error('maxZonePoints must be a positive integer');
  }
  for (const [name, value] of [
    ['tacticalNodeBudget', merged.tacticalNodeBudget],
    ['tacticalMaxTargetLiberties', merged.tacticalMaxTargetLiberties],
    ['semeaiNodeBudget', merged.semeaiNodeBudget],
    ['sekiNodeBudget', merged.sekiNodeBudget],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  }
  if (merged.tierNodeBudgets.length === 0 || merged.tierNodeBudgets.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('tierNodeBudgets must contain positive integers');
  }
  if (!Number.isFinite(merged.cooperativeQuantumMilliseconds) || merged.cooperativeQuantumMilliseconds <= 0) {
    throw new Error('cooperativeQuantumMilliseconds must be positive');
  }
  return Object.freeze({ ...merged, tierNodeBudgets: Object.freeze([...merged.tierNodeBudgets]) });
};

const totalLocalNodes = (result: LocalLifeDeathResult): number =>
  (result.attackerFirst.search?.exploredNodes ?? 0) + (result.defenderFirst.search?.exploredNodes ?? 0);
const maxLocalDepth = (result: LocalLifeDeathResult): number => Math.max(
  result.attackerFirst.search?.maxDepth ?? 0,
  result.defenderFirst.search?.maxDepth ?? 0,
);
const totalTacticalNodes = (attackerFirst: TacticalReadResult, defenderFirst: TacticalReadResult): number =>
  attackerFirst.exploredNodes + defenderFirst.exploredNodes;

const representativeLine = (order: LocalLifeDeathOrderResult): readonly string[] => {
  const root = order.search?.trace;
  if (!root) return Object.freeze([]);
  const line: string[] = [];
  let trace: AndOrProofTrace = root;
  while (trace.children.length > 0 && line.length < 64) {
    const preferred = trace.children.find((child) => child.outcome === trace.outcome) ?? trace.children[0]!;
    line.push(preferred.move);
    trace = preferred.trace;
  }
  return Object.freeze(line);
};

const localEvidenceFor = (result: LocalLifeDeathResult, tier: number, nodeBudget: number) => Object.freeze({
  algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
  proof: result.outcome,
  reader: result.algorithm,
  targetGroup: result.targetGroupKey,
  crucialStones: result.crucialStones,
  relevanceZone: Object.freeze({
    algorithm: result.zone.algorithm,
    size: result.zone.points.length,
    reason: result.zone.reason,
    boundarySafeGroups: result.zone.boundarySafeGroupKeys,
  }),
  tier,
  nodeBudgetPerFirstPlayerOrder: nodeBudget,
  exploredNodes: totalLocalNodes(result),
  maxDepth: maxLocalDepth(result),
  firstPlayerOrders: Object.freeze({
    attackerFirst: result.attackerFirst.outcome,
    defenderFirst: result.defenderFirst.outcome,
  }),
  proofReason: result.proofReason,
  representativeProofLines: Object.freeze({
    attackerFirst: representativeLine(result.attackerFirst),
    defenderFirst: representativeLine(result.defenderFirst),
  }),
});

const tacticalEvidenceFor = (
  group: EndgameStoneString,
  status: 'alive' | 'dead',
  attackerFirst: TacticalReadResult,
  defenderFirst: TacticalReadResult,
  nodeBudget: number,
) => Object.freeze({
  algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
  proof: status === 'dead' ? 'proved-dead' : 'proved-alive',
  reader: attackerFirst.algorithm,
  targetGroup: group.key,
  crucialStones: attackerFirst.crucialStones,
  tier: 1,
  nodeBudgetPerFirstPlayerOrder: nodeBudget,
  exploredNodes: totalTacticalNodes(attackerFirst, defenderFirst),
  maxDepth: Math.max(attackerFirst.maxDepth, defenderFirst.maxDepth),
  firstPlayerOrders: Object.freeze({
    attackerFirst: attackerFirst.outcome,
    defenderFirst: defenderFirst.outcome,
  }),
  proofReason: status === 'dead'
    ? 'both first-player orders prove forced capture with every required defender continuation closed'
    : 'both first-player orders prove connection to a previously proven-alive structure',
  representativeProofLines: Object.freeze({
    attackerFirst: attackerFirst.principalVariation,
    defenderFirst: defenderFirst.principalVariation,
  }),
});

const semeaiEvidenceFor = (
  result: BoundedSemeaiResult,
  deadGroupKey: string,
  nodeBudget: number,
) => Object.freeze({
  algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
  proof: 'proved-dead',
  proofType: 'stable-bounded-semeai-winner',
  reader: result.algorithm,
  targetGroup: deadGroupKey,
  participatingGroupIds: Object.freeze([result.leftGroupKey, result.rightGroupKey]),
  sharedLiberties: result.sharedLiberties,
  certifiedZone: result.zonePoints,
  nodeBudgetPerFirstPlayerOrder: nodeBudget,
  exploredNodes: result.exploredNodes,
  firstPlayerOrders: Object.freeze({
    leftFirst: result.leftFirst.outcome,
    rightFirst: result.rightFirst.outcome,
  }),
  proofReason: result.proofReason,
});

const sekiEvidenceFor = (result: DynamicSekiResult, nodeBudget: number) => Object.freeze({
  algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
  proof: 'proved-seki',
  proofType: result.proof,
  reader: result.algorithm,
  participatingGroupIds: result.participatingGroupIds,
  sharedLiberties: result.sharedLiberties,
  certifiedZone: result.certifiedZone,
  nodeBudgetPerContinuationOrder: nodeBudget,
  exploredNodes: result.exploredNodes,
  bothSideInitiationResults: Object.freeze({
    left: result.leftInitiation,
    right: result.rightInitiation,
  }),
  proofReason: result.proofReason,
});

const unknownRank: Readonly<Record<UnresolvedKind, number>> = Object.freeze({
  other: 0,
  incomplete: 1,
  cycle: 2,
  budget: 3,
  time: 4,
  boundary: 5,
  ko: 6,
});

const retainStrongerUnknown = (
  map: Map<string, UnresolvedKind>,
  key: string,
  value: UnresolvedKind,
): void => {
  const previous = map.get(key);
  if (!previous || unknownRank[value] > unknownRank[previous]) map.set(key, value);
};

const unresolvedLocalKind = (result: LocalLifeDeathResult, hardStopped: boolean): UnresolvedKind => {
  const outcomes = [result.attackerFirst.outcome, result.defenderFirst.outcome];
  if (outcomes.includes('ko-dependent')) return 'ko';
  if (outcomes.includes('unknown-boundary')) return 'boundary';
  if (outcomes.includes('unknown-cycle')) return 'cycle';
  if (outcomes.includes('unknown-incomplete')) return 'incomplete';
  if (outcomes.includes('unknown-budget')) return hardStopped ? 'time' : 'budget';
  return 'other';
};

const unresolvedTacticalKind = (
  attackerFirst: TacticalReadResult,
  defenderFirst: TacticalReadResult,
  hardStopped: boolean,
): UnresolvedKind => {
  const outcomes: readonly TacticalReadOutcome[] = [attackerFirst.outcome, defenderFirst.outcome];
  if (outcomes.includes('ko-dependent')) return 'ko';
  if (outcomes.includes('unknown-boundary')) return 'boundary';
  if (outcomes.includes('unknown-cycle')) return 'cycle';
  if (outcomes.includes('unknown-budget')) return hardStopped ? 'time' : 'budget';
  return 'other';
};

const unresolvedSemeaiKind = (outcome: BoundedSemeaiOutcome, hardStopped: boolean): UnresolvedKind => {
  if (outcome === 'ko-dependent') return 'ko';
  if (outcome === 'unknown-boundary') return 'boundary';
  if (outcome === 'unknown-cycle') return 'cycle';
  if (outcome === 'unknown-incomplete') return 'incomplete';
  if (outcome === 'unknown-budget') return hardStopped ? 'time' : 'budget';
  return 'other';
};

const unresolvedSekiKind = (result: DynamicSekiResult, hardStopped: boolean): UnresolvedKind => {
  if (result.outcome === 'ko-dependent') return 'ko';
  const initiationOutcomes: readonly DynamicSekiInitiationOutcome[] = [
    result.leftInitiation.outcome,
    result.rightInitiation.outcome,
  ];
  if (initiationOutcomes.includes('unknown-boundary')) return 'boundary';
  if (initiationOutcomes.includes('unknown-cycle')) return 'cycle';
  if (initiationOutcomes.includes('unknown-incomplete')) return 'incomplete';
  if (initiationOutcomes.includes('unknown-budget')) return hardStopped ? 'time' : 'budget';
  if (result.reason === 'third-group-interference' || result.reason === 'stale-group') return 'incomplete';
  if (result.reason === 'unknown-boundary') return 'boundary';
  if (result.reason === 'budget') return hardStopped ? 'time' : 'budget';
  return 'other';
};

const candidateOrder = (left: Candidate, right: Candidate): number =>
  left.group.liberties.length - right.group.liberties.length ||
  Number(right.zone.outcome === 'bounded') - Number(left.zone.outcome === 'bounded') ||
  left.zone.points.length - right.zone.points.length ||
  left.group.points.length - right.group.points.length ||
  (left.group.key < right.group.key ? -1 : left.group.key > right.group.key ? 1 : 0);

const coversGraphExactly = (
  groups: readonly (readonly string[])[],
  graphKeys: ReadonlySet<string>,
): boolean => {
  if (groups.length !== graphKeys.size) return false;
  const keys = groups.map((points) => endgameGroupId(points));
  return new Set(keys).size === keys.length && keys.every((key) => graphKeys.has(key));
};

const pairCandidatesFor = (
  candidates: readonly Candidate[],
  output: readonly EndgameGroupProposal[],
  topology: EndgameAnalysisContext['topology'],
): readonly PairCandidate[] => {
  const result: PairCandidate[] = [];
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]!;
    if (output[left.proposalIndex]?.status !== 'unresolved') continue;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]!;
      if (output[right.proposalIndex]?.status !== 'unresolved' || left.group.color === right.group.color) continue;
      const rightLiberties = new Set(right.group.liberties);
      const shared = left.group.liberties.filter((point) => rightLiberties.has(point)).sort();
      const rightPoints = new Set(right.group.points);
      const adjacent = left.group.points.some((point) => topology.neighbors(point).some((neighbor) => rightPoints.has(neighbor)));
      if (!adjacent && shared.length === 0) continue;
      result.push(Object.freeze({ left, right, sharedLiberties: Object.freeze(shared) }));
    }
  }
  result.sort((a, b) =>
    b.sharedLiberties.length - a.sharedLiberties.length ||
    a.left.group.liberties.length + a.right.group.liberties.length - b.left.group.liberties.length - b.right.group.liberties.length ||
    (a.left.group.key < b.left.group.key ? -1 : a.left.group.key > b.left.group.key ? 1 : a.right.group.key < b.right.group.key ? -1 : 1));
  return Object.freeze(result);
};

const incrementZoneFailure = (zone: RelevanceZoneResult, failures: MutableFailureCounters): void => {
  if (zone.reason === 'max-points-exceeded') failures.zoneTooLarge += 1;
  else if (zone.reason === 'localisation-covers-whole-board') failures.zoneWholeTopology += 1;
  else if (zone.reason === 'target-mismatch') failures.targetIdentityUncertain += 1;
  else if (zone.reason === 'interrupted') failures.timeBudget += 1;
  else if (zone.outcome !== 'bounded') failures.zoneOpenBoundary += 1;
};

export const runFinalProofSearch = async (
  context: EndgameAnalysisContext,
  staticProposal: EndgameProposal,
  options: FinalProofSearchOptions = {},
): Promise<FinalProofSearchResult> => {
  const budget = resolveFinalProofSearchBudget(options.budget);
  const now = options.now ?? nowMilliseconds;
  const localStarted = now();
  const analysisId = options.control?.analysisId ?? options.analysisId ?? createAnalysisId();
  const control = options.control ?? new ProofSearchControl({
    analysisId,
    startedAt: localStarted,
    hardDeadline: localStarted + budget.hardWallClockMilliseconds,
    now,
    shouldCancel: options.shouldStop,
    cooperativeQuantumMilliseconds: budget.cooperativeQuantumMilliseconds,
    yieldControl: options.yieldControl,
  });
  if (control.analysisId !== analysisId) throw new Error('Final proof search control analysisId mismatch');
  const softDeadline = control.startedAt + budget.softWallClockMilliseconds;
  const started = control.startedAt;
  const output: EndgameGroupProposal[] = staticProposal.map((group) => group);
  const totalStaticUnresolved = staticProposal.filter((group) => group.status === 'unresolved').length;
  const resolvedByTier: MutableTierCounters = { tactical: 0, localLifeDeath: 0, semeai: 0, seki: 0 };
  const nodesByTier: MutableTierCounters = { tactical: 0, localLifeDeath: 0, semeai: 0, seki: 0 };
  const elapsedByTier: MutableElapsedCounters = { candidatePreparation: 0, tactical: 0, localLifeDeath: 0, semeai: 0, seki: 0 };
  const failures: MutableFailureCounters = {
    zoneTooLarge: 0,
    zoneOpenBoundary: 0,
    zoneWholeTopology: 0,
    targetIdentityUncertain: 0,
    noUsefulLocalCandidate: 0,
    nodeBudget: 0,
    timeBudget: 0,
    ko: 0,
    cycle: 0,
    incompleteEnumeration: 0,
  };
  const lastUnknown = new Map<string, UnresolvedKind>();
  const completedKeys = new Set<string>();
  let exploredNodes = 0;
  let attempts = 0;
  let resolvedAutomatically = 0;
  let stopReason: FinalProofSearchStopReason = 'complete';
  let currentTier = 0;
  let currentTierName: FinalProofTierName = 'candidate-preparation';
  let currentTierIndex = 0;
  let currentTierBudget = 0;
  let currentGroup: string | null = null;
  let candidates: Candidate[] = [];

  const hardStopped = (): boolean => control.shouldStop();
  const softStopped = (): boolean => control.now() >= softDeadline;
  const remainingNodes = (): number => Math.max(0, budget.maxGlobalNodes - exploredNodes);
  const remainingUnresolved = (): number => output.filter((group) => group.status === 'unresolved').length;

  const progress = (): FinalProofSearchProgress => Object.freeze({
    algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
    analysisId,
    groupsTotal: totalStaticUnresolved,
    groupsCompleted: completedKeys.size,
    groupsPending: Math.max(0, totalStaticUnresolved - completedKeys.size),
    currentGroup,
    currentTier,
    currentTierName,
    currentTierIndex,
    currentTierBudget,
    exploredNodes,
    elapsedMilliseconds: Math.max(0, control.now() - started),
    totalUnresolvedGroups: totalStaticUnresolved,
    completedGroups: completedKeys.size,
    resolvedAutomatically,
    remainingUnresolved: remainingUnresolved(),
    currentGroupKey: currentGroup,
  });
  const emit = (): void => options.onProgress?.(progress());

  const noteUnknown = (key: string, kind: UnresolvedKind): void => {
    retainStrongerUnknown(lastUnknown, key, kind);
    if (kind === 'ko') failures.ko += 1;
    else if (kind === 'cycle') failures.cycle += 1;
    else if (kind === 'incomplete') failures.incompleteEnumeration += 1;
    else if (kind === 'time') failures.timeBudget += 1;
    else if (kind === 'budget') failures.nodeBudget += 1;
  };

  const resolveCandidate = (
    candidate: Candidate,
    status: 'alive' | 'dead' | 'seki',
    evidence: Readonly<Record<string, unknown>>,
    tier: keyof MutableTierCounters,
  ): void => {
    if (output[candidate.proposalIndex]?.status !== 'unresolved') return;
    output[candidate.proposalIndex] = Object.freeze({
      points: staticProposal[candidate.proposalIndex]!.points,
      status,
      source: 'automatic' as const,
      evidence,
    });
    resolvedAutomatically += 1;
    resolvedByTier[tier] += 1;
    completedKeys.add(candidate.group.key);
  };

  const stopForControl = (): void => {
    const snapshot = control.snapshot();
    stopReason = snapshot.stopReason === 'cancelled' ? 'cancelled' : 'hard-time-budget';
  };

  const makeDiagnostics = (): FinalProofSearchDiagnostics => {
    const controlSnapshot = control.snapshot();
    const unresolvedKinds = { budget: 0, boundary: 0, ko: 0, cycle: 0, incomplete: 0, other: 0 };
    for (const candidate of candidates) {
      if (output[candidate.proposalIndex]?.status !== 'unresolved') continue;
      const kind = lastUnknown.get(candidate.group.key) ?? 'other';
      if (kind === 'budget' || kind === 'time') unresolvedKinds.budget += 1;
      else if (kind === 'boundary') unresolvedKinds.boundary += 1;
      else if (kind === 'ko') unresolvedKinds.ko += 1;
      else if (kind === 'cycle') unresolvedKinds.cycle += 1;
      else if (kind === 'incomplete') unresolvedKinds.incomplete += 1;
      else unresolvedKinds.other += 1;
    }
    const automaticCounts = { alive: 0, dead: 0, seki: 0 };
    for (const candidate of candidates) {
      const group = output[candidate.proposalIndex];
      if (group?.status === 'alive') automaticCounts.alive += 1;
      else if (group?.status === 'dead') automaticCounts.dead += 1;
      else if (group?.status === 'seki') automaticCounts.seki += 1;
    }
    return Object.freeze({
      ...progress(),
      stopReason,
      attempts,
      deadlineReachedAt: controlSnapshot.deadlineReachedAt,
      lastOperation: controlSnapshot.lastOperation,
      maxObservedCooperativeSliceMilliseconds: controlSnapshot.maxObservedCooperativeSliceMilliseconds,
      resolvedByTier: Object.freeze({ ...resolvedByTier }),
      nodesByTier: Object.freeze({ ...nodesByTier }),
      elapsedMillisecondsByTier: Object.freeze({ ...elapsedByTier }),
      diagnosticFailures: Object.freeze({ ...failures }),
      outcomes: Object.freeze({
        alive: automaticCounts.alive,
        dead: automaticCounts.dead,
        seki: automaticCounts.seki,
        unresolvedBudget: unresolvedKinds.budget,
        unresolvedBoundary: unresolvedKinds.boundary,
        koDependent: unresolvedKinds.ko,
        unresolvedCycle: unresolvedKinds.cycle,
        unresolvedIncomplete: unresolvedKinds.incomplete,
        unresolvedOther: unresolvedKinds.other,
      }),
    });
  };

  control.setOperation('graph-preparation');
  const graph = tryBuildEndgameStaticGraph(context.state.board, context.topology, { shouldStop: control.shouldStop });
  if (!graph) {
    stopForControl();
    currentTierName = 'finalizing';
    const diagnostics = makeDiagnostics();
    options.onProgress?.(diagnostics);
    return Object.freeze({ proposal: Object.freeze(output), diagnostics });
  }
  const graphKeys = new Set(graph.strings.map((group) => group.key));
  if (
    !coversGraphExactly(context.groups, graphKeys) ||
    !coversGraphExactly(staticProposal.map((group) => group.points), graphKeys)
  ) {
    stopReason = 'incomplete-context';
    currentTierName = 'finalizing';
    const diagnostics = makeDiagnostics();
    options.onProgress?.(diagnostics);
    return Object.freeze({ proposal: Object.freeze(output), diagnostics });
  }

  const preparationStarted = control.now();
  control.setOperation('benson-boundary-preparation');
  const safeGroupKeys = collectBensonSafeGroupKeys(context.state.board, context.topology, graph, control.shouldStop);
  const safeGroupPoints = Object.freeze(
    staticProposal
      .filter((group) => group.status === 'alive' && group.source === 'automatic')
      .flatMap((group) => group.points),
  );
  if (!safeGroupKeys) {
    stopForControl();
    currentTierName = 'finalizing';
    elapsedByTier.candidatePreparation += Math.max(0, control.now() - preparationStarted);
    const diagnostics = makeDiagnostics();
    options.onProgress?.(diagnostics);
    return Object.freeze({ proposal: Object.freeze(output), diagnostics });
  }

  for (let index = 0; index < staticProposal.length; index += 1) {
    if (await control.checkpoint('candidate-generation')) {
      stopForControl();
      break;
    }
    const proposal = staticProposal[index]!;
    if (proposal.status !== 'unresolved') continue;
    const group = graph.stringsByKey.get(endgameGroupId(proposal.points));
    if (!group) {
      failures.targetIdentityUncertain += 1;
      continue;
    }
    const zone = buildRelevanceZone(group, context.state.board, context.topology, {
      maxPoints: budget.maxZonePoints,
      graph,
      safeGroupKeys,
      shouldStop: control.shouldStop,
    });
    incrementZoneFailure(zone, failures);
    candidates.push(Object.freeze({ proposalIndex: index, group, zone }));
    if (zone.outcome !== 'bounded') noteUnknown(group.key, zone.reason === 'interrupted' ? 'time' : 'boundary');
  }
  candidates.sort(candidateOrder);
  elapsedByTier.candidatePreparation += Math.max(0, control.now() - preparationStarted);
  emit();
  await control.checkpoint('candidate-preparation-complete', true);

  const canLaunchExpensiveUnit = (): boolean => {
    if (hardStopped()) {
      stopForControl();
      return false;
    }
    if (remainingNodes() <= 0) {
      stopReason = 'global-node-budget';
      return false;
    }
    if (softStopped()) {
      stopReason = 'soft-time-budget';
      return false;
    }
    return true;
  };

  if (stopReason === 'complete') {
    currentTier = 1;
    currentTierName = 'tactical';
    currentTierIndex = 0;
    currentTierBudget = budget.tacticalNodeBudget;
    for (const candidate of candidates) {
      if (output[candidate.proposalIndex]?.status !== 'unresolved') continue;
      if (candidate.group.liberties.length > budget.tacticalMaxTargetLiberties) continue;
      if (!canLaunchExpensiveUnit()) break;
      const perOrderBudget = Math.min(budget.tacticalNodeBudget, Math.floor(remainingNodes() / 2));
      if (perOrderBudget < 1) { stopReason = 'global-node-budget'; break; }
      currentTierBudget = perOrderBudget;
      currentGroup = candidate.group.key;
      attempts += 1;
      emit();
      const operationStarted = control.now();
      const shared = {
        maxDepth: TACTICAL_SAFETY_MAX_DEPTH,
        maxNodes: perOrderBudget,
        maxTargetLiberties: budget.tacticalMaxTargetLiberties,
        safeGroupPoints,
        shouldStop: control.shouldStop,
        cooperativeCheckpoint: () => control.checkpoint('tactical-search'),
      } as const;
      const attackerFirst = await readTacticalCaptureAsync(candidate.group, context.state, context.topology, { ...shared, firstPlayer: 'attacker' });
      const defenderFirst = hardStopped()
        ? Object.freeze({ ...attackerFirst, outcome: 'unknown-budget' as const, exploredNodes: 0, principalVariation: Object.freeze([]), proofReason: 'shared hard deadline reached before defender-first order' })
        : await readTacticalCaptureAsync(candidate.group, context.state, context.topology, { ...shared, firstPlayer: 'defender' });
      const used = totalTacticalNodes(attackerFirst, defenderFirst);
      exploredNodes += used;
      nodesByTier.tactical += used;
      elapsedByTier.tactical += Math.max(0, control.now() - operationStarted);

      if (attackerFirst.outcome === 'proved-kill' && defenderFirst.outcome === 'proved-kill') {
        resolveCandidate(candidate, 'dead', tacticalEvidenceFor(candidate.group, 'dead', attackerFirst, defenderFirst, perOrderBudget), 'tactical');
      } else if (attackerFirst.outcome === 'proved-survival' && defenderFirst.outcome === 'proved-survival') {
        resolveCandidate(candidate, 'alive', tacticalEvidenceFor(candidate.group, 'alive', attackerFirst, defenderFirst, perOrderBudget), 'tactical');
      } else {
        noteUnknown(candidate.group.key, unresolvedTacticalKind(attackerFirst, defenderFirst, hardStopped()));
      }
      emit();
      if (hardStopped()) { stopForControl(); break; }
    }
  }

  if (stopReason === 'complete') {
    currentTierName = 'local-life-death';
    for (let tierIndex = 0; tierIndex < budget.tierNodeBudgets.length; tierIndex += 1) {
      currentTier = tierIndex + 2;
      currentTierIndex = tierIndex;
      const tierBudget = budget.tierNodeBudgets[tierIndex]!;
      currentTierBudget = tierBudget;
      for (const candidate of candidates) {
        if (output[candidate.proposalIndex]?.status !== 'unresolved') continue;
        if (!canLaunchExpensiveUnit()) break;
        const perOrderBudget = Math.min(tierBudget, Math.floor(remainingNodes() / 2));
        if (perOrderBudget < 1) { stopReason = 'global-node-budget'; break; }
        currentTierBudget = perOrderBudget;
        currentGroup = candidate.group.key;
        attempts += 1;
        emit();
        const operationStarted = control.now();
        const result = await readLocalLifeDeathAsync(candidate.group, context.state, context.topology, {
          maxNodes: perOrderBudget,
          maxZonePoints: budget.maxZonePoints,
          shouldStop: control.shouldStop,
          cooperativeCheckpoint: () => control.checkpoint('local-life-death-search'),
        });
        const used = totalLocalNodes(result);
        exploredNodes += used;
        nodesByTier.localLifeDeath += used;
        elapsedByTier.localLifeDeath += Math.max(0, control.now() - operationStarted);
        incrementZoneFailure(result.zone, failures);
        if (result.outcome === 'proved-dead') {
          resolveCandidate(candidate, 'dead', localEvidenceFor(result, currentTier, perOrderBudget), 'localLifeDeath');
        } else if (result.outcome === 'proved-alive') {
          resolveCandidate(candidate, 'alive', localEvidenceFor(result, currentTier, perOrderBudget), 'localLifeDeath');
        } else {
          noteUnknown(candidate.group.key, unresolvedLocalKind(result, hardStopped()));
        }
        emit();
        if (hardStopped()) { stopForControl(); break; }
      }
      if (stopReason !== 'complete') break;
    }
  }

  if (stopReason === 'complete') {
    currentTier += 1;
    currentTierName = 'semeai';
    currentTierIndex = 0;
    currentTierBudget = budget.semeaiNodeBudget;
    const pairs = pairCandidatesFor(candidates, output, context.topology);
    if (pairs.length === 0) failures.noUsefulLocalCandidate += remainingUnresolved();
    for (const pair of pairs) {
      if (output[pair.left.proposalIndex]?.status !== 'unresolved' || output[pair.right.proposalIndex]?.status !== 'unresolved') continue;
      if (!canLaunchExpensiveUnit()) break;
      const perOrderBudget = Math.min(budget.semeaiNodeBudget, Math.floor(remainingNodes() / 2));
      if (perOrderBudget < 1) { stopReason = 'global-node-budget'; break; }
      currentTierBudget = perOrderBudget;
      currentGroup = `${pair.left.group.key} ↔ ${pair.right.group.key}`;
      attempts += 1;
      emit();
      const operationStarted = control.now();
      const result = await analyzeBoundedSemeaiAsync(pair.left.group, pair.right.group, context.state, context.topology, {
        maxNodes: perOrderBudget,
        maxZonePoints: budget.maxZonePoints,
        shouldStop: control.shouldStop,
        cooperativeCheckpoint: () => control.checkpoint('semeai-search'),
      });
      exploredNodes += result.exploredNodes;
      nodesByTier.semeai += result.exploredNodes;
      elapsedByTier.semeai += Math.max(0, control.now() - operationStarted);

      if (result.outcome === 'stable-left-winner') {
        resolveCandidate(pair.right, 'dead', semeaiEvidenceFor(result, pair.right.group.key, perOrderBudget), 'semeai');
      } else if (result.outcome === 'stable-right-winner') {
        resolveCandidate(pair.left, 'dead', semeaiEvidenceFor(result, pair.left.group.key, perOrderBudget), 'semeai');
      } else {
        const kind = unresolvedSemeaiKind(result.outcome, hardStopped());
        noteUnknown(pair.left.group.key, kind);
        noteUnknown(pair.right.group.key, kind);
      }
      emit();
      if (hardStopped()) { stopForControl(); break; }
    }
  }

  if (stopReason === 'complete') {
    currentTier += 1;
    currentTierName = 'dynamic-seki';
    currentTierIndex = 0;
    currentTierBudget = budget.sekiNodeBudget;
    const pairs = pairCandidatesFor(candidates, output, context.topology)
      .filter((pair) => pair.sharedLiberties.length > 0);
    for (const pair of pairs) {
      if (output[pair.left.proposalIndex]?.status !== 'unresolved' || output[pair.right.proposalIndex]?.status !== 'unresolved') continue;
      if (!canLaunchExpensiveUnit()) break;
      const emptyZoneUpperBound = Math.max(1, new Set([...pair.left.zone.points, ...pair.right.zone.points]).size);
      const conservativeContinuationCount = Math.max(4, emptyZoneUpperBound * 4);
      const perContinuationOrderBudget = Math.min(
        budget.sekiNodeBudget,
        Math.floor(remainingNodes() / conservativeContinuationCount),
      );
      if (perContinuationOrderBudget < 1) { stopReason = 'global-node-budget'; break; }
      currentTierBudget = perContinuationOrderBudget;
      currentGroup = `${pair.left.group.key} ↔ ${pair.right.group.key}`;
      attempts += 1;
      emit();
      const operationStarted = control.now();
      const result = await analyzeDynamicSeki(pair.left.group, pair.right.group, context.state, context.topology, {
        maxNodes: perContinuationOrderBudget,
        maxZonePoints: budget.maxZonePoints,
        shouldStop: control.shouldStop,
        cooperativeCheckpoint: () => control.checkpoint('dynamic-seki-search'),
      });
      exploredNodes += result.exploredNodes;
      nodesByTier.seki += result.exploredNodes;
      elapsedByTier.seki += Math.max(0, control.now() - operationStarted);
      if (result.outcome === 'seki') {
        const evidence = sekiEvidenceFor(result, perContinuationOrderBudget);
        resolveCandidate(pair.left, 'seki', evidence, 'seki');
        resolveCandidate(pair.right, 'seki', evidence, 'seki');
      } else {
        const kind = unresolvedSekiKind(result, hardStopped());
        noteUnknown(pair.left.group.key, kind);
        noteUnknown(pair.right.group.key, kind);
        if (result.reason === 'third-group-interference') failures.incompleteEnumeration += 1;
      }
      emit();
      if (hardStopped()) { stopForControl(); break; }
    }
  }

  if (stopReason === 'complete' && hardStopped()) stopForControl();
  currentTierName = 'finalizing';
  currentTierBudget = 0;
  currentGroup = null;
  control.setOperation('finalizing');

  // At this point the scheduler will never launch another proof tier for any
  // remaining candidate. Only now is an unresolved group semantically complete.
  for (const candidate of candidates) completedKeys.add(candidate.group.key);
  emit();
  const diagnostics = makeDiagnostics();
  options.onProgress?.(diagnostics);
  return Object.freeze({ proposal: Object.freeze(output), diagnostics });
};
