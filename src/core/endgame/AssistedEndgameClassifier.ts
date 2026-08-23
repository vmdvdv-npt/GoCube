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
  proveBensonPassAlive,
  type BensonColorRegion,
} from './BensonPassAlive';
import {
  buildEndgameGraph,
  type EndgameGraph,
  type EndgameStoneString,
} from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import {
  LOCAL_LIFE_DEATH_ALGORITHM,
  readLocalLifeDeath,
  type LocalLifeDeathOrderResult,
  type LocalLifeDeathResult,
} from './LocalLifeDeathReader';
import { ManualEndgameClassifier } from './ManualEndgameClassifier';
import { proveSafeConnectionToBenson, type SafeConnectionProof } from './SafeConnection';
import {
  BASIC_SEKI_ALGORITHM,
  analyzeBasicSeki,
  type BasicSekiInitiationResult,
} from './SekiSearch';
import {
  SIMPLE_SEMEAI_ALGORITHM,
  analyzeSimpleSemeai,
  type SimpleSemeaiResult,
} from './SemeaiCore';
import {
  BOUNDED_SEMEAI_ALGORITHM,
  analyzeBoundedSemeai,
  type BoundedSemeaiOrderResult,
  type BoundedSemeaiResult,
} from './SemeaiSearch';
import {
  TACTICAL_READER_ALGORITHM,
  readTacticalCapture,
  type TacticalDeadProof,
} from './TacticalReader';
import type { StoneColor } from '../game/types';
import type { PointId } from '../topology/Topology';

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);
const TACTICAL_CLASSIFIER_MAX_NODES = 16;
const LOCAL_LIFE_DEATH_CLASSIFIER_MAX_NODES = 256;
const LOCAL_LIFE_DEATH_CLASSIFIER_MAX_ZONE_POINTS = 24;
const SEMEAI_CLASSIFIER_MAX_NODES = 64;
const SEMEAI_CLASSIFIER_MAX_ZONE_POINTS = 24;
const SEMEAI_CLASSIFIER_MAX_TARGET_LIBERTIES = 2;

type LocalLifeDeathClassifierStatus = 'alive' | 'dead';

interface LocalLifeDeathClassifierProof {
  readonly status: LocalLifeDeathClassifierStatus;
  readonly evidence: Readonly<Record<string, unknown>>;
}

interface SemeaiCandidatePair {
  readonly key: string;
  readonly left: EndgameStoneString;
  readonly right: EndgameStoneString;
  readonly sharedLiberties: readonly PointId[];
}

