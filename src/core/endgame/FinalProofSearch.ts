import type { EndgameAnalysisContext, EndgameGroupProposal, EndgameProposal } from './EndgameClassifier';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { endgameGroupId } from './EndgameGroupIdentity';
import { readLocalLifeDeath, type LocalLifeDeathOrderResult, type LocalLifeDeathResult } from './LocalLifeDeathReader';
import { buildRelevanceZone } from './RelevanceZone';
import type { AndOrProofTrace } from './AndOrSearchCore';

export const FINAL_PROOF_SEARCH_ALGORITHM = 'final-proof-search-v1';

export interface FinalProofSearchBudget {
  readonly softWallClockMilliseconds: number;
  readonly hardWallClockMilliseconds: number;
  readonly maxGlobalNodes: number;
  readonly maxZonePoints: number;
  readonly tierNodeBudgets: readonly number[];
}

export const DEFAULT_FINAL_PROOF_SEARCH_BUDGET: FinalProofSearchBudget = Object.freeze({
  softWallClockMilliseconds: 3_000,
  hardWallClockMilliseconds: 4_500,
  maxGlobalNodes: 60_000,
  maxZonePoints: 96,
  tierNodeBudgets: Object.freeze([300, 1_500, 6_000]),
});

export type FinalProofSearchStopReason =
  | 'complete'
  | 'incomplete-context'
  | 'soft-time-budget'
  | 'hard-time-budget'
  | 'global-node-budget';

export interface FinalProofSearchProgress {
  readonly algorithm: typeof FINAL_PROOF_SEARCH_ALGORITHM;
  readonly totalUnresolvedGroups: number;
  readonly completedGroups: number;
  readonly resolvedAutomatically: number;
  readonly remainingUnresolved: number;
  readonly currentGroupKey: string | null;
  readonly currentTier: number;
  readonly exploredNodes: number;
  readonly elapsedMilliseconds: number;
}

