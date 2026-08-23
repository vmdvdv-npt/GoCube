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
import { ManualEndgameClassifier } from './ManualEndgameClassifier';
import {
  TACTICAL_READER_ALGORITHM,
  readTacticalCapture,
  type TacticalDeadProof,
} from './TacticalReader';
import type { StoneColor } from '../game/types';

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);
const TACTICAL_CLASSIFIER_MAX_NODES = 8;

/**
 * Conservative assisted classifier.
 *
 * It proves unconditional/pass-alive groups using Benson's fixed-point
 * criterion, preserves the narrow sealed single-liberty proof, adds only
 * ultra-short two-liberty tactical forced-capture proofs at this Work 4
 * integration boundary, and resolves seki only for the existing closed mutual
 * two-liberty proof. Any group not proven by one of those boundaries remains
 * unresolved.
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
    const deadProofs = new Map<string, AutomaticDeadProof>();
    for (const candidate of generateDeadCandidates(graph.stringsByKey, passAliveGroupKeys)) {
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
      // tactical localization is deliberately deferred to Work 5.
      if (
        passAliveGroupKeys.has(group.key) ||
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

    const alreadyResolvedGroupKeys = new Set<string>([
      ...passAliveGroupKeys,
      ...deadProofs.keys(),
      ...tacticalDeadProofs.keys(),
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
