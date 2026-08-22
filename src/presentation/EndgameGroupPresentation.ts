import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import {
  compareEndgamePointIds,
  endgameGroupId,
} from '../core/endgame/EndgameGroupIdentity';
import type { StoneColor } from '../core/game/types';
import type { PointId, Topology } from '../core/topology/Topology';

export { endgameGroupId } from '../core/endgame/EndgameGroupIdentity';

export type EndgameVisualStatus = GroupStatus | 'unknown';

export interface EndgameGroupEdge {
  readonly from: PointId;
  readonly to: PointId;
}

export interface EndgameGroupPresentation {
  readonly id: string;
  readonly points: readonly PointId[];
  readonly color: StoneColor;
  readonly edges: readonly EndgameGroupEdge[];
}

export interface EndgameGroupRenderState extends EndgameGroupPresentation {
  readonly status: EndgameVisualStatus | null;
}

export const buildEndgameGroupEdges = (
  points: readonly PointId[],
  topology: Topology,
): readonly EndgameGroupEdge[] => {
  const pointSet = new Set(points);
  const seen = new Set<string>();
  const edges: EndgameGroupEdge[] = [];

  for (const point of points) {
    if (!topology.has(point)) {
      throw new Error(`Unknown endgame point: ${point}`);
    }

    for (const neighbor of topology.neighbors(point)) {
      if (!pointSet.has(neighbor)) continue;

      const from = compareEndgamePointIds(point, neighbor) <= 0 ? point : neighbor;
      const to = from === point ? neighbor : point;
      const key = `${from}\u0000${to}`;
      if (seen.has(key)) continue;

      seen.add(key);
      edges.push(Object.freeze({ from, to }));
    }
  }

  edges.sort((left, right) =>
    compareEndgamePointIds(left.from, right.from) || compareEndgamePointIds(left.to, right.to),
  );

  return Object.freeze(edges);
};

export const endgameGroupForPoint = (
  groups: readonly EndgameGroupPresentation[],
  point: PointId,
): EndgameGroupPresentation | null =>
  groups.find((group) => group.points.includes(point)) ?? null;
