import type {
  EndgameAnalysisContext,
  EndgameClassifier,
  EndgameProposal,
} from './EndgameClassifier';
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
  KATAGO_REFERENCE_COMMIT,
  KATAGO_RULES_VERSION,
  tryProveBensonPassAlive,
  type BensonColorRegion,
} from './BensonPassAlive';
import {
  tryBuildEndgameStaticGraph,
  type EndgameStaticGraph,
} from './EndgameStaticGraph';
import { endgameGroupId } from './EndgameGroupIdentity';
import {
  DEFAULT_FINAL_PROOF_SEARCH_BUDGET,
  FINAL_PROOF_SEARCH_ALGORITHM,
  resolveFinalProofSearchBudget,
  runFinalProofSearch,
  type FinalProofSearchBudget,
  type FinalProofSearchProgress,
} from './FinalProofSearch';
import type { FinalProofSearchRunController } from './FinalProofSearchRunController';
import { ManualEndgameClassifier } from './ManualEndgameClassifier';
import {
  PASS_ALIVE_TERRITORY_ALGORITHM,
  buildPassAliveTerritory,
  type PassAliveTerritoryResult,
} from './PassAliveTerritory';
import { ProofSearchControl } from './ProofSearchControl';
import type { StoneColor } from '../game/types';

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);
export const PASS_ALIVE_TERRITORY_DEAD_ALGORITHM =
  'katago-pass-alive-territory-dead-v1';

export interface FinalGroupJudgeDiagnostics {
  readonly totalAnalysisMilliseconds: number;
  readonly groupCount: number;
  readonly emptyRegionCount: number;
  readonly bensonIterations: number;
  readonly bensonIterationsByColor: Readonly<{ black: number; white: number }>;
  readonly counts: Readonly<{
    alive: number;
    dead: number;
    seki: number;
    unresolved: number;
  }>;
}

export interface FinalGroupJudgeAnalysis {
  readonly proposal: EndgameProposal;
  readonly diagnostics: FinalGroupJudgeDiagnostics;
  readonly passAliveTerritory: PassAliveTerritoryResult;
}

export interface FinalGroupJudgeOptions {
  readonly control?: ProofSearchControl;
}

export interface AssistedEndgameClassifierOptions {
  readonly runController?: FinalProofSearchRunController;
  readonly budget?: Partial<FinalProofSearchBudget>;
  readonly now?: () => number;
  readonly yieldControl?: () => Promise<void>;
}

interface TerritoryDeadProof extends Readonly<Record<string, unknown>> {
  readonly algorithm: typeof PASS_ALIVE_TERRITORY_DEAD_ALGORITHM;
  readonly proof: 'group-inside-opponent-pass-alive-territory';
  readonly territoryAlgorithm: typeof PASS_ALIVE_TERRITORY_ALGORITHM;
  readonly territoryOwner: StoneColor;
  readonly territoryRegionKeys: readonly string[];
  readonly kataGoRulesVersion: typeof KATAGO_RULES_VERSION;
  readonly kataGoCommit: typeof KATAGO_REFERENCE_COMMIT;
}

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

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const emptyTerritoryResult = (): PassAliveTerritoryResult =>
  Object.freeze({
    algorithm: PASS_ALIVE_TERRITORY_ALGORITHM,
    kataGoRulesVersion: KATAGO_RULES_VERSION,
    kataGoCommit: KATAGO_REFERENCE_COMMIT,
    black: Object.freeze([]),
    white: Object.freeze([]),
    ownerByPoint: new Map(),
    regions: Object.freeze([]),
  });

const proposalCounts = (proposal: EndgameProposal) => {
  let alive = 0;
  let dead = 0;
  let seki = 0;
  let unresolved = 0;
  for (const group of proposal) {
    if (group.status === 'alive') alive += 1;
    else if (group.status === 'dead') dead += 1;
    else if (group.status === 'seki') seki += 1;
    else unresolved += 1;
  }
  return Object.freeze({ alive, dead, seki, unresolved });
};

