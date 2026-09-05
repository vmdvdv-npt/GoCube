import {
  KATAGO_REFERENCE_COMMIT,
  KATAGO_RULES_VERSION,
  type BensonPassAliveResult,
} from './BensonPassAlive';
import type { EndgameStaticGraph } from './EndgameStaticGraph';
import type { StoneColor } from '../game/types';
import type { PointId } from '../topology/Topology';

export const PASS_ALIVE_TERRITORY_ALGORITHM = 'katago-pass-alive-territory-v1';

export interface PassAliveTerritoryRegion {
  readonly key: string;
  readonly owner: StoneColor;
  readonly points: readonly PointId[];
  readonly boundaryAliveGroups: readonly string[];
  readonly internalSpacesMax2: 0 | 1 | 2;
}

export interface PassAliveTerritoryResult {
  readonly algorithm: typeof PASS_ALIVE_TERRITORY_ALGORITHM;
  readonly kataGoRulesVersion: typeof KATAGO_RULES_VERSION;
  readonly kataGoCommit: typeof KATAGO_REFERENCE_COMMIT;
  readonly black: readonly PointId[];
  readonly white: readonly PointId[];
  readonly ownerByPoint: ReadonlyMap<PointId, StoneColor>;
  readonly regions: readonly PassAliveTerritoryRegion[];
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Marks only KataGo's unconditional pass-alive territory from
 * Board::calculateAreaForPla, not safeBigTerritories/unsafeBigTerritories.
 *
 * A non-color region is owned when it has at most one point not adjacent to
 * the owner, every owner chain on its boundary survived Benson, and the owner
 * has at least one stone on the board.
 */
export const buildPassAliveTerritory = (
  graph: EndgameStaticGraph,
  blackBenson: BensonPassAliveResult,
  whiteBenson: BensonPassAliveResult,
): PassAliveTerritoryResult => {
  const ownerByPoint = new Map<PointId, StoneColor>();
  const regions: PassAliveTerritoryRegion[] = [];

  const analyzeColor = (benson: BensonPassAliveResult): void => {
    const color = benson.color;
    const aliveGroupKeys = new Set(benson.aliveGroups.keys());
    const atLeastOneStone = graph.strings.some((group) => group.color === color);
    if (!atLeastOneStone) return;

    for (const region of benson.regions) {
      const bordersNonPassAlive = region.boundaryGroups.some(
        (groupKey) => !aliveGroupKeys.has(groupKey),
      );
      if (region.internalSpacesMax2 > 1 || bordersNonPassAlive) continue;

      for (const point of region.points) {
        const existing = ownerByPoint.get(point);
        if (existing && existing !== color) {
          throw new Error(
            `Pass-alive territory conflict at ${point}: ${existing} vs ${color}`,
          );
        }
        ownerByPoint.set(point, color);
      }

      regions.push(
        Object.freeze({
          key: region.key,
          owner: color,
          points: region.points,
          boundaryAliveGroups: Object.freeze([...region.boundaryGroups].sort(compareStrings)),
          internalSpacesMax2: region.internalSpacesMax2,
        }),
      );
    }
  };

  analyzeColor(blackBenson);
  analyzeColor(whiteBenson);
  regions.sort((left, right) => compareStrings(left.key, right.key));

  const black: PointId[] = [];
  const white: PointId[] = [];
  for (const [point, owner] of ownerByPoint) {
    (owner === 'black' ? black : white).push(point);
  }
  black.sort(compareStrings);
  white.sort(compareStrings);

  return Object.freeze({
    algorithm: PASS_ALIVE_TERRITORY_ALGORITHM,
    kataGoRulesVersion: KATAGO_RULES_VERSION,
    kataGoCommit: KATAGO_REFERENCE_COMMIT,
    black: Object.freeze(black),
    white: Object.freeze(white),
    ownerByPoint,
    regions: Object.freeze(regions),
  });
};
