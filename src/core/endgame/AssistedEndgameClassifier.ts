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
  type EndgameConflictComponent,
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
  type BasicSekiResult,
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

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);
const TACTICAL_CLASSIFIER_MAX_NODES = 16;
const LOCAL_LIFE_DEATH_CLASSIFIER_MAX_NODES = 256;
const LOCAL_LIFE_DEATH_CLASSIFIER_MAX_ZONE_POINTS = 24;
const SEMEAI_SEKI_CLASSIFIER_MAX_NODES = 256;
const SEMEAI_SEKI_CLASSIFIER_MAX_ZONE_POINTS = 24;
const SIMPLE_SEMEAI_CLASSIFIER_MAX_EXCLUSIVE_LIBERTIES = 3;
const SEMEAI_SEKI_CLASSIFIER_MAX_TARGET_LIBERTIES = 4;
const SEMEAI_SEKI_CLASSIFIER_MAX_DISTINCT_LIBERTIES = 4;
const SEMEAI_SEKI_CLASSIFIER_MAX_SHARED_LIBERTIES = 2;
const SEMEAI_SEKI_CLASSIFIER_MAX_TARGET_STONES = 8;
const SEMEAI_SEKI_CLASSIFIER_MAX_COMPONENT_STRINGS = 4;
const SEMEAI_SEKI_CLASSIFIER_MAX_COMPONENT_REGIONS = 4;
const SEMEAI_SEKI_CLASSIFIER_MAX_PAIRS = 8;

type LocalLifeDeathClassifierStatus = 'alive' | 'dead';

interface LocalLifeDeathClassifierProof {
  readonly status: LocalLifeDeathClassifierStatus;
  readonly evidence: Readonly<Record<string, unknown>>;
}

interface InteractingPair {
  readonly left: EndgameStoneString;
  readonly right: EndgameStoneString;
}

interface SharedInteractingPair extends InteractingPair {
  readonly sharedLiberties: readonly string[];
}

interface StableSemeaiDeadProof {
  readonly algorithm: typeof SIMPLE_SEMEAI_ALGORITHM | typeof BOUNDED_SEMEAI_ALGORITHM;
  readonly proof:
    | 'stable-simple-loser-both-first-player-orders'
    | 'stable-loser-both-first-player-orders';
  readonly winnerGroupKey: string;
  readonly loserGroupKey: string;
  readonly winnerCrucialStones: readonly string[];
  readonly loserCrucialStones: readonly string[];
  readonly leftFirst: Readonly<Record<string, unknown>>;
  readonly rightFirst: Readonly<Record<string, unknown>>;
  readonly proofReason: string;
  readonly zonePoints?: readonly string[];
  readonly liberties?: Readonly<Record<string, unknown>>;
}