const assertCompleteContext = (
  baseline: EndgameProposal,
  graph: EndgameStaticGraph,
): boolean =>
  baseline.length === graph.strings.length &&
  baseline.every((proposal) => graph.stringsByKey.has(endgameGroupId(proposal.points)));

const territoryDeadProofForGroup = (
  groupKey: string,
  graph: EndgameStaticGraph,
  territory: PassAliveTerritoryResult,
): TerritoryDeadProof | null => {
  const group = graph.stringsByKey.get(groupKey);
  if (!group) throw new Error(`Missing endgame group: ${groupKey}`);
  const owner = opponentOf(group.color);

  if (!group.points.every((point) => territory.ownerByPoint.get(point) === owner)) {
    return null;
  }

  const regionKeys = territory.regions
    .filter(
      (region) =>
        region.owner === owner &&
        group.points.some((point) => region.points.includes(point)),
    )
    .map((region) => region.key)
    .sort();

  if (regionKeys.length === 0) {
    throw new Error(`Pass-alive territory has no evidence region for dead group: ${groupKey}`);
  }

  return Object.freeze({
    algorithm: PASS_ALIVE_TERRITORY_DEAD_ALGORITHM,
    proof: 'group-inside-opponent-pass-alive-territory',
    territoryAlgorithm: PASS_ALIVE_TERRITORY_ALGORITHM,
    territoryOwner: owner,
    territoryRegionKeys: Object.freeze(regionKeys),
    kataGoRulesVersion: KATAGO_RULES_VERSION,
    kataGoCommit: KATAGO_REFERENCE_COMMIT,
  });
};

export const assertFinalGroupJudgeProofConsistency = (
  groupKey: string,
  statuses: readonly string[],
): void => {
  const unique = new Set(statuses);
  if (unique.size > 1) {
    throw new Error(
      `Final group judge correctness error for ${groupKey}: conflicting proofs ${[
        ...unique,
      ].join(', ')}`,
    );
  }
};

const baselineAnalysis = (
  baseline: EndgameProposal,
  started: number,
  now: () => number,
  groupCount: number,
  emptyRegionCount = 0,
): FinalGroupJudgeAnalysis => Object.freeze({
  proposal: baseline,
  passAliveTerritory: emptyTerritoryResult(),
  diagnostics: Object.freeze({
    totalAnalysisMilliseconds: Math.max(0, now() - started),
    groupCount,
    emptyRegionCount,
    bensonIterations: 0,
    bensonIterationsByColor: Object.freeze({ black: 0, white: 0 }),
    counts: proposalCounts(baseline),
  }),
});

