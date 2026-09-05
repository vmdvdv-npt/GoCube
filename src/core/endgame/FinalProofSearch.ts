import type {
  EndgameAnalysisContext,
  EndgameGroupProposal,
  EndgameProposal,
  FinalProofSearchProgress,
  FinalProofSearchProgressListener,
} from './EndgameClassifier';
import { endgameGroupId } from './EndgameGroupIdentity';
import {
  buildEndgameStaticGraph,
  type EndgameStaticGraph,
  type EndgameStoneString,
} from './EndgameStaticGraph';
import { proveBensonPassAlive } from './BensonPassAlive';
import { GameEngine } from '../game/GameEngine';
import type {
  BoardOccupancy,
  GameState,
  StoneColor,
} from '../game/types';
import type { PointId } from '../topology/Topology';

export const FINAL_PROOF_SEARCH_ALGORITHM = 'final-proof-search-v1';

export interface FinalProofSearchOptions {
  /** One global user-facing resource pool shared by all unresolved targets. */
  readonly globalNodeBudget: number;
  /** Hard production safety ceiling. Correctness tests should prefer node budgets. */
  readonly wallClockBudgetMs: number;
  /** Escalating per-order expansion budgets. */
  readonly tierNodeBudgets: readonly number[];
  /** Certified dependency components larger than this fail closed. */
  readonly maxRegionPoints: number;
  /** Safety fuse only; depth is deliberately not the primary budget. */
  readonly maxDepth: number;
}

export const DEFAULT_FINAL_PROOF_SEARCH_OPTIONS: FinalProofSearchOptions = Object.freeze({
  globalNodeBudget: 8_000,
  wallClockBudgetMs: 4_000,
  tierNodeBudgets: Object.freeze([160, 640, 2_400]),
  maxRegionPoints: 32,
  maxDepth: 64,
});

type SearchOutcome =
  | 'kill'
  | 'survive'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-depth'
  | 'unknown-cycle'
  | 'unknown';

interface SearchResult {
  readonly outcome: SearchOutcome;
  readonly principalVariation: readonly string[];
  readonly nodes: number;
  readonly maxDepth: number;
}

interface SearchNode {
  readonly state: GameState;
  readonly previousBoard: BoardOccupancy | null;
  readonly localPasses: number;
}

interface SearchBudget {
  readonly startedAt: number;
  readonly deadline: number;
  readonly globalNodeBudget: number;
  globalNodes: number;
}

interface SearchAttempt {
  readonly nodeBudget: number;
  nodes: number;
  maxDepth: number;
}

interface CertifiedRegion {
  readonly points: readonly PointId[];
  readonly boundaryAliveGroupKeys: readonly string[];
}

interface TargetTask {
  readonly group: EndgameStoneString;
  readonly proposalIndex: number;
  readonly region: CertifiedRegion | null;
  readonly priority: readonly number[];
  completed: boolean;
  lastAttackerFirst?: SearchResult;
  lastDefenderFirst?: SearchResult;
  tier: number;
  totalNodes: number;
  maxDepth: number;
}

export interface FinalProofSearchDiagnostics {
  readonly totalAnalysisMilliseconds: number;
  readonly nodesExplored: number;
  readonly totalTargets: number;
  readonly resolvedAlive: number;
  readonly resolvedDead: number;
  readonly unresolvedBoundary: number;
  readonly unresolvedBudget: number;
  readonly unresolvedKo: number;
  readonly unresolvedCritical: number;
}

export interface FinalProofSearchAnalysis {
  readonly proposal: EndgameProposal;
  readonly diagnostics: FinalProofSearchDiagnostics;
}

const nowMilliseconds = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const freezeAnalysisState = (
  template: GameState,
  currentPlayer: StoneColor,
): GameState =>
  Object.freeze({
    board: template.board,
    currentPlayer,
    moveNumber: template.moveNumber,
    consecutivePasses: 0,
    phase: 'playing' as const,
    captures: template.captures,
  });

