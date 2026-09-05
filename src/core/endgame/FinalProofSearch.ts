import type { EndgameAnalysisContext, EndgameGroupProposal, EndgameProposal } from './EndgameClassifier';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { endgameGroupId } from './EndgameGroupIdentity';
import { readLocalLifeDeath, type LocalLifeDeathOrderResult, type LocalLifeDeathResult } from './LocalLifeDeathReader';
import { buildRelevanceZone } from './RelevanceZone';
import {
  readTacticalCapture,
  type TacticalReadOutcome,
  type TacticalReadResult,
} from './TacticalReader';
import type { AndOrProofTrace } from './AndOrSearchCore';

export const FINAL_PROOF_SEARCH_ALGORITHM = 'final-proof-search-v1';

export interface FinalProofSearchBudget {
  readonly softWallClockMilliseconds: number;
  readonly hardWallClockMilliseconds: number;
  readonly maxGlobalNodes: number;
  readonly maxZonePoints: number;
  readonly tacticalNodeBudget: number;
  readonly tacticalMaxTargetLiberties: number;
  readonly tierNodeBudgets: readonly number[];
}

export const DEFAULT_FINAL_PROOF_SEARCH_BUDGET: FinalProofSearchBudget = Object.freeze({
  softWallClockMilliseconds: 3_000,
  hardWallClockMilliseconds: 4_500,
  maxGlobalNodes: 60_000,
  maxZonePoints: 96,
  tacticalNodeBudget: 300,
  tacticalMaxTargetLiberties: 3,
  tierNodeBudgets: Object.freeze([300, 1_500, 6_000]),
});

const TACTICAL_SAFETY_MAX_DEPTH = 64;

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

type UnresolvedKind = 'budget' | 'boundary' | 'ko' | 'other';

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
  if (!Number.isInteger(merged.tacticalNodeBudget) || merged.tacticalNodeBudget < 1) throw new Error('tacticalNodeBudget must be a positive integer');
  if (!Number.isInteger(merged.tacticalMaxTargetLiberties) || merged.tacticalMaxTargetLiberties < 1) throw new Error('tacticalMaxTargetLiberties must be a positive integer');
  if (merged.tierNodeBudgets.length === 0 || merged.tierNodeBudgets.some((value) => !Number.isInteger(value) || value < 1)) throw new Error('tierNodeBudgets must contain positive integers');
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

const unresolvedLocalKind = (result: LocalLifeDeathResult): UnresolvedKind => {
  const outcomes = [result.attackerFirst.outcome, result.defenderFirst.outcome];
  if (outcomes.includes('ko-dependent')) return 'ko';
  if (outcomes.includes('unknown-boundary')) return 'boundary';
  if (outcomes.includes('unknown-budget')) return 'budget';
  return 'other';
};

const unresolvedTacticalKind = (
  attackerFirst: TacticalReadResult,
  defenderFirst: TacticalReadResult,
): UnresolvedKind => {
  const outcomes: readonly TacticalReadOutcome[] = [attackerFirst.outcome, defenderFirst.outcome];
  if (outcomes.includes('ko-dependent')) return 'ko';
  if (outcomes.includes('unknown-budget')) return 'budget';
  if (outcomes.includes('unknown-boundary')) return 'boundary';
  return 'other';
};

const unknownRank: Readonly<Record<UnresolvedKind, number>> = Object.freeze({
  other: 0,
  budget: 1,
  boundary: 2,
  ko: 3,
});