interface SemeaiDeadClaim {
  readonly targetGroupKey: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

const summarizeLocalLifeDeathOrder = (order: LocalLifeDeathOrderResult) =>
  Object.freeze({
    outcome: order.outcome,
    exploredNodes: order.search?.exploredNodes ?? 0,
    transpositionHits: order.search?.transpositionHits ?? 0,
  });

const toLocalLifeDeathClassifierProof = (
  result: LocalLifeDeathResult,
): LocalLifeDeathClassifierProof | null => {
  if (result.outcome === 'unknown') return null;
  const status: LocalLifeDeathClassifierStatus =
    result.outcome === 'proved-dead' ? 'dead' : 'alive';
  const proof =
    result.outcome === 'proved-dead'
      ? 'proved-dead-both-first-player-orders'
      : 'proved-alive-both-first-player-orders';
  return Object.freeze({
    status,
    evidence: Object.freeze({
      algorithm: LOCAL_LIFE_DEATH_ALGORITHM,
      proof,
      crucialStones: result.crucialStones,
      attackerFirst: summarizeLocalLifeDeathOrder(result.attackerFirst),
      defenderFirst: summarizeLocalLifeDeathOrder(result.defenderFirst),
      proofReason: result.proofReason,
    }),
  });
};

const canonicalPair = (left: string, right: string): readonly [string, string] =>
  left < right
    ? (Object.freeze([left, right]) as readonly [string, string])
    : (Object.freeze([right, left]) as readonly [string, string]);

const collectSemeaiCandidatePairs = (
  graph: EndgameGraph,
  excludedGroupKeys: ReadonlySet<string>,
): readonly SemeaiCandidatePair[] => {
  const groupsByPair = new Map<string, readonly [string, string]>();
  const sharedByPair = new Map<string, Set<PointId>>();

  const addPair = (
    suppliedGroups: readonly [string, string],
    sharedLiberties: readonly PointId[] = Object.freeze([]),
  ): void => {
    const groups = canonicalPair(suppliedGroups[0], suppliedGroups[1]);
    const key = JSON.stringify(groups);
    groupsByPair.set(key, groups);
    let shared = sharedByPair.get(key);
    if (!shared) {
      shared = new Set<PointId>();
      sharedByPair.set(key, shared);
    }
    for (const liberty of sharedLiberties) shared.add(liberty);
  };

  for (const adjacency of graph.opponentAdjacencies) addPair(adjacency.groups);
  for (const shared of graph.sharedLiberties) addPair(shared.groups, shared.liberties);

  const candidates: SemeaiCandidatePair[] = [];
  for (const key of [...groupsByPair.keys()].sort()) {
    const groups = groupsByPair.get(key)!;
    if (excludedGroupKeys.has(groups[0]) || excludedGroupKeys.has(groups[1])) continue;
    const left = graph.stringsByKey.get(groups[0]);
    const right = graph.stringsByKey.get(groups[1]);
    if (!left || !right || left.color === right.color) continue;
    if (
      left.liberties.length === 0 ||
      right.liberties.length === 0 ||
      left.liberties.length > SEMEAI_CLASSIFIER_MAX_TARGET_LIBERTIES ||
      right.liberties.length > SEMEAI_CLASSIFIER_MAX_TARGET_LIBERTIES
    ) {
      continue;
    }
    candidates.push(
      Object.freeze({
        key,
        left,
        right,
        sharedLiberties: Object.freeze(
          [...(sharedByPair.get(key) ?? new Set<PointId>())].sort(),
        ),
      }),
    );
  }
  return Object.freeze(candidates);
};

const summarizeSimpleOrder = (order: SimpleSemeaiResult['leftFirst']) =>
  order
    ? Object.freeze({
        firstPlayer: order.firstPlayer,
        outcome: order.outcome,
        winner: order.winner,
        leftCapturePly: order.leftCapturePly,
        rightCapturePly: order.rightCapturePly,
      })
    : null;

const simpleSemeaiDeadClaim = (result: SimpleSemeaiResult): SemeaiDeadClaim | null => {
  if (result.outcome !== 'left-wins' && result.outcome !== 'right-wins') return null;
  if (
    !result.leftFirst ||
    !result.rightFirst ||
    result.leftFirst.outcome !== result.outcome ||
    result.rightFirst.outcome !== result.outcome
  ) {
    return null;
  }
  const targetGroupKey =
    result.outcome === 'left-wins' ? result.rightGroupKey : result.leftGroupKey;
  const opponentGroupKey =
    result.outcome === 'left-wins' ? result.leftGroupKey : result.rightGroupKey;
  return Object.freeze({
    targetGroupKey,
    evidence: Object.freeze({
      algorithm: SIMPLE_SEMEAI_ALGORITHM,
      proof: 'stable-winner-both-first-player-orders',
      targetGroupKey,
      opponentGroupKey,
      leftGroupKey: result.leftGroupKey,
      rightGroupKey: result.rightGroupKey,
      leftColor: result.leftColor,
      rightColor: result.rightColor,
      liberties: result.liberties,
      leftFirst: summarizeSimpleOrder(result.leftFirst),
      rightFirst: summarizeSimpleOrder(result.rightFirst),
      exploredNodes: 0,
      transpositionHits: 0,
    }),
  });
};

const summarizeBoundedOrder = (order: BoundedSemeaiOrderResult) =>
  Object.freeze({
    firstPlayer: order.firstPlayer,
    outcome: order.outcome,
    exploredNodes: order.search?.exploredNodes ?? 0,
    transpositionHits: order.search?.transpositionHits ?? 0,
  });

const boundedSemeaiDeadClaim = (
  result: BoundedSemeaiResult,
  sharedLiberties: readonly PointId[],
): SemeaiDeadClaim | null => {
  if (result.outcome !== 'left-wins' && result.outcome !== 'right-wins') return null;
  if (
    result.leftFirst.outcome !== result.outcome ||
    result.rightFirst.outcome !== result.outcome
  ) {
    return null;
  }
  const targetGroupKey =
    result.outcome === 'left-wins' ? result.rightGroupKey : result.leftGroupKey;
  const opponentGroupKey =
    result.outcome === 'left-wins' ? result.leftGroupKey : result.rightGroupKey;
  const leftFirst = summarizeBoundedOrder(result.leftFirst);
  const rightFirst = summarizeBoundedOrder(result.rightFirst);
  return Object.freeze({
    targetGroupKey,
    evidence: Object.freeze({
      algorithm: BOUNDED_SEMEAI_ALGORITHM,
      proof: 'stable-winner-both-first-player-orders',
      targetGroupKey,
      opponentGroupKey,
      leftGroupKey: result.leftGroupKey,
      rightGroupKey: result.rightGroupKey,
      leftColor: result.leftColor,
      rightColor: result.rightColor,
      sharedLiberties,
      zonePoints: result.zonePoints,
      leftFirst,
      rightFirst,
      exploredNodes: leftFirst.exploredNodes + rightFirst.exploredNodes,
      transpositionHits: leftFirst.transpositionHits + rightFirst.transpositionHits,
      proofReason: result.proofReason,
    }),
  });
};

const shouldRunBoundedSemeai = (
  result: SimpleSemeaiResult,
  pair: SemeaiCandidatePair,
): boolean =>
  result.outcome === 'unresolved' &&
  result.reason === 'shared-liberties-deferred' &&
  pair.sharedLiberties.length > 0;

const isBasicSekiCostCandidate = (pair: SemeaiCandidatePair): boolean => {
  if (pair.sharedLiberties.length !== 2) return false;
  if (pair.left.liberties.length !== 2 || pair.right.liberties.length !== 2) return false;
  const shared = new Set(pair.sharedLiberties);
  return (
    pair.left.liberties.every((liberty) => shared.has(liberty)) &&
    pair.right.liberties.every((liberty) => shared.has(liberty))
  );
};

const summarizeBasicSekiInitiation = (initiation: BasicSekiInitiationResult) =>
  Object.freeze({
    initiator: initiation.initiator,
    outcome: initiation.outcome,
    moves: Object.freeze(
      initiation.moves.map((move) =>
        Object.freeze({
          point: move.point,
          outcome: move.outcome,
          continuation:
            move.continuation === null
              ? null
              : Object.freeze({
                  outcome: move.continuation.outcome,
                  leftFirst: summarizeBoundedOrder(move.continuation.leftFirst),
                  rightFirst: summarizeBoundedOrder(move.continuation.rightFirst),
                }),
        }),
      ),
    ),
  });

/**
 * Conservative assisted classifier. Cheap/static proofs remain first. Reader
 * integration is candidate-gated and accepts only existing authoritative proof
 * contracts. Semeai proves only a stable loser dead, never its winner alive.
 * Ko, budget, boundary, cycle and incomplete outcomes remain unresolved.
 */
export class AssistedEndgameClassifier implements EndgameClassifier {
  private readonly manual = new ManualEndgameClassifier();

  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    const baseline = await this.manual.analyze(context);
    const graph = buildEndgameGraph(context.state.board, context.topology);
    const complete =
      baseline.length === graph.strings.length &&
      baseline.every((proposal) => graph.stringsByKey.has(endgameGroupId(proposal.points)));
    if (!complete) return baseline;