interface BasicSekiClassifierProof {
  readonly algorithm: typeof BASIC_SEKI_ALGORITHM;
  readonly proof: 'every-legal-local-initiation-is-losing';
  readonly leftGroupKey: string;
  readonly rightGroupKey: string;
  readonly sharedLiberties: readonly string[];
  readonly zonePoints: readonly string[];
  readonly leftInitiation: Readonly<Record<string, unknown>>;
  readonly rightInitiation: Readonly<Record<string, unknown>>;
  readonly proofReason: string;
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

const summarizeSemeaiOrder = (order: BoundedSemeaiOrderResult) =>
  Object.freeze({
    outcome: order.outcome,
    exploredNodes: order.search?.exploredNodes ?? 0,
    transpositionHits: order.search?.transpositionHits ?? 0,
  });

const toBoundedSemeaiDeadProof = (
  result: BoundedSemeaiResult,
): Readonly<{ readonly loserGroupKey: string; readonly evidence: StableSemeaiDeadProof }> | null => {
  if (result.outcome !== 'left-wins' && result.outcome !== 'right-wins') return null;

  const leftWins = result.outcome === 'left-wins';
  const winnerGroupKey = leftWins ? result.leftGroupKey : result.rightGroupKey;
  const loserGroupKey = leftWins ? result.rightGroupKey : result.leftGroupKey;
  const winnerCrucialStones = leftWins
    ? result.leftCrucialStones
    : result.rightCrucialStones;
  const loserCrucialStones = leftWins
    ? result.rightCrucialStones
    : result.leftCrucialStones;

  return Object.freeze({
    loserGroupKey,
    evidence: Object.freeze({
      algorithm: BOUNDED_SEMEAI_ALGORITHM,
      proof: 'stable-loser-both-first-player-orders' as const,
      winnerGroupKey,
      loserGroupKey,
      winnerCrucialStones,
      loserCrucialStones,
      zonePoints: result.zonePoints,
      leftFirst: summarizeSemeaiOrder(result.leftFirst),
      rightFirst: summarizeSemeaiOrder(result.rightFirst),
      proofReason: result.proofReason,
    }),
  });
};

const toSimpleSemeaiDeadProof = (
  result: SimpleSemeaiResult,
  left: EndgameStoneString,
  right: EndgameStoneString,
): Readonly<{ readonly loserGroupKey: string; readonly evidence: StableSemeaiDeadProof }> | null => {
  if (result.outcome !== 'left-wins' && result.outcome !== 'right-wins') return null;
  if (!result.leftFirst || !result.rightFirst) return null;

  const leftWins = result.outcome === 'left-wins';
  const winner = leftWins ? left : right;
  const loser = leftWins ? right : left;

  return Object.freeze({
    loserGroupKey: loser.key,
    evidence: Object.freeze({
      algorithm: SIMPLE_SEMEAI_ALGORITHM,
      proof: 'stable-simple-loser-both-first-player-orders' as const,
      winnerGroupKey: winner.key,
      loserGroupKey: loser.key,
      winnerCrucialStones: winner.points,
      loserCrucialStones: loser.points,
      liberties: Object.freeze({
        leftExclusive: result.liberties.leftExclusive,
        rightExclusive: result.liberties.rightExclusive,
        shared: result.liberties.shared,
      }),
      leftFirst: Object.freeze({ ...result.leftFirst }),
      rightFirst: Object.freeze({ ...result.rightFirst }),
      proofReason: 'both first-player orders prove the same simple capture-race loser',
    }),
  });
};

const summarizeSekiInitiation = (initiation: BasicSekiInitiationResult) =>
  Object.freeze({
    outcome: initiation.outcome,
    moves: Object.freeze(
      initiation.moves.map((move) =>
        Object.freeze({
          point: move.point,
          outcome: move.outcome,
        }),
      ),
    ),
  });

const toBasicSekiClassifierProof = (
  result: BasicSekiResult,
): BasicSekiClassifierProof | null => {
  if (result.outcome !== 'seki') return null;

  return Object.freeze({
    algorithm: BASIC_SEKI_ALGORITHM,
    proof: 'every-legal-local-initiation-is-losing' as const,
    leftGroupKey: result.leftGroupKey,
    rightGroupKey: result.rightGroupKey,
    sharedLiberties: result.sharedLiberties,
    zonePoints: result.zonePoints,
    leftInitiation: summarizeSekiInitiation(result.leftInitiation),
    rightInitiation: summarizeSekiInitiation(result.rightInitiation),
    proofReason: result.proofReason,
  });
};

const componentForPair = (
  graph: EndgameGraph,
  leftKey: string,
  rightKey: string,
): EndgameConflictComponent | null =>
  graph.conflictComponents.find((component) => {
    const strings = new Set([...component.blackStrings, ...component.whiteStrings]);
    return strings.has(leftKey) && strings.has(rightKey);
  }) ?? null;

const componentFitsProductionGate = (component: EndgameConflictComponent | null): boolean =>
  component !== null &&
  component.blackStrings.length + component.whiteStrings.length <=
    SEMEAI_SEKI_CLASSIFIER_MAX_COMPONENT_STRINGS &&
  component.emptyRegions.length <= SEMEAI_SEKI_CLASSIFIER_MAX_COMPONENT_REGIONS;

const pairFitsCommonGate = (
  left: EndgameStoneString,
  right: EndgameStoneString,
): boolean =>
  left.color !== right.color &&
  left.points.length + right.points.length <= SEMEAI_SEKI_CLASSIFIER_MAX_TARGET_STONES &&
  left.liberties.length <= SEMEAI_SEKI_CLASSIFIER_MAX_TARGET_LIBERTIES &&
  right.liberties.length <= SEMEAI_SEKI_CLASSIFIER_MAX_TARGET_LIBERTIES;

const collectSimpleSemeaiPairs = (
  graph: EndgameGraph,
  excludedGroupKeys: ReadonlySet<string>,
): readonly InteractingPair[] => {
  const sharedPairKeys = new Set(
    graph.sharedLiberties.map((entry) => JSON.stringify(entry.groups)),
  );
  const pairs: InteractingPair[] = [];

  for (const adjacency of graph.opponentAdjacencies) {
    const [leftKey, rightKey] = adjacency.groups;
    if (
      excludedGroupKeys.has(leftKey) ||
      excludedGroupKeys.has(rightKey) ||
      sharedPairKeys.has(JSON.stringify(adjacency.groups))
    ) {
      continue;
    }

    const left = graph.stringsByKey.get(leftKey);
    const right = graph.stringsByKey.get(rightKey);
    if (!left || !right || !pairFitsCommonGate(left, right)) continue;
    if (
      left.liberties.length > SIMPLE_SEMEAI_CLASSIFIER_MAX_EXCLUSIVE_LIBERTIES ||
      right.liberties.length > SIMPLE_SEMEAI_CLASSIFIER_MAX_EXCLUSIVE_LIBERTIES
    ) {
      continue;
    }
    if (!componentFitsProductionGate(componentForPair(graph, left.key, right.key))) continue;

    pairs.push(Object.freeze({ left, right }));
    if (pairs.length >= SEMEAI_SEKI_CLASSIFIER_MAX_PAIRS) break;
  }

  return Object.freeze(pairs);
};

const collectSharedSemeaiPairs = (
  graph: EndgameGraph,
  excludedGroupKeys: ReadonlySet<string>,
): readonly SharedInteractingPair[] => {
  const pairs: SharedInteractingPair[] = [];

  for (const shared of graph.sharedLiberties) {
    const [leftKey, rightKey] = shared.groups;
    if (excludedGroupKeys.has(leftKey) || excludedGroupKeys.has(rightKey)) continue;

    const left = graph.stringsByKey.get(leftKey);
    const right = graph.stringsByKey.get(rightKey);
    if (!left || !right || !pairFitsCommonGate(left, right)) continue;
    if (
      shared.liberties.length > SEMEAI_SEKI_CLASSIFIER_MAX_SHARED_LIBERTIES ||
      new Set([...left.liberties, ...right.liberties]).size >
        SEMEAI_SEKI_CLASSIFIER_MAX_DISTINCT_LIBERTIES
    ) {
      continue;
    }
    if (!componentFitsProductionGate(componentForPair(graph, left.key, right.key))) continue;

    pairs.push(
      Object.freeze({
        left,
        right,
        sharedLiberties: shared.liberties,
      }),
    );
    if (pairs.length >= SEMEAI_SEKI_CLASSIFIER_MAX_PAIRS) break;
  }

  return Object.freeze(pairs);
};

/**
 * Conservative assisted classifier.
 *
 * It promotes only proof-bearing statuses. Benson/pass-alive, safe connection,
 * sealed one-liberty death, the short tactical reader and bounded local L&D run
 * first. Work 7D then applies a strict production candidate gate before semeai
 * and seki: small targets, small conflict components, bounded pair count and,
 * for the AND/OR path, only compact shared-liberty races. Simple Work 7A races
 * are integrated through their cheaper proof path. A basic-seki proof promotes
 * both targets to seki; a stable semeai winner promotes only the losing target
 * to dead. A race winner is never promoted to alive. First-player dependence,
 * ko, boundary escape, budget exhaustion, cycles and incomplete paths stay
 * unresolved. The older closed-two-liberty seki certificate remains a strict
 * fallback for unresolved groups.
 */
export class AssistedEndgameClassifier implements EndgameClassifier {
  private readonly manual = new ManualEndgameClassifier();

  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    const baseline = await this.manual.analyze(context);
    const graph = buildEndgameGraph(context.state.board, context.topology);

