import type { StoneColor } from '../game/types';
import type { EndgameEmptyRegion, EndgameStoneString } from './EndgameGraphCore';

export const BENSON_PASS_ALIVE_ALGORITHM = 'benson-pass-alive-v1';

export interface BensonPassAliveProof {
  readonly algorithm: typeof BENSON_PASS_ALIVE_ALGORITHM;
  readonly proof: 'two-vital-regions';
  readonly vitalRegions: readonly (readonly string[])[];
}

export const provePassAlive = (
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

export const buildBensonPassAliveProof = (
  vitalRegions: readonly EndgameEmptyRegion[],
): BensonPassAliveProof =>
  Object.freeze({
    algorithm: BENSON_PASS_ALIVE_ALGORITHM,
    proof: 'two-vital-regions',
    vitalRegions: Object.freeze(vitalRegions.map((region) => region.points)),
  });