    const aliveProofs = new Map<string, readonly BensonColorRegion[]>();
    for (const color of COLORS) {
      for (const [groupKey, vitalRegions] of proveBensonPassAlive(
        context.state.board,
        context.topology,
        graph,
        color,
      )) {
        aliveProofs.set(groupKey, vitalRegions);
      }
    }

    const passAliveGroupKeys = new Set(aliveProofs.keys());
    const safeConnectionProofs = new Map<string, SafeConnectionProof>();
    for (const group of graph.strings) {
      if (passAliveGroupKeys.has(group.key)) continue;
      const hasBensonConnectionCandidate = graph.possibleConnections.some((candidate) => {
        if (!candidate.groups.includes(group.key)) return false;
        const otherKey = candidate.groups.find((groupKey) => groupKey !== group.key);
        return otherKey !== undefined && passAliveGroupKeys.has(otherKey);
      });
      if (!hasBensonConnectionCandidate) continue;
      const connection = proveSafeConnectionToBenson(
        group,
        context.state.board,
        context.topology,
      );
      if (connection.outcome === 'proven') safeConnectionProofs.set(group.key, connection.evidence);
    }

    const deadProofs = new Map<string, AutomaticDeadProof>();
    for (const candidate of generateDeadCandidates(graph.stringsByKey, passAliveGroupKeys)) {
      if (safeConnectionProofs.has(candidate.groupKey)) continue;
      const verification = verifyDeadCandidate(candidate, {
        state: context.state,
        topology: context.topology,
        groups: graph.stringsByKey,
        pointOwner: graph.stringByPoint,
        passAliveGroupKeys,
      });
      if (verification.proven) deadProofs.set(candidate.groupKey, verification.evidence);
    }