const tenukiState = (state: GameState): GameState =>
  Object.freeze({
    board: state.board,
    currentPlayer: opponentOf(state.currentPlayer),
    moveNumber: state.moveNumber + 1,
    consecutivePasses: 0,
    phase: 'playing' as const,
    captures: state.captures,
  });

const yieldToBrowser = async (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const comparePriority = (left: TargetTask, right: TargetTask): number => {
  const length = Math.max(left.priority.length, right.priority.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.priority[index] ?? 0) - (right.priority[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.group.key < right.group.key ? -1 : left.group.key > right.group.key ? 1 : 0;
};

const countProposalStatuses = (proposal: EndgameProposal) => {
  let resolvedAutomatically = 0;
  let remainingUnresolved = 0;
  for (const group of proposal) {
    if (group.status === 'unresolved') remainingUnresolved += 1;
    else resolvedAutomatically += 1;
  }
  return { resolvedAutomatically, remainingUnresolved };
};

const progressSnapshot = (
  proposal: EndgameProposal,
  startedAt: number,
  budget: SearchBudget,
  totalRegions: number,
  completedRegions: number,
  currentGroupId: string | null,
  tier: number,
  phase: FinalProofSearchProgress['phase'],
): FinalProofSearchProgress => {
  const counts = countProposalStatuses(proposal);
  return Object.freeze({
    phase,
    totalRegions,
    completedRegions,
    currentGroupId,
    tier,
    resolvedAutomatically: counts.resolvedAutomatically,
    remainingUnresolved: counts.remainingUnresolved,
    nodesExplored: budget.globalNodes,
    elapsedMilliseconds: nowMilliseconds() - startedAt,
  });
};

const proposalWithEvidence = (
  original: EndgameGroupProposal,
  evidence: Readonly<Record<string, unknown>>,
): EndgameGroupProposal =>
  Object.freeze({
    points: original.points,
    status: 'unresolved' as const,
    evidence: Object.freeze({ ...evidence }),
  });

const proposalWithStatus = (
  original: EndgameGroupProposal,
  status: 'alive' | 'dead',
  evidence: Readonly<Record<string, unknown>>,
): EndgameGroupProposal =>
  Object.freeze({
    points: original.points,
    status,
    source: 'automatic' as const,
    evidence: Object.freeze({ ...evidence }),
  });

const buildAliveGroupKeys = (
  context: EndgameAnalysisContext,
  graph: EndgameStaticGraph,
): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const color of ['black', 'white'] as const) {
    const result = proveBensonPassAlive(context.state.board, context.topology, graph, color);
    for (const key of result.aliveGroups.keys()) keys.add(key);
  }
  return keys;
};

/**
 * The local component is certified by removing only Benson/pass-alive strings
 * from the dependency graph. Such strings are unconditional barriers: a local
 * proof never needs to consider an outside move that first captures one.
 *
 * If the remaining component grows beyond the configured limit, locality has
 * not been proved cheaply enough and the target fails closed as UNKNOWN_BOUNDARY.
 */
const certifyRegion = (
  context: EndgameAnalysisContext,
  graph: EndgameStaticGraph,
  target: EndgameStoneString,
  aliveGroupKeys: ReadonlySet<string>,
  maxRegionPoints: number,
): CertifiedRegion | null => {
  const pending = [...target.points];
  const visited = new Set<PointId>();
  const boundaryAliveGroupKeys = new Set<string>();

  while (pending.length > 0) {
    const point = pending.pop()!;
    if (visited.has(point)) continue;

    const owner = graph.stringByPoint.get(point);
    if (owner && owner !== target.key && aliveGroupKeys.has(owner)) {
      boundaryAliveGroupKeys.add(owner);
      continue;
    }

    visited.add(point);
    if (visited.size > maxRegionPoints) return null;

    for (const neighbor of context.topology.neighbors(point)) {
      if (visited.has(neighbor)) continue;
      const neighborOwner = graph.stringByPoint.get(neighbor);
      if (neighborOwner && neighborOwner !== target.key && aliveGroupKeys.has(neighborOwner)) {
        boundaryAliveGroupKeys.add(neighborOwner);
        continue;
      }
      pending.push(neighbor);
    }
  }

  return Object.freeze({
    points: Object.freeze([...visited].sort()),
    boundaryAliveGroupKeys: Object.freeze([...boundaryAliveGroupKeys].sort()),
  });
};

const boardKey = (
  board: BoardOccupancy,
  orderedPoints: readonly PointId[],
): string =>
  orderedPoints
    .map((point) => {
      const occupancy = board[point];
      return occupancy === 'black' ? 'B' : occupancy === 'white' ? 'W' : '.';
    })
    .join('');

const searchKey = (
  node: SearchNode,
  orderedPoints: readonly PointId[],
): string =>
  `${node.state.currentPlayer}|${node.localPasses}|${boardKey(node.state.board, orderedPoints)}|${
    node.previousBoard ? boardKey(node.previousBoard, orderedPoints) : '-'
  }`;

const targetCaptured = (
  node: SearchNode,
  crucialStones: readonly PointId[],
  targetColor: StoneColor,
): boolean => crucialStones.every((point) => node.state.board[point] !== targetColor);

const targetBensonAlive = (
  node: SearchNode,
  engine: GameEngine,
  context: EndgameAnalysisContext,
  crucialStones: readonly PointId[],
  targetColor: StoneColor,
  terminalCache: Map<string, boolean>,
  orderedPoints: readonly PointId[],
): boolean => {
  const surviving = crucialStones.find((point) => node.state.board[point] === targetColor);
  if (!surviving) return false;

  const cacheKey = `${targetColor}:${boardKey(node.state.board, orderedPoints)}`;
  const cached = terminalCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const currentGroup = engine.groupAt(node.state, surviving);
  if (!currentGroup) {
    terminalCache.set(cacheKey, false);
    return false;
  }

  const graph = buildEndgameStaticGraph(node.state.board, context.topology);
  const result = proveBensonPassAlive(node.state.board, context.topology, graph, targetColor);
  const alive = result.aliveGroups.has(endgameGroupId(currentGroup.points));
  terminalCache.set(cacheKey, alive);
  return alive;
};

const unknownPrecedence: readonly SearchOutcome[] = Object.freeze([
  'ko-dependent',
  'unknown-budget',
  'unknown-depth',
  'unknown-cycle',
  'unknown',
]);

const dominantUnknown = (results: readonly SearchResult[]): SearchOutcome => {
  for (const outcome of unknownPrecedence) {
    if (results.some((result) => result.outcome === outcome)) return outcome;
  }
  return 'unknown';
};

const withMove = (move: string, result: SearchResult): SearchResult =>
  Object.freeze({
    ...result,
    principalVariation: Object.freeze([move, ...result.principalVariation]),
  });

const resolvedResult = (
  outcome: 'kill' | 'survive',
  principalVariation: readonly string[],
  attempt: SearchAttempt,
): SearchResult =>
  Object.freeze({
    outcome,
    principalVariation: Object.freeze([...principalVariation]),
    nodes: attempt.nodes,
    maxDepth: attempt.maxDepth,
  });

const unknownResult = (
  outcome: Exclude<SearchOutcome, 'kill' | 'survive'>,
  attempt: SearchAttempt,
  principalVariation: readonly string[] = [],
): SearchResult =>
  Object.freeze({
    outcome,
    principalVariation: Object.freeze([...principalVariation]),
    nodes: attempt.nodes,
    maxDepth: attempt.maxDepth,
  });

const runOrderSearch = (
  context: EndgameAnalysisContext,
  target: EndgameStoneString,
  region: CertifiedRegion,
  firstPlayer: StoneColor,
  nodeBudget: number,
  budget: SearchBudget,
  options: FinalProofSearchOptions,
): SearchResult => {
  const engine = new GameEngine(context.topology);
  const orderedPoints = Object.freeze([...context.topology.points()].sort());
  const regionPoints = Object.freeze([...region.points].sort());
  const crucialStones = Object.freeze([...target.points]);
  const targetColor = target.color;
  const attackerColor = opponentOf(targetColor);
  const attempt: SearchAttempt = { nodeBudget, nodes: 0, maxDepth: 0 };
  const resolvedCache = new Map<string, SearchResult>();
  const terminalCache = new Map<string, boolean>();
  const active = new Set<string>();

  const recurse = (node: SearchNode, depth: number): SearchResult => {
    attempt.maxDepth = Math.max(attempt.maxDepth, depth);

    if (targetCaptured(node, crucialStones, targetColor)) {
      return resolvedResult('kill', [], attempt);
    }
    if (
      targetBensonAlive(
        node,
        engine,
        context,
        crucialStones,
        targetColor,
        terminalCache,
        orderedPoints,
      )
    ) {
      return resolvedResult('survive', [], attempt);
    }

    if (depth >= options.maxDepth) return unknownResult('unknown-depth', attempt);
    if (
      attempt.nodes >= attempt.nodeBudget ||
      budget.globalNodes >= budget.globalNodeBudget ||
      nowMilliseconds() >= budget.deadline
    ) {
      return unknownResult('unknown-budget', attempt);
    }

    const key = searchKey(node, orderedPoints);
    const cached = resolvedCache.get(key);
    if (cached) return cached;
    if (active.has(key)) return unknownResult('unknown-cycle', attempt);

    active.add(key);
    attempt.nodes += 1;
    budget.globalNodes += 1;

    const currentGroupPoint = crucialStones.find(
      (point) => node.state.board[point] === targetColor,
    );
    const currentGroup = currentGroupPoint
      ? engine.groupAt(node.state, currentGroupPoint)
      : null;
    const targetLiberties = new Set(currentGroup?.liberties ?? []);

    const candidatePoints = regionPoints
      .filter((point) => node.state.board[point] === 'empty')
      .sort((left, right) => {
        const leftPriority = targetLiberties.has(left) ? 0 : 1;
        const rightPriority = targetLiberties.has(right) ? 0 : 1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return left < right ? -1 : left > right ? 1 : 0;
      });

    const children: SearchResult[] = [];
    for (const point of candidatePoints) {
      const result = engine.placeStone(
        node.state,
        point,
        node.state.currentPlayer,
        Object.freeze({ previousBoard: node.previousBoard }),
      );
      if (!result.ok) {
        if (result.reason === 'repetition') {
          children.push(withMove(point, unknownResult('ko-dependent', attempt)));
        }
        continue;
      }

      const child = recurse(
        Object.freeze({
          state: result.state,
          previousBoard: node.state.board,
          localPasses: 0,
        }),
        depth + 1,
      );
      children.push(withMove(point, child));

      const attackerTurn = node.state.currentPlayer === attackerColor;
      if (attackerTurn && child.outcome === 'kill') break;
      if (!attackerTurn && child.outcome === 'survive') break;
    }

    // Tenuki is an explicit local action. An outside move changes the global
    // board, so immediate simple-ko comparison is cleared for the next local
    // turn even though this local projection keeps the same stones.
    if (node.localPasses >= 1) {
      children.push(withMove('tenuki', unknownResult('unknown', attempt)));
    } else {
      const child = recurse(
        Object.freeze({
          state: tenukiState(node.state),
          previousBoard: null,
          localPasses: node.localPasses + 1,
        }),
        depth + 1,
      );
      children.push(withMove('tenuki', child));
    }

    active.delete(key);

    const attackerTurn = node.state.currentPlayer === attackerColor;
    let result: SearchResult;
    if (attackerTurn) {
      const winning = children.find((child) => child.outcome === 'kill');
      if (winning) {
        result = resolvedResult('kill', winning.principalVariation, attempt);
      } else if (children.length > 0 && children.every((child) => child.outcome === 'survive')) {
        result = resolvedResult('survive', children[0]?.principalVariation ?? [], attempt);
      } else {
        const dominant = dominantUnknown(children);
        const representative = children.find((child) => child.outcome === dominant);
        result = unknownResult(dominant, attempt, representative?.principalVariation ?? []);
      }
    } else {
      const saving = children.find((child) => child.outcome === 'survive');
      if (saving) {
        result = resolvedResult('survive', saving.principalVariation, attempt);
      } else if (children.length > 0 && children.every((child) => child.outcome === 'kill')) {
        result = resolvedResult('kill', children[0]?.principalVariation ?? [], attempt);
      } else {
        const dominant = dominantUnknown(children);
        const representative = children.find((child) => child.outcome === dominant);
        result = unknownResult(dominant, attempt, representative?.principalVariation ?? []);
      }
    }

    if (result.outcome === 'kill' || result.outcome === 'survive') {
      resolvedCache.set(key, result);
    }
    return result;
  };

  const root: SearchNode = Object.freeze({
    state: freezeAnalysisState(context.state, firstPlayer),
    previousBoard: context.simpleKoContext?.previousBoard ?? null,
    localPasses: 0,
  });
  const result = recurse(root, 0);
  return Object.freeze({
    ...result,
    nodes: attempt.nodes,
    maxDepth: attempt.maxDepth,
  });
};

const evidenceForTask = (
  task: TargetTask,
  outcome: string,
  proofReason: string,
  startedAt: number,
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
    outcome,
    proofReason,
    targetGroup: Object.freeze([...task.group.points]),
    relevanceZoneSize: task.region?.points.length ?? null,
    relevanceZone: task.region ? Object.freeze([...task.region.points]) : Object.freeze([]),
    boundaryAliveGroupKeys: task.region?.boundaryAliveGroupKeys ?? Object.freeze([]),
    exploredNodes: task.totalNodes,
    maxDepth: task.maxDepth,
    tier: task.tier,
    firstPlayerOrders: Object.freeze({
      attackerFirst: task.lastAttackerFirst
        ? Object.freeze({
            outcome: task.lastAttackerFirst.outcome,
            principalVariation: task.lastAttackerFirst.principalVariation,
            nodes: task.lastAttackerFirst.nodes,
            maxDepth: task.lastAttackerFirst.maxDepth,
          })
        : null,
      defenderFirst: task.lastDefenderFirst
        ? Object.freeze({
            outcome: task.lastDefenderFirst.outcome,
            principalVariation: task.lastDefenderFirst.principalVariation,
            nodes: task.lastDefenderFirst.nodes,
            maxDepth: task.lastDefenderFirst.maxDepth,
          })
        : null,
    }),
    elapsedMilliseconds: nowMilliseconds() - startedAt,
  });

