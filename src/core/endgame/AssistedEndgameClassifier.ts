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
import type { StoneColor } from '../game/types';

const COLORS: readonly StoneColor[] = Object.freeze(['black', 'white']);
const ALIVE_ALGORITHM = 'benson-pass-alive-v1';

/**
 * Conservative assisted classifier.
 *
 * It proves unconditional/pass-alive groups using Benson's fixed-point
 * criterion, sends only narrow single-liberty dead candidates through a
 * separate strict verifier, and resolves seki only for a closed mutual
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

    const aliveProofs = new Map<string, readonly EndgameEmptyRegion[]>();
    for (const color of COLORS) {
      for (const [groupKey, vitalRegions] of provePassAlive(
        color,
        graph.stringsByKey,
        graph.emptyRegions,
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

    const alreadyResolvedGroupKeys = new Set<string>([
      ...passAliveGroupKeys,
      ...deadProofs.keys(),
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
