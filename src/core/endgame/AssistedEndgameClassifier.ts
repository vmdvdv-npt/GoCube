import type {
  EndgameAnalysisContext,
  EndgameClassifier,
  EndgameProposal,
} from './EndgameClassifier';
import {
  generateDeadCandidates,
  verifyDeadCandidate,
  type AutomaticDeadProof,
  type DeadAnalysisGroup,
} from './AutomaticDeadProof';
import {
  generateSekiCandidates,
  verifySekiCandidate,
  type AutomaticSekiProof,
} from './AutomaticSekiProof';
import { endgameGroupId } from './EndgameGroupIdentity';
import { ManualEndgameClassifier } from './ManualEndgameClassifier';
import type { StoneColor } from '../game/types';
import type { PointId } from '../topology/Topology';

interface GroupInfo extends DeadAnalysisGroup {}

interface EmptyRegion {
  readonly key: string;
  readonly points: readonly PointId[];
  readonly boundaryGroups: readonly string[];
  readonly vitalGroups: readonly string[];
}

interface GroupIndex {
  readonly byKey: ReadonlyMap<string, GroupInfo>;
  readonly pointOwner: ReadonlyMap<PointId, string>;
  readonly complete: boolean;
}

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
    const groupIndex = indexGroups(context, baseline);

    // Automatic proof is only sound when the analysis context describes every
    // stone on the logical board. A partial context remains safely unresolved.
    if (!groupIndex.complete) return baseline;

    const regions = collectEmptyRegions(context, groupIndex.pointOwner);
    const aliveProofs = new Map<string, readonly EmptyRegion[]>();

    for (const color of COLORS) {
      for (const [groupKey, vitalRegions] of provePassAlive(
        color,
        groupIndex.byKey,
        regions,
      )) {
        aliveProofs.set(groupKey, vitalRegions);
      }
    }

    const passAliveGroupKeys = new Set(aliveProofs.keys());
    const deadProofs = new Map<string, AutomaticDeadProof>();
    for (const candidate of generateDeadCandidates(groupIndex.byKey, passAliveGroupKeys)) {
      const verification = verifyDeadCandidate(candidate, {
        state: context.state,
        topology: context.topology,
        groups: groupIndex.byKey,
        pointOwner: groupIndex.pointOwner,
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
      groupIndex.byKey,
      alreadyResolvedGroupKeys,
    )) {
      const verification = verifySekiCandidate(candidate, {
        state: context.state,
        topology: context.topology,
        groups: groupIndex.byKey,
        pointOwner: groupIndex.pointOwner,
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

const indexGroups = (
  context: EndgameAnalysisContext,
  baseline: EndgameProposal,
): GroupIndex => {
  const byKey = new Map<string, GroupInfo>();
  const pointOwner = new Map<PointId, string>();

  for (const proposal of baseline) {
    const key = endgameGroupId(proposal.points);
    const color = context.state.board[proposal.points[0]!];
    if (color !== 'black' && color !== 'white') {
      throw new Error(`Validated endgame group lost stone occupancy: ${proposal.points[0]}`);
    }

    const liberties = new Set<PointId>();
    for (const point of proposal.points) {
      for (const neighbor of context.topology.neighbors(point)) {
        if (context.state.board[neighbor] === 'empty') liberties.add(neighbor);
      }
    }

    const info: GroupInfo = Object.freeze({
      key,
      points: proposal.points,
      color,
      liberties: Object.freeze([...liberties].sort()),
    });
    byKey.set(key, info);
    for (const point of proposal.points) pointOwner.set(point, key);
  }

  let complete = true;
  for (const point of context.topology.points()) {
    const occupancy = context.state.board[point];
    if ((occupancy === 'black' || occupancy === 'white') && !pointOwner.has(point)) {
      complete = false;
      break;
    }
  }

  return Object.freeze({ byKey, pointOwner, complete });
};

const collectEmptyRegions = (
  context: EndgameAnalysisContext,
  pointOwner: ReadonlyMap<PointId, string>,
): readonly EmptyRegion[] => {
  const visited = new Set<PointId>();
  const regions: EmptyRegion[] = [];

  for (const start of [...context.topology.points()].sort()) {
    if (visited.has(start) || context.state.board[start] !== 'empty') continue;

    const pending: PointId[] = [start];
    const points: PointId[] = [];
    visited.add(start);

    while (pending.length > 0) {
      const point = pending.pop()!;
      points.push(point);

      for (const neighbor of context.topology.neighbors(point)) {
        if (context.state.board[neighbor] !== 'empty' || visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }

    points.sort();
    const boundaryGroups = new Set<string>();
    for (const point of points) {
      for (const neighbor of context.topology.neighbors(point)) {
        const owner = pointOwner.get(neighbor);
        if (owner) boundaryGroups.add(owner);
      }
    }

    const vitalGroups = new Set(boundaryGroups);
    for (const point of points) {
      const adjacentGroups = new Set<string>();
      for (const neighbor of context.topology.neighbors(point)) {
        const owner = pointOwner.get(neighbor);
        if (owner) adjacentGroups.add(owner);
      }

      for (const groupKey of [...vitalGroups]) {
        if (!adjacentGroups.has(groupKey)) vitalGroups.delete(groupKey);
      }
    }

    const frozenPoints = Object.freeze(points);
    regions.push(
      Object.freeze({
        key: JSON.stringify(frozenPoints),
        points: frozenPoints,
        boundaryGroups: Object.freeze([...boundaryGroups].sort()),
        vitalGroups: Object.freeze([...vitalGroups].sort()),
      }),
    );
  }

  return Object.freeze(
    regions.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
  );
};

const provePassAlive = (
  color: StoneColor,
  groups: ReadonlyMap<string, GroupInfo>,
  regions: readonly EmptyRegion[],
): ReadonlyMap<string, readonly EmptyRegion[]> => {
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

  const proofs = new Map<string, readonly EmptyRegion[]>();
  for (const groupKey of [...remainingGroups].sort()) {
    const vitalRegions = [...remainingRegions]
      .map((regionKey) => candidateRegions.get(regionKey)!)
      .filter((region) => region.vitalGroups.includes(groupKey))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

    if (vitalRegions.length >= 2) proofs.set(groupKey, Object.freeze(vitalRegions));
  }

  return proofs;
};
