import type { PointId, Topology } from '../topology/Topology';
import type { EndgameGraph } from './EndgameGraphCore';

export const TWO_LIBERTY_POST_DEFENSE_MAX_PLIES = 3;
export const TWO_LIBERTY_DEFENDER_CAUSAL_WAVES = 6;

export interface TwoLibertyDefenderRelevance {
  readonly targetGroupKey: string;
  readonly postDefenseMaxPlies: typeof TWO_LIBERTY_POST_DEFENSE_MAX_PLIES;
  readonly causalWaves: typeof TWO_LIBERTY_DEFENDER_CAUSAL_WAVES;
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
 * Builds a conservative graph-native causal cone for the exact bounded
 * continuation used by the current two-liberty proof.
 *
 * A single general Go move can affect a target two graph edges away: a move
 * can capture an adjacent connected string, and removing that string changes
 * the liberties of groups adjacent to any of its stones. Existing connected
 * strings are therefore collapsed at zero extra wave cost whenever one of
 * their stones is reached.
 *
 * The longest current defender-first continuation is stage-specific:
 *
 *   root defender move                         <= 2 dependency waves
 *   -> two-lib attacker reduction              <= 1 wave
 *   -> one-lib defender extension/countercap   <= 2 waves
 *   -> final attacker liberty capture          <= 1 wave
 *
 * Total: six graph-adjacency waves, with complete current-string closure after
 * every wave. This is intentionally wider than geometric locality and keeps
 * long strings, counter-captures, cuts/connections and seam/edge adjacency in
 * the same proof boundary.
 *
 * A root placement outside `relevantRootPlacements` has no board-effect path
 * into that bounded tactical continuation. It still MUST be passed through
 * authoritative GameEngine legality and root-ko detection; this helper only
 * certifies tactical irrelevance after those checks.
 */
export const buildTwoLibertyDefenderRelevance = (
  topology: Topology,
  graph: EndgameGraph,
  targetGroupKey: string,
): TwoLibertyDefenderRelevance | null => {
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.liberties.length !== 2) return null;

  const cone = closeThroughExistingStoneStrings(new Set(target.points), graph);
  let frontier = new Set<PointId>(cone);

  for (let wave = 0; wave < TWO_LIBERTY_DEFENDER_CAUSAL_WAVES; wave += 1) {
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

  return Object.freeze({
    targetGroupKey,
    postDefenseMaxPlies: TWO_LIBERTY_POST_DEFENSE_MAX_PLIES,
    causalWaves: TWO_LIBERTY_DEFENDER_CAUSAL_WAVES,
    causalConePoints: Object.freeze([...cone].sort(comparePoints)),
    relevantRootPlacements: Object.freeze([...cone].sort(comparePoints)),
  });
};