    // Automatic proof is only sound when the requested analysis context
    // describes every logical stone string on the board. A partial context
    // remains safely unresolved, exactly as before the shared graph core.
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
      if (connection.outcome === 'proven') {
        safeConnectionProofs.set(group.key, connection.evidence);
      }
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
      if (
        passAliveGroupKeys.has(group.key) ||
        safeConnectionProofs.has(group.key) ||
        deadProofs.has(group.key) ||
        group.liberties.length !== 2
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

    const resolvedBeforeRaces = new Set<string>([
      ...passAliveGroupKeys,
      ...safeConnectionProofs.keys(),
      ...deadProofs.keys(),
      ...tacticalDeadProofs.keys(),
      ...localLifeDeathProofs.keys(),
    ]);
    const simplePairs = collectSimpleSemeaiPairs(graph, resolvedBeforeRaces);
    const sharedPairs = collectSharedSemeaiPairs(graph, resolvedBeforeRaces);

    const basicSekiProofs = new Map<string, BasicSekiClassifierProof>();
    for (const pair of sharedPairs) {
      if (pair.sharedLiberties.length < 2) continue;
      if (basicSekiProofs.has(pair.left.key) || basicSekiProofs.has(pair.right.key)) continue;
      const result = analyzeBasicSeki(
        pair.left,
        pair.right,
        context.state,
        context.topology,
        {
          maxNodes: SEMEAI_SEKI_CLASSIFIER_MAX_NODES,
          maxZonePoints: SEMEAI_SEKI_CLASSIFIER_MAX_ZONE_POINTS,
        },
      );
      const proof = toBasicSekiClassifierProof(result);
      if (!proof) continue;
      basicSekiProofs.set(pair.left.key, proof);
      basicSekiProofs.set(pair.right.key, proof);
    }

    const semeaiDeadProofs = new Map<string, StableSemeaiDeadProof>();
    for (const pair of simplePairs) {
      const result = analyzeSimpleSemeai(
        pair.left,
        pair.right,
        context.state,
        context.topology,
        { maxExclusiveLiberties: SIMPLE_SEMEAI_CLASSIFIER_MAX_EXCLUSIVE_LIBERTIES },
      );
      const proof = toSimpleSemeaiDeadProof(result, pair.left, pair.right);
      if (!proof || semeaiDeadProofs.has(proof.loserGroupKey)) continue;
      semeaiDeadProofs.set(proof.loserGroupKey, proof.evidence);
    }

    for (const pair of sharedPairs) {
      if (basicSekiProofs.has(pair.left.key) || basicSekiProofs.has(pair.right.key)) continue;
      const result = analyzeBoundedSemeai(
        pair.left,
        pair.right,
        context.state,
        context.topology,
        {
          maxNodes: SEMEAI_SEKI_CLASSIFIER_MAX_NODES,
          maxZonePoints: SEMEAI_SEKI_CLASSIFIER_MAX_ZONE_POINTS,
        },
      );
      const proof = toBoundedSemeaiDeadProof(result);
      if (!proof || semeaiDeadProofs.has(proof.loserGroupKey)) continue;
      semeaiDeadProofs.set(proof.loserGroupKey, proof.evidence);
    }

    const alreadyResolvedGroupKeys = new Set<string>([
      ...resolvedBeforeRaces,
      ...basicSekiProofs.keys(),
      ...semeaiDeadProofs.keys(),
    ]);
    const legacySekiProofs = new Map<string, AutomaticSekiProof>();
    for (const candidate of generateSekiCandidates(
      graph.stringsByKey,
      alreadyResolvedGroupKeys,
    )) {
      const verification = verifySekiCandidate(candidate, {
        state: context.state,
        topology: context.topology,
        groups: graph.stringsByKey,
        pointOwner: graph.stringByPoint,
      });
      if (!verification.proven) continue;
      for (const groupKey of candidate.groupKeys) {
        legacySekiProofs.set(groupKey, verification.evidence);
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

        const tacticalDeadProof = tacticalDeadProofs.get(groupKey);
        if (tacticalDeadProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'dead' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...tacticalDeadProof }),
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

        const basicSekiProof = basicSekiProofs.get(groupKey);
        if (basicSekiProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'seki' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...basicSekiProof }),
          });
        }

        const semeaiDeadProof = semeaiDeadProofs.get(groupKey);
        if (semeaiDeadProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'dead' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...semeaiDeadProof }),
          });
        }

        const legacySekiProof = legacySekiProofs.get(groupKey);
        if (legacySekiProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'seki' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...legacySekiProof }),
          });
        }

        return proposal;
      }),
    );
  }
}