/** Static/cheap KataGo-style judge. Kept separately for diagnostics and baseline benchmarks. */
export const analyzeFinalGroupJudge = async (
  context: EndgameAnalysisContext,
  options: FinalGroupJudgeOptions = {},
): Promise<FinalGroupJudgeAnalysis> => {
  const control = options.control;
  const now = control ? () => control.now() : nowMilliseconds;
  const started = now();
  const baseline = await new ManualEndgameClassifier().analyze(context);
  if (control?.syncCheckpoint('static-graph-preparation')) {
    return baselineAnalysis(baseline, started, now, context.groups.length);
  }
  const graph = tryBuildEndgameStaticGraph(context.state.board, context.topology, {
    shouldStop: control?.shouldStop,
  });
  if (!graph) return baselineAnalysis(baseline, started, now, context.groups.length);

  if (
    context.state.phase !== 'endgame' ||
    context.state.consecutivePasses < 2 ||
    !assertCompleteContext(baseline, graph)
  ) {
    return baselineAnalysis(
      baseline,
      started,
      now,
      graph.strings.length,
      graph.emptyRegions.length,
    );
  }

  control?.setOperation('static-benson-black');
  const blackBenson = tryProveBensonPassAlive(
    context.state.board,
    context.topology,
    graph,
    'black',
    { shouldStop: control?.shouldStop },
  );
  control?.setOperation('static-benson-white');
  const whiteBenson = blackBenson
    ? tryProveBensonPassAlive(
        context.state.board,
        context.topology,
        graph,
        'white',
        { shouldStop: control?.shouldStop },
      )
    : null;
  if (!blackBenson || !whiteBenson) {
    return baselineAnalysis(
      baseline,
      started,
      now,
      graph.strings.length,
      graph.emptyRegions.length,
    );
  }
  const bensonByColor = { black: blackBenson, white: whiteBenson } as const;

  const aliveProofs = new Map<string, readonly BensonColorRegion[]>();
  for (const color of COLORS) {
    for (const [groupKey, vitalRegions] of bensonByColor[color].aliveGroups) {
      aliveProofs.set(groupKey, vitalRegions);
    }
  }
  const aliveGroupKeys = new Set(aliveProofs.keys());

  control?.setOperation('static-pass-alive-territory');
  const passAliveTerritory = buildPassAliveTerritory(
    graph,
    bensonByColor.black,
    bensonByColor.white,
    { shouldStop: control?.shouldStop },
  );

  const territoryDeadProofs = new Map<string, TerritoryDeadProof>();
  for (const group of graph.strings) {
    if (control?.syncCheckpoint('static-territory-dead')) break;
    const proof = territoryDeadProofForGroup(group.key, graph, passAliveTerritory);
    if (proof) territoryDeadProofs.set(group.key, proof);
  }

  const strictDeadProofs = new Map<string, AutomaticDeadProof>();
  for (const candidate of generateDeadCandidates(graph.stringsByKey, aliveGroupKeys)) {
    if (control?.syncCheckpoint('static-strict-dead')) break;
    const verification = verifyDeadCandidate(candidate, {
      state: context.state,
      topology: context.topology,
      groups: graph.stringsByKey,
      pointOwner: graph.stringByPoint,
      passAliveGroupKeys: aliveGroupKeys,
    });
    if (verification.proven) strictDeadProofs.set(candidate.groupKey, verification.evidence);
  }

  const sekiProofs = new Map<string, AutomaticSekiProof>();
  for (const candidate of generateSekiCandidates(graph.stringsByKey, new Set())) {
    if (control?.syncCheckpoint('static-strict-seki')) break;
    const verification = verifySekiCandidate(candidate, {
      state: context.state,
      topology: context.topology,
      groups: graph.stringsByKey,
      pointOwner: graph.stringByPoint,
    });
    if (!verification.proven) continue;
    for (const groupKey of candidate.groupKeys) {
      sekiProofs.set(groupKey, verification.evidence);
    }
  }

  for (const group of graph.strings) {
    const statuses: string[] = [];
    if (aliveProofs.has(group.key)) statuses.push('alive');
    if (territoryDeadProofs.has(group.key) || strictDeadProofs.has(group.key)) statuses.push('dead');
    if (sekiProofs.has(group.key)) statuses.push('seki');
    assertFinalGroupJudgeProofConsistency(group.key, statuses);
  }

  const proposal = Object.freeze(
    baseline.map((base) => {
      const groupKey = endgameGroupId(base.points);
      const vitalRegions = aliveProofs.get(groupKey);
      if (vitalRegions) {
        return Object.freeze({
          points: base.points,
          status: 'alive' as const,
          source: 'automatic' as const,
          evidence: Object.freeze({
            algorithm: BENSON_PASS_ALIVE_ALGORITHM,
            proof: 'two-vital-regions',
            semantics: 'katago-rules-v3',
            vitalRegions: Object.freeze(vitalRegions.map((region) => region.points)),
            kataGoRulesVersion: KATAGO_RULES_VERSION,
            kataGoCommit: KATAGO_REFERENCE_COMMIT,
          }),
        });
      }

      const strictDeadProof = strictDeadProofs.get(groupKey);
      if (strictDeadProof) {
        return Object.freeze({
          points: base.points,
          status: 'dead' as const,
          source: 'automatic' as const,
          evidence: Object.freeze({ ...strictDeadProof }),
        });
      }

      const territoryDeadProof = territoryDeadProofs.get(groupKey);
      if (territoryDeadProof) {
        return Object.freeze({
          points: base.points,
          status: 'dead' as const,
          source: 'automatic' as const,
          evidence: territoryDeadProof,
        });
      }

      const sekiProof = sekiProofs.get(groupKey);
      if (sekiProof) {
        return Object.freeze({
          points: base.points,
          status: 'seki' as const,
          source: 'automatic' as const,
          evidence: Object.freeze({ ...sekiProof }),
        });
      }

      return base;
    }),
  );

  return Object.freeze({
    proposal,
    passAliveTerritory,
    diagnostics: Object.freeze({
      totalAnalysisMilliseconds: Math.max(0, now() - started),
      groupCount: graph.strings.length,
      emptyRegionCount: graph.emptyRegions.length,
      bensonIterations: bensonByColor.black.iterations + bensonByColor.white.iterations,
      bensonIterationsByColor: Object.freeze({
        black: bensonByColor.black.iterations,
        white: bensonByColor.white.iterations,
      }),
      counts: proposalCounts(proposal),
    }),
  });
};