const retainStrongerUnknown = (
  map: Map<string, UnresolvedKind>,
  key: string,
  value: UnresolvedKind,
): void => {
  const previous = map.get(key);
  if (!previous || unknownRank[value] > unknownRank[previous]) map.set(key, value);
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

  const safeGroupPoints = Object.freeze(
    staticProposal
      .filter((group) => group.status === 'alive' && group.source === 'automatic')
      .flatMap((group) => group.points),
  );

  let exploredNodes = 0;
  let attempts = 0;
  let resolvedAutomatically = 0;
  let completedGroups = 0;
  let stopReason: FinalProofSearchStopReason = 'complete';
  const resolvedKeys = new Set<string>();
  const processedKeys = new Set<string>();
  const lastUnknown = new Map<string, UnresolvedKind>();
  let currentTier = 0;
  let currentGroupKey: string | null = null;

  const markProcessed = (key: string): void => {
    if (processedKeys.has(key)) return;
    processedKeys.add(key);
    completedGroups += 1;
  };

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
    currentTier = 1;
    for (const candidate of candidates) {
      if (candidate.group.liberties.length > budget.tacticalMaxTargetLiberties) continue;
      if (hardDeadlineReached()) { stopReason = 'hard-time-budget'; break; }
      const remainingNodes = budget.maxGlobalNodes - exploredNodes;
      if (remainingNodes < 2) { stopReason = 'global-node-budget'; break; }

      currentGroupKey = candidate.group.key;
      const nodeBudget = Math.max(1, Math.min(budget.tacticalNodeBudget, Math.floor(remainingNodes / 2)));
      const shared = {
        maxDepth: TACTICAL_SAFETY_MAX_DEPTH,
        maxNodes: nodeBudget,
        maxTargetLiberties: budget.tacticalMaxTargetLiberties,
        safeGroupPoints,
        shouldStop: hardDeadlineReached,
      } as const;
      const attackerFirst = readTacticalCapture(candidate.group, context.state, context.topology, {
        ...shared,
        firstPlayer: 'attacker',
      });
      const defenderFirst = readTacticalCapture(candidate.group, context.state, context.topology, {
        ...shared,
        firstPlayer: 'defender',
      });
      attempts += 1;
      exploredNodes += totalTacticalNodes(attackerFirst, defenderFirst);
      markProcessed(candidate.group.key);

      const status = attackerFirst.outcome === 'proved-kill' && defenderFirst.outcome === 'proved-kill'
        ? 'dead' as const
        : attackerFirst.outcome === 'proved-survival' && defenderFirst.outcome === 'proved-survival'
          ? 'alive' as const
          : null;
      if (status) {
        output[candidate.proposalIndex] = Object.freeze({
          points: staticProposal[candidate.proposalIndex]!.points,
          status,
          source: 'automatic' as const,
          evidence: tacticalEvidenceFor(candidate.group, status, attackerFirst, defenderFirst, nodeBudget),
        });
        resolvedKeys.add(candidate.group.key);
        resolvedAutomatically += 1;
        lastUnknown.delete(candidate.group.key);
      } else {
        retainStrongerUnknown(lastUnknown, candidate.group.key, unresolvedTacticalKind(attackerFirst, defenderFirst));
      }
      emit();
      if (hardDeadlineReached()) { stopReason = 'hard-time-budget'; break; }
      await yieldToEventLoop();
    }

    if (stopReason === 'complete') {
      outer: for (let tierIndex = 0; tierIndex < budget.tierNodeBudgets.length; tierIndex += 1) {
        currentTier = tierIndex + 2;
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
            retainStrongerUnknown(lastUnknown, candidate.group.key, 'boundary');
            markProcessed(candidate.group.key);
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
          exploredNodes += totalLocalNodes(result);
          markProcessed(candidate.group.key);

          if (result.outcome === 'proved-dead' || result.outcome === 'proved-alive') {
            const status = result.outcome === 'proved-dead' ? 'dead' as const : 'alive' as const;
            output[candidate.proposalIndex] = Object.freeze({
              points: staticProposal[candidate.proposalIndex]!.points,
              status,
              source: 'automatic' as const,
              evidence: localEvidenceFor(result, currentTier, nodeBudget),
            });
            resolvedKeys.add(candidate.group.key);
            resolvedAutomatically += 1;
            lastUnknown.delete(candidate.group.key);
          } else {
            retainStrongerUnknown(lastUnknown, candidate.group.key, unresolvedLocalKind(result));
          }
          emit();
          if (hardDeadlineReached()) {
            stopReason = 'hard-time-budget';
            break outer;
          }
          await yieldToEventLoop();
        }
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