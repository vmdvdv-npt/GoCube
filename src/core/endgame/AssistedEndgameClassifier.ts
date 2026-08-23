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
  buildEndgameGraph,
  type EndgameEmptyRegion,
  type EndgameStoneString,
} from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import { ManualEndgameClassifier } from './ManualEndgameClassifier';
import {
  readOneLibertyTactics,
  type OneLibertyTacticalResult,
} from './OneLibertyTacticalReader';
import type { StoneColor } from '../game/types';

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);
const ALIVE_ALGORITHM = 'benson-pass-alive-v1';

type DeadEvidence = AutomaticDeadProof | OneLibertyTacticalResult;

/**
 * Conservative assisted classifier.
 *
 * Structural facts come from the shared topology-neutral Endgame Graph Core.
 * Benson proves unconditional/pass-alive groups. The legacy narrow sealed
 * single-liberty proof remains a cheap fast path, then the graph-native
 * one-liberty reader checks all immediate defenses before promoting additional
 * groups to dead. Seki still requires its dedicated strict verifier.
 */
export class AssistedEndgameClassifier implements EndgameClassifier {
  private readonly manual = new ManualEndgameClassifier();

  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    const baseline = await this.manual.analyze(context);
    const graph = buildEndgameGraph(context.state, context.topology);

    // Automatic proof is only exposed when the analysis request describes the
    // complete logical position. Partial requests stay safely unresolved even
    // though the graph core itself can see the whole board.
    const requestedGroupKeys = new Set(
      baseline.map((proposal) => endgameGroupId(proposal.points)),
    );
    if (
      requestedGroupKeys.size !== graph.groups.size ||
      [...graph.groups.keys()].some((groupKey) => !requestedGroupKeys.has(groupKey))
    ) {
      return baseline;
    }

    const aliveProofs = new Map<string, readonly EndgameEmptyRegion[]>();
    for (const color of COLORS) {
      for (const [groupKey, vitalRegions] of provePassAlive(
        color,
        graph.groups,
        graph.emptyRegions,
      )) {
        aliveProofs.set(groupKey, vitalRegions);
      }
    }

    const passAliveGroupKeys = new Set(aliveProofs.keys());
    const deadProofs = new Map<string, DeadEvidence>();

    // Preserve the existing smallest proof as the cheapest path.
    for (const candidate of generateDeadCandidates(graph.groups, passAliveGroupKeys)) {
      const verification = verifyDeadCandidate(candidate, {
        state: context.state,
        topology: context.topology,
        groups: graph.groups,
        pointOwner: graph.pointOwner,
        passAliveGroupKeys,
      });
      if (verification.proven) deadProofs.set(candidate.groupKey, verification.evidence);
    }

    // Expand dead coverage only when the short reader proves both move orders:
    // attacker can capture immediately and every direct defender-first save is
    // either illegal or itself immediately capturable.
    for (const group of [...graph.groups.values()].sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    )) {
      if (
        passAliveGroupKeys.has(group.key) ||
        deadProofs.has(group.key) ||
        group.liberties.length !== 1
      ) {
        continue;
      }

      const tactical = readOneLibertyTactics(
        context.state,
        context.topology,
        graph,
        group.key,
      );
      if (tactical?.outcome === 'proven-dead') deadProofs.set(group.key, tactical);
    }

    const alreadyResolvedGroupKeys = new Set<string>([
      ...passAliveGroupKeys,
      ...deadProofs.keys(),
    ]);
    const sekiProofs = new Map<string, AutomaticSekiProof>();
    for (const candidate of generateSekiCandidates(graph.groups, alreadyResolvedGroupKeys)) {
      const verification = verifySekiCandidate(candidate, {
        state: context.state,
        topology: context.topology,
        groups: graph.groups,
        pointOwner: graph.pointOwner,
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
              algorithm: ALIVE_ALGORITHM,
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

const provePassAlive = (
  color: StoneColor,
  groups: ReadonlyMap<string, EndgameStoneString>,
  regions: readonly EndgameEmptyRegion[],
): ReadonlyMap<string, readonly EndgameEmptyRegion[]> => {
  const remainingGroups = new Set(
    [...groups.values()].filter((group) => group.color === color).map((group) => group.key),
  );
  const candidateRegions = new Map(
    regions
      .filter(
        (region) =>
          region.boundaryGroups.length > 0 &&
          region.boundaryGroups.every((groupKey) => groups.get(groupKey)?.color === color),
      )
      .map((region) => [region.key, region] as const),
  );
  const remainingRegions = new Set(candidateRegions.keys());

  while (true) {
    const groupsToRemove = [...remainingGroups].filter((groupKey) => {
      let vitalRegionCount = 0;
      for (const regionKey of remainingRegions) {
        if (candidateRegions.get(regionKey)!.vitalGroups.includes(groupKey)) vitalRegionCount += 1;
      }
      return vitalRegionCount < 2;
    });

    for (const groupKey of groupsToRemove) remainingGroups.delete(groupKey);

    const regionsToRemove = [...remainingRegions].filter((regionKey) =>
      candidateRegions
        .get(regionKey)!
        .boundaryGroups.some((groupKey) => !remainingGroups.has(groupKey)),
    );
    for (const regionKey of regionsToRemove) remainingRegions.delete(regionKey);

    if (groupsToRemove.length === 0 && regionsToRemove.length === 0) break;
  }

  const proofs = new Map<string, readonly EndgameEmptyRegion[]>();
  for (const groupKey of [...remainingGroups].sort()) {
    const vitalRegions = [...remainingRegions]
      .map((regionKey) => candidateRegions.get(regionKey)!)
      .filter((region) => region.vitalGroups.includes(groupKey))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

    if (vitalRegions.length >= 2) proofs.set(groupKey, Object.freeze(vitalRegions));
  }

  return proofs;
};