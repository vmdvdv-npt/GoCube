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
import { buildEndgameGraph } from './EndgameGraphCore';
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
  TACTICAL_READER_ALGORITHM,
  readTacticalCapture,
  type TacticalDeadProof,
} from './TacticalReader';
import type { StoneColor } from '../game/types';

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);
const TACTICAL_CLASSIFIER_MAX_NODES = 16;
const LOCAL_LIFE_DEATH_CLASSIFIER_MAX_NODES = 256;
const LOCAL_LIFE_DEATH_CLASSIFIER_MAX_ZONE_POINTS = 24;

type LocalLifeDeathClassifierStatus = 'alive' | 'dead';

interface LocalLifeDeathClassifierProof {
  readonly status: LocalLifeDeathClassifierStatus;
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

/**
 * Conservative assisted classifier.
 *
 * It proves unconditional/pass-alive groups using Benson's fixed-point
 * criterion, adds the narrow Work 5B two-liberty miai connection to a Benson
 * safe group, preserves the sealed single-liberty proof, keeps the Work 4
 * ultra-short two-liberty tactical forced-capture proof, and then runs the
 * Work 6 bounded local life/death proof only for a small enclosed candidate
 * class that is still unresolved. Seki remains a separate final proof layer.
 * Any result that is budget-, boundary-, cycle-, incomplete-, or ko-dependent
 * stays unresolved.
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

      // RelevanceZone is intentionally more expensive than the shared graph
      // snapshot, so only invoke the Work 5B verifier for structural candidates
      // that already touch a same-color Benson group through shared liberties.
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
      // Keep the existing one-liberty evidence contract authoritative. Work 4
      // only promotes a new class of very short two-liberty proofs; broader
      // tactical localization remains conservative even after Work 5B.
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

      // Work 6C deliberately keeps the first production search class narrow.
      // One-liberty groups already have a sealed proof and two-liberty groups
      // already belong to the Work 4 tactical layer. The local L&D reader is
      // therefore used here only for small 3–4 liberty targets whose every
      // liberty is immediately bounded by a Benson/pass-alive opponent string.
      // This is only a candidate/performance gate: the reader must still prove
      // both first-player orders before any automatic status is emitted.
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

    const alreadyResolvedGroupKeys = new Set<string>([
      ...passAliveGroupKeys,
      ...safeConnectionProofs.keys(),
      ...deadProofs.keys(),
      ...tacticalDeadProofs.keys(),
      ...localLifeDeathProofs.keys(),
    ]);
    const sekiProofs = new Map<string, AutomaticSekiProof>();
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
        sekiProofs.set(groupKey, verification.evidence);
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

        const sekiProof = sekiProofs.get(groupKey);
        if (sekiProof) {
          return Object.freeze({
            points: proposal.points,
            status: 'seki' as const,
            source: 'automatic' as const,
            evidence: Object.freeze({ ...sekiProof }),
          });
        }

        return proposal;
      }),
    );
  }
}