    const safeGroupPoints = Object.freeze(
      [...passAliveGroupKeys]
        .sort()
        .flatMap((groupKey) => graph.stringsByKey.get(groupKey)?.points ?? []),
    );
    const tacticalDeadProofs = new Map<string, TacticalDeadProof>();
    for (const group of graph.strings) {
      const tacticalShape =
        group.points.length === 1 &&
        group.liberties.length >= 1 &&
        group.liberties.length <= 2;
      if (
        passAliveGroupKeys.has(group.key) ||
        safeConnectionProofs.has(group.key) ||
        deadProofs.has(group.key) ||
        !tacticalShape
      ) {
        continue;
      }
      const opponent: StoneColor = group.color === 'black' ? 'white' : 'black';
      const tacticalFrontier = [...group.points, ...group.liberties];
      const contested = tacticalFrontier.some((point) =>
        context.topology
          .neighbors(point)
          .some((neighbor) => context.state.board[neighbor] === opponent),
      );
      if (!contested) continue;
      const sharedOptions = Object.freeze({
        safeGroupPoints,
        maxNodes: TACTICAL_CLASSIFIER_MAX_NODES,
      });
      const attackerFirst = readTacticalCapture(group, context.state, context.topology, {
        ...sharedOptions,
        firstPlayer: 'attacker',
      });
      if (attackerFirst.outcome !== 'proved-kill') continue;
      const defenderFirst = readTacticalCapture(group, context.state, context.topology, {
        ...sharedOptions,
        firstPlayer: 'defender',
      });
      if (defenderFirst.outcome !== 'proved-kill') continue;
      tacticalDeadProofs.set(
        group.key,
        Object.freeze({
          algorithm: TACTICAL_READER_ALGORITHM,
          proof: 'forced-capture-both-first-player-orders' as const,
          crucialStones: group.points,
          attackerFirst,
          defenderFirst,
        }),
      );
    }

    const localLifeDeathProofs = new Map<string, LocalLifeDeathClassifierProof>();
    for (const group of graph.strings) {
      if (
        passAliveGroupKeys.has(group.key) ||
        safeConnectionProofs.has(group.key) ||
        deadProofs.has(group.key) ||
        tacticalDeadProofs.has(group.key)
      ) {
        continue;
      }
      if (group.liberties.length < 3 || group.liberties.length > 4) continue;
      const opponent: StoneColor = group.color === 'black' ? 'white' : 'black';
      const enclosedBySafeOpponent = group.liberties.every((liberty) =>
        context.topology.neighbors(liberty).some((neighbor) => {
          if (context.state.board[neighbor] !== opponent) return false;
          const owner = graph.stringByPoint.get(neighbor);
          return owner !== undefined && passAliveGroupKeys.has(owner);
        }),
      );
      if (!enclosedBySafeOpponent) continue;
      const localResult = readLocalLifeDeath(group, context.state, context.topology, {
        maxNodes: LOCAL_LIFE_DEATH_CLASSIFIER_MAX_NODES,
        maxZonePoints: LOCAL_LIFE_DEATH_CLASSIFIER_MAX_ZONE_POINTS,
      });
      const classifierProof = toLocalLifeDeathClassifierProof(localResult);
      if (classifierProof) localLifeDeathProofs.set(group.key, classifierProof);
    }

    const resolvedBeforeSemeai = new Set<string>([
      ...passAliveGroupKeys,
      ...safeConnectionProofs.keys(),
      ...deadProofs.keys(),
      ...localLifeDeathProofs.keys(),
    ]);
    const semeaiPairs = collectSemeaiCandidatePairs(graph, resolvedBeforeSemeai);
    const semeaiDeadProofs = new Map<string, Readonly<Record<string, unknown>>>();
    for (const pair of semeaiPairs) {
      const simple = analyzeSimpleSemeai(pair.left, pair.right, context.state, context.topology);
      let claim = simpleSemeaiDeadClaim(simple);
      if (!claim && shouldRunBoundedSemeai(simple, pair)) {
        const bounded = analyzeBoundedSemeai(
          pair.left,
          pair.right,
          context.state,
          context.topology,
          {
            maxNodes: SEMEAI_CLASSIFIER_MAX_NODES,
            maxZonePoints: SEMEAI_CLASSIFIER_MAX_ZONE_POINTS,
          },
        );
        claim = boundedSemeaiDeadClaim(bounded, pair.sharedLiberties);
      }
      if (claim && !semeaiDeadProofs.has(claim.targetGroupKey)) {
        semeaiDeadProofs.set(claim.targetGroupKey, claim.evidence);
      }
    }

