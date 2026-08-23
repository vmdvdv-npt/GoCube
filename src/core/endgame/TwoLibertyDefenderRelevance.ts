import type { PointId, Topology } from '../topology/Topology';
import type { EndgameGraph } from './EndgameGraphCore';

export const TWO_LIBERTY_POST_DEFENSE_MAX_PLIES = 3;

export interface TwoLibertyDefenderRelevance {
  readonly targetGroupKey: string;
  readonly postDefenseMaxPlies: typeof TWO_LIBERTY_POST_DEFENSE_MAX_PLIES;
  readonly causalConePoints: readonly PointId[];
  readonly relevantRootPlacements: readonly PointId[];
}

const comparePoints = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

const closeThroughExistingStoneStrings = (
  seeds: ReadonlySet<PointId>,
  graph: EndgameGraph,
): Set<PointId> => {
  const closed = new Set<PointId>(seeds);
  const pending = [...seeds];

  for (let index = 0; index < pending.length; index += 1) {
    const point = pending[index]!;
    const owner = graph.pointOwner.get(point);
    if (!owner) continue;
    const group = graph.groups.get(owner);
    if (!group) continue;

    for (const groupPoint of group.points) {
      if (closed.has(groupPoint)) continue;
      closed.add(groupPoint);
      pending.push(groupPoint);
    }
  }

  return closed;
};

/**
 * Builds a conservative graph-native causal cone for the bounded defender-first
 * continuation used by the current two-liberty reader.
 *
 * The continuation after a root defender placement has at most three further
 * moves that can affect the proof result:
 *
 *   two-lib attacker reduction
 *   -> one-lib defender reply
 *   -> attacker capture reply
 *
 * Ordinary move effects propagate through Topology adjacency. Captures can
 * affect an arbitrarily long already-connected stone string in one move, so an
 * encountered stone point closes through its complete current string at zero
 * additional ply cost. After the three move-expansion waves, one extra root
 * halo is included because the root defender move itself can directly change
 * the liberty/capture state of any point in the causal cone.
 *
 * A root placement outside `relevantRootPlacements` is therefore not adjacent
 * to any point that the bounded continuation can causally reach, even after
 * collapsing existing connected strings. Such a placement still has to be
 * checked separately for authoritative legality and root-ko capture semantics;
 * this helper certifies only local tactical irrelevance.
 */
export const buildTwoLibertyDefenderRelevance = (
  topology: Topology,
  graph: EndgameGraph,
  targetGroupKey: string,
): TwoLibertyDefenderRelevance | null => {
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.liberties.length !== 2) return null;

  let cone = closeThroughExistingStoneStrings(new Set(target.points), graph);
  let frontier = new Set<PointId>(cone);

  for (let ply = 0; ply < TWO_LIBERTY_POST_DEFENSE_MAX_PLIES; ply += 1) {
    const nextSeeds = new Set<PointId>();
    for (const point of frontier) {
      for (const neighbor of topology.neighbors(point)) {
        if (!cone.has(neighbor)) nextSeeds.add(neighbor);
      }
    }

    const nextClosed = closeThroughExistingStoneStrings(nextSeeds, graph);
    const nextFrontier = new Set<PointId>();
    for (const point of nextClosed) {
      if (cone.has(point)) continue;
      cone.add(point);
      nextFrontier.add(point);
    }
    frontier = nextFrontier;
    if (frontier.size === 0) break;
  }

  const relevantRootPlacements = new Set<PointId>(cone);
  for (const point of cone) {
    for (const neighbor of topology.neighbors(point)) relevantRootPlacements.add(neighbor);
  }

  return Object.freeze({
    targetGroupKey,
    postDefenseMaxPlies: TWO_LIBERTY_POST_DEFENSE_MAX_PLIES,
    causalConePoints: Object.freeze([...cone].sort(comparePoints)),
    relevantRootPlacements: Object.freeze([...relevantRootPlacements].sort(comparePoints)),
  });
};
