import type {
  EndgameAnalysisContext,
  EndgameClassifier,
  EndgameProposal,
} from './EndgameClassifier';
import { endgameGroupId } from './EndgameGroupIdentity';
import { ManualEndgameClassifier } from './ManualEndgameClassifier';
import type { StoneColor } from '../game/types';
import type { PointId } from '../topology/Topology';

interface GroupInfo {
  readonly key: string;
  readonly points: readonly PointId[];
  readonly color: StoneColor;
}

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
const ALGORITHM = 'benson-pass-alive-v1';

/**
 * Conservative assisted classifier.
 *
 * At the 0.3.04 boundary it proves only unconditional/pass-alive groups using
 * Benson's fixed-point criterion. Anything not proven alive stays unresolved;
 * dead and seki classification are intentionally left to later checkpoints.
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
    const proofs = new Map<string, readonly EmptyRegion[]>();

    for (const color of COLORS) {
      for (const [groupKey, vitalRegions] of provePassAlive(
        color,
        groupIndex.byKey,
        regions,
      )) {
        proofs.set(groupKey, vitalRegions);
      }
    }

    return Object.freeze(
      baseline.map((proposal) => {
        const vitalRegions = proofs.get(endgameGroupId(proposal.points));
        if (!vitalRegions) return proposal;

        return Object.freeze({
          points: proposal.points,
          status: 'alive' as const,
          source: 'automatic' as const,
          evidence: Object.freeze({
            algorithm: ALGORITHM,
            proof: 'two-vital-regions',
            vitalRegions: Object.freeze(vitalRegions.map((region) => region.points)),
          }),
        });
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

    const info: GroupInfo = Object.freeze({ key, points: proposal.points, color });
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

  return Object.freeze(regions.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)));
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