const resolvedPairStatus = (
  attackerFirst: SearchResult,
  defenderFirst: SearchResult,
): 'dead' | 'alive' | 'critical' | 'ko-dependent' | 'pending' => {
  if (attackerFirst.outcome === 'kill' && defenderFirst.outcome === 'kill') return 'dead';
  if (attackerFirst.outcome === 'survive' && defenderFirst.outcome === 'survive') return 'alive';
  if (
    (attackerFirst.outcome === 'kill' && defenderFirst.outcome === 'survive') ||
    (attackerFirst.outcome === 'survive' && defenderFirst.outcome === 'kill')
  ) {
    return 'critical';
  }
  if (
    attackerFirst.outcome === 'ko-dependent' ||
    defenderFirst.outcome === 'ko-dependent'
  ) {
    return 'ko-dependent';
  }
  return 'pending';
};

const validateOptions = (options: FinalProofSearchOptions): void => {
  if (!Number.isInteger(options.globalNodeBudget) || options.globalNodeBudget <= 0) {
    throw new Error('Final proof globalNodeBudget must be a positive integer');
  }
  if (!Number.isFinite(options.wallClockBudgetMs) || options.wallClockBudgetMs <= 0) {
    throw new Error('Final proof wallClockBudgetMs must be positive');
  }
  if (!Number.isInteger(options.maxRegionPoints) || options.maxRegionPoints <= 0) {
    throw new Error('Final proof maxRegionPoints must be a positive integer');
  }
  if (!Number.isInteger(options.maxDepth) || options.maxDepth <= 0) {
    throw new Error('Final proof maxDepth must be a positive integer');
  }
  if (
    options.tierNodeBudgets.length === 0 ||
    options.tierNodeBudgets.some((value) => !Number.isInteger(value) || value <= 0)
  ) {
    throw new Error('Final proof tierNodeBudgets must contain positive integers');
  }
};