export interface FinalProofSearchDiagnostics extends FinalProofSearchProgress {
  readonly stopReason: FinalProofSearchStopReason;
  readonly attempts: number;
  readonly outcomes: Readonly<{
    alive: number;
    dead: number;
    unresolvedBudget: number;
    unresolvedBoundary: number;
    koDependent: number;
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
}

export type FinalProofSearchProgressListener = (
  progress: FinalProofSearchProgress | null,
) => void;

let activeProgress: FinalProofSearchProgress | null = null;
const progressListeners = new Set<FinalProofSearchProgressListener>();

export const currentFinalProofSearchProgress = (): FinalProofSearchProgress | null =>
  activeProgress;

export const subscribeFinalProofSearchProgress = (
  listener: FinalProofSearchProgressListener,
): (() => void) => {
  progressListeners.add(listener);
  listener(activeProgress);
  return () => progressListeners.delete(listener);
};

const publishProgress = (progress: FinalProofSearchProgress | null): void => {
  activeProgress = progress;
  for (const listener of progressListeners) listener(progress);
};

interface Candidate {
  readonly proposalIndex: number;
  readonly group: EndgameStoneString;
  readonly zoneSize: number;
  readonly boundaryKnown: boolean;
}

const nowMilliseconds = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const resolvedBudget = (partial: Partial<FinalProofSearchBudget> | undefined): FinalProofSearchBudget => {
  const merged = {
    ...DEFAULT_FINAL_PROOF_SEARCH_BUDGET,
    ...partial,
    tierNodeBudgets: partial?.tierNodeBudgets ?? DEFAULT_FINAL_PROOF_SEARCH_BUDGET.tierNodeBudgets,
  };
  if (!Number.isFinite(merged.softWallClockMilliseconds) || merged.softWallClockMilliseconds < 0) throw new Error('softWallClockMilliseconds must be non-negative');
  if (!Number.isFinite(merged.hardWallClockMilliseconds) || merged.hardWallClockMilliseconds < merged.softWallClockMilliseconds) throw new Error('hardWallClockMilliseconds must be >= soft budget');
  if (!Number.isInteger(merged.maxGlobalNodes) || merged.maxGlobalNodes < 0) throw new Error('maxGlobalNodes must be a non-negative integer');
  if (!Number.isInteger(merged.maxZonePoints) || merged.maxZonePoints < 1) throw new Error('maxZonePoints must be a positive integer');
  if (merged.tierNodeBudgets.length === 0 || merged.tierNodeBudgets.some((value) => !Number.isInteger(value) || value < 1)) throw new Error('tierNodeBudgets must contain positive integers');
  return Object.freeze({ ...merged, tierNodeBudgets: Object.freeze([...merged.tierNodeBudgets]) });
};

const totalNodes = (result: LocalLifeDeathResult): number =>
  (result.attackerFirst.search?.exploredNodes ?? 0) + (result.defenderFirst.search?.exploredNodes ?? 0);
const maxDepth = (result: LocalLifeDeathResult): number => Math.max(
  result.attackerFirst.search?.maxDepth ?? 0,
  result.defenderFirst.search?.maxDepth ?? 0,
);

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

const evidenceFor = (result: LocalLifeDeathResult, tier: number, nodeBudget: number) => Object.freeze({
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
  exploredNodes: totalNodes(result),
  maxDepth: maxDepth(result),
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

const unresolvedKind = (result: LocalLifeDeathResult): 'budget' | 'boundary' | 'ko' | 'other' => {
  const outcomes = [result.attackerFirst.outcome, result.defenderFirst.outcome];
  if (outcomes.includes('ko-dependent')) return 'ko';
  if (outcomes.includes('unknown-boundary')) return 'boundary';
  if (outcomes.includes('unknown-budget')) return 'budget';
  return 'other';
};

const candidateOrder = (left: Candidate, right: Candidate): number =>
  left.group.liberties.length - right.group.liberties.length ||
  left.zoneSize - right.zoneSize ||
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

export const runFinalProofSearch = async (
  context: EndgameAnalysisContext,
  staticProposal: EndgameProposal,
  options: FinalProofSearchOptions = {},
): Promise<FinalProofSearchResult> => {
  const budget = resolvedBudget(options.budget);
  const now = options.now ?? nowMilliseconds;
  const started = now();
  const hardDeadlineReached = (): boolean => now() - started >= budget.hardWallClockMilliseconds;
  const graph = buildEndgameStaticGraph(context.state.board, context.topology);
  const output: EndgameGroupProposal[] = staticProposal.map((group) => group);
  const graphKeys = new Set(graph.strings.map((group) => group.key));
  const totalStaticUnresolved = staticProposal.filter((group) => group.status === 'unresolved').length;

  if (
    !coversGraphExactly(context.groups, graphKeys) ||
    !coversGraphExactly(staticProposal.map((group) => group.points), graphKeys)
  ) {
    const diagnostics: FinalProofSearchDiagnostics = Object.freeze({
      algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
      totalUnresolvedGroups: totalStaticUnresolved,
      completedGroups: 0,
      resolvedAutomatically: 0,
      remainingUnresolved: totalStaticUnresolved,
      currentGroupKey: null,
      currentTier: 0,
      exploredNodes: 0,
      elapsedMilliseconds: Math.max(0, now() - started),
      stopReason: 'incomplete-context',
      attempts: 0,
      outcomes: Object.freeze({
        alive: 0,
        dead: 0,
        unresolvedBudget: 0,
        unresolvedBoundary: 0,
        koDependent: 0,
        unresolvedOther: totalStaticUnresolved,
      }),
    });
    options.onProgress?.(diagnostics);
    return Object.freeze({ proposal: Object.freeze(output), diagnostics });
  }

  const candidates: Candidate[] = [];
  for (let index = 0; index < staticProposal.length; index += 1) {
    const proposal = staticProposal[index]!;
    if (proposal.status !== 'unresolved') continue;
    const group = graph.stringsByKey.get(endgameGroupId(proposal.points));
    if (!group) continue;
    const zone = buildRelevanceZone(group, context.state.board, context.topology, { maxPoints: budget.maxZonePoints });
    candidates.push(Object.freeze({
      proposalIndex: index,
      group,
      zoneSize: zone.points.length,
      boundaryKnown: zone.outcome === 'bounded',
    }));
  }
  candidates.sort(candidateOrder);

  let exploredNodes = 0;
  let attempts = 0;
  let resolvedAutomatically = 0;
  let completedGroups = 0;
  let stopReason: FinalProofSearchStopReason = 'complete';
  const resolvedKeys = new Set<string>();
  const lastUnknown = new Map<string, 'budget' | 'boundary' | 'ko' | 'other'>();
  let currentTier = 0;
  let currentGroupKey: string | null = null;

  const progress = (): FinalProofSearchProgress => Object.freeze({
    algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
    totalUnresolvedGroups: candidates.length,
    completedGroups,
    resolvedAutomatically,
    remainingUnresolved: candidates.length - resolvedAutomatically,
    currentGroupKey,
    currentTier,
    exploredNodes,
    elapsedMilliseconds: Math.max(0, now() - started),
  });
  const emit = (): void => {
    const snapshot = progress();
    options.onProgress?.(snapshot);
    publishProgress(snapshot);
  };

  emit();
  await yieldToEventLoop();

  try {
    outer: for (let tierIndex = 0; tierIndex < budget.tierNodeBudgets.length; tierIndex += 1) {
      currentTier = tierIndex + 1;
      const requestedNodes = budget.tierNodeBudgets[tierIndex]!;

      for (const candidate of candidates) {
        if (resolvedKeys.has(candidate.group.key)) continue;
        const elapsed = now() - started;
        if (elapsed >= budget.hardWallClockMilliseconds) { stopReason = 'hard-time-budget'; break outer; }
        if (tierIndex > 0 && elapsed >= budget.softWallClockMilliseconds) { stopReason = 'soft-time-budget'; break outer; }
        const remainingNodes = budget.maxGlobalNodes - exploredNodes;
        if (remainingNodes < 2) { stopReason = 'global-node-budget'; break outer; }

        currentGroupKey = candidate.group.key;
        if (!candidate.boundaryKnown) {
          lastUnknown.set(candidate.group.key, 'boundary');
          completedGroups += tierIndex === 0 ? 1 : 0;
          emit();
          await yieldToEventLoop();
          continue;
        }

        const nodeBudget = Math.max(1, Math.min(requestedNodes, Math.floor(remainingNodes / 2)));
        const result = readLocalLifeDeath(candidate.group, context.state, context.topology, {
          maxNodes: nodeBudget,
          maxZonePoints: budget.maxZonePoints,
          shouldStop: hardDeadlineReached,
        });
        attempts += 1;
        exploredNodes += totalNodes(result);
        if (tierIndex === 0) completedGroups += 1;

        if (result.outcome === 'proved-dead' || result.outcome === 'proved-alive') {
          const status = result.outcome === 'proved-dead' ? 'dead' as const : 'alive' as const;
          output[candidate.proposalIndex] = Object.freeze({
            points: staticProposal[candidate.proposalIndex]!.points,
            status,
            source: 'automatic' as const,
            evidence: evidenceFor(result, currentTier, nodeBudget),
          });
          resolvedKeys.add(candidate.group.key);
          resolvedAutomatically += 1;
          lastUnknown.delete(candidate.group.key);
        } else {
          lastUnknown.set(candidate.group.key, unresolvedKind(result));
        }
        emit();
        if (hardDeadlineReached()) {
          stopReason = 'hard-time-budget';
          break outer;
        }
        await yieldToEventLoop();
      }
    }

    currentGroupKey = null;
    const counts = { alive: 0, dead: 0, unresolvedBudget: 0, unresolvedBoundary: 0, koDependent: 0, unresolvedOther: 0 };
    for (const candidate of candidates) {
      const final = output[candidate.proposalIndex]!;
      if (final.status === 'alive') counts.alive += 1;
      else if (final.status === 'dead') counts.dead += 1;
      else {
        const kind = lastUnknown.get(candidate.group.key) ?? (stopReason === 'global-node-budget' || stopReason === 'soft-time-budget' || stopReason === 'hard-time-budget' ? 'budget' : 'other');
        if (kind === 'budget') counts.unresolvedBudget += 1;
        else if (kind === 'boundary') counts.unresolvedBoundary += 1;
        else if (kind === 'ko') counts.koDependent += 1;
        else counts.unresolvedOther += 1;
      }
    }
    const diagnostics: FinalProofSearchDiagnostics = Object.freeze({
      ...progress(),
      stopReason,
      attempts,
      outcomes: Object.freeze(counts),
    });
    options.onProgress?.(diagnostics);
    publishProgress(diagnostics);
    await yieldToEventLoop();
    return Object.freeze({ proposal: Object.freeze(output), diagnostics });
  } finally {
    publishProgress(null);
  }
};