    const resolvedBeforeLegacySeki = new Set<string>([
      ...resolvedBeforeSemeai,
      ...tacticalDeadProofs.keys(),
      ...semeaiDeadProofs.keys(),
    ]);
    const sekiProofs = new Map<string, AutomaticSekiProof>();
    for (const candidate of generateSekiCandidates(
      graph.stringsByKey,
      resolvedBeforeLegacySeki,
    )) {
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

    const resolvedBeforeBasicSeki = new Set<string>([
      ...resolvedBeforeLegacySeki,
      ...sekiProofs.keys(),
    ]);
    const basicSekiProofs = new Map<string, Readonly<Record<string, unknown>>>();
    for (const pair of collectSemeaiCandidatePairs(graph, resolvedBeforeBasicSeki)) {
      if (!isBasicSekiCostCandidate(pair)) continue;
      const result = analyzeBasicSeki(
        pair.left,
        pair.right,
        context.state,
        context.topology,
        {
          maxNodes: SEMEAI_CLASSIFIER_MAX_NODES,
          maxZonePoints: SEMEAI_CLASSIFIER_MAX_ZONE_POINTS,
        },
      );
      if (
        result.outcome !== 'seki' ||
        result.proof !== 'every-legal-local-initiation-is-losing'
      ) {
        continue;
      }
      const evidence = Object.freeze({
        algorithm: BASIC_SEKI_ALGORITHM,
        proof: result.proof,
        leftGroupKey: result.leftGroupKey,
        rightGroupKey: result.rightGroupKey,
        leftColor: result.leftColor,
        rightColor: result.rightColor,
        sharedLiberties: result.sharedLiberties,
        zonePoints: result.zonePoints,
        leftInitiation: summarizeBasicSekiInitiation(result.leftInitiation),
        rightInitiation: summarizeBasicSekiInitiation(result.rightInitiation),
        proofReason: result.proofReason,
      });
      if (!basicSekiProofs.has(result.leftGroupKey)) {
        basicSekiProofs.set(result.leftGroupKey, evidence);
      }
      if (!basicSekiProofs.has(result.rightGroupKey)) {
        basicSekiProofs.set(result.rightGroupKey, evidence);
      }
    }

    return Object.freeze(
      baseline.map((proposal) => {
        const groupKey = endgameGroupId(proposal.points);
        const vitalRegions = aliveProofs.get(groupKey);
        if (vitalRegions) {
          return Object.freeze({
            points: proposal.points,
            status: 'alive' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({
              algorithm: BENSON_PASS_ALIVE_ALGORITHM,
              proof: 'two-vital-regions',
              vitalRegions: Object.freeze(vitalRegions.map((region) => region.points)),
            }),
          });
        }
        const safeConnectionProof = safeConnectionProofs.get(groupKey);
        if (safeConnectionProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'alive' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...safeConnectionProof }),
          });
        }
        const deadProof = deadProofs.get(groupKey);
        if (deadProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'dead' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...deadProof }),
          });
        }
        const localLifeDeathProof = localLifeDeathProofs.get(groupKey);
        if (localLifeDeathProof) {
          return Object.freeze({
            points: proposal.points,
            status: localLifeDeathProof.status,
            source: 'automatic' as const,
            evidence: localLifeDeathProof.evidence,
          });
        }
        const semeaiDeadProof = semeaiDeadProofs.get(groupKey);
        if (semeaiDeadProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'dead' as const,
            source: 'automatic' as const,
            evidence: semeaiDeadProof,
          });
        }
        const tacticalDeadProof = tacticalDeadProofs.get(groupKey);
        if (tacticalDeadProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'dead' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...tacticalDeadProof }),
          });
        }
        const sekiProof = sekiProofs.get(groupKey);
        if (sekiProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'seki' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...sekiProof }),
          });
        }
        const basicSekiProof = basicSekiProofs.get(groupKey);
        if (basicSekiProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'seki' as const,
            source: 'automatic' as const,
            evidence: basicSekiProof,
          });
        }
        return proposal;
      }),
    );
  }
}
