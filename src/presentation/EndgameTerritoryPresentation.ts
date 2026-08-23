import type { StoneColor } from '../core/game/types';
import type { PointId, Topology } from '../core/topology/Topology';
import type { EndgameGroupPresentation } from './EndgameGroupPresentation';
import type { GameViewModel } from './PresentationModel';

export type EndgameTerritoryOwner = StoneColor;

export interface ProvisionalEndgameTerritoryInput {
  readonly viewModel: GameViewModel;
  readonly topology: Topology;
  readonly groups: readonly EndgameGroupPresentation[];
  readonly decisions: Readonly<Partial<Record<string, 'alive' | 'dead' | 'seki'>>>;
}

/**
 * Derives only territory that is already safe to show during endgame review.
 *
 * Dead groups are treated as removed for region connectivity, while unresolved
 * and seki groups make every touching region visually neutral. The returned map
 * contains only points that are empty on the still-visible review board; dead
 * stone locations receive territory markers only after the review is finalized
 * and the stones are visually removed.
 */
export const provisionalEndgameTerritory = (
  input: ProvisionalEndgameTerritoryInput,
): ReadonlyMap<PointId, EndgameTerritoryOwner> => {
  const owners = new Map<PointId, EndgameTerritoryOwner>();
  if (input.viewModel.phase !== 'endgame') return owners;

  const occupancy = new Map(
    input.viewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
  );
  const groupStatusByPoint = new Map<PointId, 'alive' | 'dead' | 'seki' | null>();

  for (const group of input.groups) {
    const status = input.decisions[group.id] ?? null;
    for (const point of group.points) groupStatusByPoint.set(point, status);
  }

  const isEffectivelyEmpty = (point: PointId): boolean => {
    const value = occupancy.get(point);
    return value === 'empty' || groupStatusByPoint.get(point) === 'dead';
  };

  const visited = new Set<PointId>();
  for (const start of input.topology.points()) {
    if (visited.has(start) || !isEffectivelyEmpty(start)) continue;

    const region: PointId[] = [];
    const boundaryColors = new Set<StoneColor>();
    let ambiguous = false;
    const pending: PointId[] = [start];
    visited.add(start);

    while (pending.length > 0) {
      const point = pending.pop()!;
      region.push(point);

      for (const neighbor of input.topology.neighbors(point)) {
        if (isEffectivelyEmpty(neighbor)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            pending.push(neighbor);
          }
          continue;
        }

        const color = occupancy.get(neighbor);
        if (color !== 'black' && color !== 'white') {
          ambiguous = true;
          continue;
        }

        const status = groupStatusByPoint.get(neighbor);
        if (status === 'alive') {
          boundaryColors.add(color);
        } else {
          // Seki, unresolved, or a stone not represented by the current review
          // must not create a premature territory claim.
          ambiguous = true;
        }
      }
    }

    if (ambiguous || boundaryColors.size !== 1) continue;
    const owner = boundaryColors.values().next().value as StoneColor;
    for (const point of region) {
      if (occupancy.get(point) === 'empty') owners.set(point, owner);
    }
  }

  return owners;
};