const initialProgress = (
  analysisId: string,
  groupsTotal: number,
): FinalProofSearchProgress => Object.freeze({
  algorithm: FINAL_PROOF_SEARCH_ALGORITHM,
  analysisId,
  groupsTotal,
  groupsCompleted: 0,
  groupsPending: groupsTotal,
  currentGroup: null,
  currentTier: 0,
  currentTierName: 'candidate-preparation' as const,
  currentTierIndex: 0,
  currentTierBudget: 0,
  exploredNodes: 0,
  elapsedMilliseconds: 0,
  totalUnresolvedGroups: groupsTotal,
  completedGroups: 0,
  resolvedAutomatically: 0,
  remainingUnresolved: groupsTotal,
  currentGroupKey: null,
});

/**
 * Production final judge. One absolute request-scoped deadline covers static
 * preparation and every dynamic proof layer. The optional run controller is
 * supplied by the owning GameSession/controller and keeps progress/cancellation
 * isolated from other concurrent games.
 */
export class AssistedEndgameClassifier implements EndgameClassifier {
  private readonly options: AssistedEndgameClassifierOptions;

  constructor(options: AssistedEndgameClassifierOptions = {}) {
    this.options = options;
  }

  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    const budget = resolveFinalProofSearchBudget(
      this.options.budget ?? DEFAULT_FINAL_PROOF_SEARCH_BUDGET,
    );
    const now = this.options.now ?? nowMilliseconds;
    const startedAt = now();
    const run = this.options.runController?.begin();
    const analysisId = run?.analysisId ?? createAnalysisId();
    const control = new ProofSearchControl({
      analysisId,
      startedAt,
      hardDeadline: startedAt + budget.hardWallClockMilliseconds,
      now,
      shouldCancel: run?.shouldStop,
      cooperativeQuantumMilliseconds: budget.cooperativeQuantumMilliseconds,
      yieldControl: this.options.yieldControl,
    });

    run?.publish(initialProgress(analysisId, context.groups.length));
    try {
      await control.checkpoint('analysis-start', true);
      const staticAnalysis = await analyzeFinalGroupJudge(context, { control });
      if (context.state.phase !== 'endgame' || context.state.consecutivePasses < 2) {
        return staticAnalysis.proposal;
      }
      if (control.shouldStop()) return staticAnalysis.proposal;

      return (
        await runFinalProofSearch(context, staticAnalysis.proposal, {
          budget,
          control,
          onProgress: run?.publish,
        })
      ).proposal;
    } finally {
      run?.finish();
    }
  }
}