export const analyzeFinalProofSearch = async (
  context: EndgameAnalysisContext,
  baseline: EndgameProposal,
  options: FinalProofSearchOptions = DEFAULT_FINAL_PROOF_SEARCH_OPTIONS,
  onProgress?: FinalProofSearchProgressListener,
): Promise<FinalProofSearchAnalysis> => {
  validateOptions(options);
  const startedAt = nowMilliseconds();
  const budget: SearchBudget = {
    startedAt,
    deadline: startedAt + options.wallClockBudgetMs,
    globalNodeBudget: options.globalNodeBudget,
    globalNodes: 0,
  };

  if (context.state.phase !== 'endgame' || context.state.consecutivePasses < 2) {
    return Object.freeze({
      proposal: baseline,
      diagnostics: Object.freeze({
        totalAnalysisMilliseconds: nowMilliseconds() - startedAt,
        nodesExplored: 0,
        totalTargets: 0,
        resolvedAlive: 0,
        resolvedDead: 0,
        unresolvedBoundary: 0,
        unresolvedBudget: 0,
        unresolvedKo: 0,
        unresolvedCritical: 0,
      }),
    });
  }

  const graph = buildEndgameStaticGraph(context.state.board, context.topology);
  const aliveGroupKeys = buildAliveGroupKeys(context, graph);
  const mutableProposal = [...baseline];
  const baselineByKey = new Map(
    baseline.map((group, index) => [endgameGroupId(group.points), { group, index }] as const),
  );
  const tasks: TargetTask[] = [];

  for (const group of graph.strings) {
    const baselineEntry = baselineByKey.get(group.key);
    if (!baselineEntry || baselineEntry.group.status !== 'unresolved') continue;
    const region = certifyRegion(
      context,
      graph,
      group,
      aliveGroupKeys,
      options.maxRegionPoints,
    );
    const regionSize = region?.points.length ?? Number.MAX_SAFE_INTEGER;
    tasks.push({
      group,
      proposalIndex: baselineEntry.index,
      region,
      priority: Object.freeze([
        region ? 0 : 1,
        group.liberties.length,
        regionSize,
        group.points.length,
      ]),
      completed: false,
      tier: 0,
      totalNodes: 0,
      maxDepth: 0,
    });
  }
  tasks.sort(comparePriority);

  let completedRegions = 0;
  let resolvedAlive = 0;
  let resolvedDead = 0;
  let unresolvedBoundary = 0;
  let unresolvedBudget = 0;
  let unresolvedKo = 0;
  let unresolvedCritical = 0;

  const emit = (
    currentGroupId: string | null,
    tier: number,
    phase: FinalProofSearchProgress['phase'] = 'searching',
  ): void => {
    onProgress?.(
      progressSnapshot(
        Object.freeze([...mutableProposal]),
        startedAt,
        budget,
        tasks.length,
        completedRegions,
        currentGroupId,
        tier,
        phase,
      ),
    );
  };

  emit(null, 0);
  await yieldToBrowser();

  // Fail closed immediately for targets whose locality could not be certified.
  for (const task of tasks) {
    if (task.region) continue;
    task.completed = true;
    completedRegions += 1;
    unresolvedBoundary += 1;
    mutableProposal[task.proposalIndex] = proposalWithEvidence(
      baseline[task.proposalIndex]!,
      evidenceForTask(
        task,
        'UNKNOWN_BOUNDARY',
        'certified-relevance-region-exceeds-limit',
        startedAt,
      ),
    );
  }

  for (let tierIndex = 0; tierIndex < options.tierNodeBudgets.length; tierIndex += 1) {
    const nodeBudget = options.tierNodeBudgets[tierIndex]!;
    for (const task of tasks) {
      if (task.completed || !task.region) continue;
      if (
        budget.globalNodes >= budget.globalNodeBudget ||
        nowMilliseconds() >= budget.deadline
      ) {
        break;
      }

      task.tier = tierIndex + 1;
      emit(task.group.key, task.tier);
      await yieldToBrowser();

      const attacker = opponentOf(task.group.color);
      const beforeFirst = budget.globalNodes;
      const attackerFirst = runOrderSearch(
        context,
        task.group,
        task.region,
        attacker,
        nodeBudget,
        budget,
        options,
      );
      const firstNodes = budget.globalNodes - beforeFirst;

      const beforeSecond = budget.globalNodes;
      const defenderFirst = runOrderSearch(
        context,
        task.group,
        task.region,
        task.group.color,
        nodeBudget,
        budget,
        options,
      );
      const secondNodes = budget.globalNodes - beforeSecond;

      task.lastAttackerFirst = attackerFirst;
      task.lastDefenderFirst = defenderFirst;
      task.totalNodes += firstNodes + secondNodes;
      task.maxDepth = Math.max(
        task.maxDepth,
        attackerFirst.maxDepth,
        defenderFirst.maxDepth,
      );

      const pair = resolvedPairStatus(attackerFirst, defenderFirst);
      if (pair === 'dead' || pair === 'alive') {
        task.completed = true;
        completedRegions += 1;
        if (pair === 'dead') resolvedDead += 1;
        else resolvedAlive += 1;
        mutableProposal[task.proposalIndex] = proposalWithStatus(
          baseline[task.proposalIndex]!,
          pair,
          evidenceForTask(
            task,
            pair === 'dead' ? 'PROVED_DEAD' : 'PROVED_ALIVE',
            pair === 'dead'
              ? 'forced-kill-in-both-first-player-orders'
              : 'formal-survival-in-both-first-player-orders',
            startedAt,
          ),
        );
      } else if (pair === 'critical') {
        task.completed = true;
        completedRegions += 1;
        unresolvedCritical += 1;
        mutableProposal[task.proposalIndex] = proposalWithEvidence(
          baseline[task.proposalIndex]!,
          evidenceForTask(task, 'CRITICAL', 'result-depends-on-first-local-player', startedAt),
        );
      } else if (pair === 'ko-dependent') {
        task.completed = true;
        completedRegions += 1;
        unresolvedKo += 1;
        mutableProposal[task.proposalIndex] = proposalWithEvidence(
          baseline[task.proposalIndex]!,
          evidenceForTask(task, 'KO_DEPENDENT', 'proof-depends-on-ko', startedAt),
        );
      }

      emit(task.group.key, task.tier);
    }
  }

  for (const task of tasks) {
    if (task.completed) continue;
    task.completed = true;
    completedRegions += 1;
    unresolvedBudget += 1;
    mutableProposal[task.proposalIndex] = proposalWithEvidence(
      baseline[task.proposalIndex]!,
      evidenceForTask(
        task,
        'UNKNOWN_BUDGET',
        budget.globalNodes >= budget.globalNodeBudget
          ? 'global-node-budget-exhausted'
          : nowMilliseconds() >= budget.deadline
            ? 'global-wall-clock-budget-exhausted'
            : 'tier-budgets-exhausted-without-proof',
        startedAt,
      ),
    );
  }

  const proposal = Object.freeze(mutableProposal);
  emit(null, options.tierNodeBudgets.length, 'complete');

  return Object.freeze({
    proposal,
    diagnostics: Object.freeze({
      totalAnalysisMilliseconds: nowMilliseconds() - startedAt,
      nodesExplored: budget.globalNodes,
      totalTargets: tasks.length,
      resolvedAlive,
      resolvedDead,
      unresolvedBoundary,
      unresolvedBudget,
      unresolvedKo,
      unresolvedCritical,
    }),
  });
};
