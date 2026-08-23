import type { PointId, Topology } from '../topology/Topology';
import type {
  DeterministicProofSearchAdapter,
  ProofSearchExpansion,
} from './DeterministicAndOrProofSearch';
import { buildEndgameGraph } from './EndgameGraphCore';
import {
  createEndgameProofSearchGoAdapter,
  transitionEndgameProofSearchMove,
  type EndgameProofSearchMove,
  type EndgameProofSearchNode,
} from './EndgameProofSearchGoAdapter';

export const THREE_LIBERTY_GO_ADAPTER_ALGORITHM =
  'endgame-go-three-liberty-adapter-v1';
export const THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY =
  'e2-5-three-liberty-attacks-limited-to-current-liberties';
export const THREE_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY =
  'e2-5-three-liberty-unknown-root-ko-branch';

const comparePoints = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

const exactThreeLibertyTarget = (
  node: EndgameProofSearchNode,
  topology: Topology,
) => {
  const graph = buildEndgameGraph(node.state, topology);
  const owners = new Set<string>();
  let survivingCrucialStones = 0;

  for (const point of node.crucialStones) {
    if (node.state.board[point] !== node.targetColor) continue;
    survivingCrucialStones += 1;
    const owner = graph.pointOwner.get(point);
    if (!owner) return null;
    owners.add(owner);
  }

  if (survivingCrucialStones === 0 || owners.size !== 1) return null;
  const targetGroupKey = [...owners][0]!;
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.color !== node.targetColor || target.liberties.length !== 3) {
    return null;
  }
  return target;
};

const acceptedPlacements = (
  node: EndgameProofSearchNode,
  topology: Topology,
  points: readonly PointId[],
): Readonly<{
  readonly moves: readonly EndgameProofSearchMove[];
  readonly hasKoDependency: boolean;
}> => {
  const moves: EndgameProofSearchMove[] = [];
  let hasKoDependency = false;

  for (const point of [...new Set(points)].sort(comparePoints)) {
    const move = Object.freeze({ kind: 'place' as const, point });
    const transition = transitionEndgameProofSearchMove(node, topology, move);
    if (transition.result === 'accepted') {
      moves.push(move);
      continue;
    }
    if (transition.result === 'ko-dependent') hasKoDependency = true;
  }

  return Object.freeze({
    moves: Object.freeze(moves),
    hasKoDependency,
  });
};

const expandThreeLibertyAttacker = (
  node: EndgameProofSearchNode,
  topology: Topology,
  liberties: readonly PointId[],
): ProofSearchExpansion<EndgameProofSearchMove> => {
  const placements = acceptedPlacements(node, topology, liberties);
  const reason = placements.hasKoDependency
    ? `${THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY}; ${THREE_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY}`
    : THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY;

  return Object.freeze({
    moves: placements.moves,
    completeness: Object.freeze({
      kind: 'incomplete' as const,
      reason,
    }),
  });
};

const expandThreeLibertyDefender = (
  node: EndgameProofSearchNode,
  topology: Topology,
): ProofSearchExpansion<EndgameProofSearchMove> => {
  const emptyPoints = [...topology.points()]
    .filter((point) => node.state.board[point] === 'empty')
    .sort(comparePoints);
  const placements = acceptedPlacements(node, topology, emptyPoints);
  const moves: EndgameProofSearchMove[] = [...placements.moves];

  const pass = Object.freeze({ kind: 'pass' as const });
  const passTransition = transitionEndgameProofSearchMove(node, topology, pass);
  if (passTransition.result === 'accepted') {
    moves.push(pass);
  } else {
    return Object.freeze({
      moves: Object.freeze(moves),
      completeness: Object.freeze({
        kind: 'incomplete' as const,
        reason: 'e2-5-defender-pass-transition-unavailable',
      }),
    });
  }

  return Object.freeze({
    moves: Object.freeze(moves),
    completeness: placements.hasKoDependency
      ? Object.freeze({
          kind: 'incomplete' as const,
          reason: THREE_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY,
        })
      : Object.freeze({ kind: 'complete' as const }),
  });
};

/**
 * E2-5 exact-three-liberty extension of the E2-4b Go adapter.
 *
 * Attacker generation is intentionally narrow: only legal placements on the
 * target's three current liberties are considered. The move set therefore
 * remains explicitly incomplete. It may establish an existential kill branch
 * but can never establish universal survival.
 *
 * Defender generation is correctness-first and whole-board complete: every
 * empty point is checked through the authoritative transition helper and Pass
 * is included. With exact known ko history, rejected placements are exact
 * illegal moves and the set is complete. At an external root with unknown
 * history, any structural simple-ko-shaped placement is omitted and the whole
 * defender set becomes explicit incomplete, preventing a false universal kill.
 *
 * Nodes outside the exact-three-liberty boundary delegate unchanged to the
 * E2-4b adapter and therefore remain explicitly incomplete unless a specialised
 * one/two-liberty positive terminal proof applies.
 */
export const createThreeLibertyProofSearchGoAdapter = (
  topology: Topology,
): DeterministicProofSearchAdapter<EndgameProofSearchNode, EndgameProofSearchMove> => {
  const base = createEndgameProofSearchGoAdapter(topology);

  return Object.freeze({
    nodeKey: (node: EndgameProofSearchNode): string =>
      `${THREE_LIBERTY_GO_ADAPTER_ALGORITHM}|${base.nodeKey(node)}`,
    role: base.role,
    terminal: base.terminal,
    expand: (node: EndgameProofSearchNode): ProofSearchExpansion<EndgameProofSearchMove> => {
      const target = exactThreeLibertyTarget(node, topology);
      if (!target) return base.expand(node);
      return node.role === 'attacker'
        ? expandThreeLibertyAttacker(node, topology, target.liberties)
        : expandThreeLibertyDefender(node, topology);
    },
    apply: base.apply,
    moveKey: base.moveKey,
  });
};
