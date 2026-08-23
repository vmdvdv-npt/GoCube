import type { PointId, Topology } from '../topology/Topology';
import type {
  DeterministicProofSearchAdapter,
  ProofSearchExpansion,
} from './DeterministicAndOrProofSearch';
import { buildEndgameGraph } from './EndgameGraphCore';
import {
  transitionEndgameProofSearchMove,
  type EndgameProofSearchMove,
  type EndgameProofSearchNode,
} from './EndgameProofSearchGoAdapter';
import { createThreeLibertyProofSearchGoAdapter } from './ThreeLibertyProofSearchGoAdapter';

export const FOUR_LIBERTY_GO_ADAPTER_ALGORITHM =
  'endgame-go-four-liberty-adapter-v1';
export const FOUR_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY =
  'e2-6-four-liberty-attacks-limited-to-current-liberties';
export const FOUR_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY =
  'e2-6-four-liberty-unknown-root-ko-branch';

const comparePoints = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

const exactFourLibertyTarget = (
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
  if (!target || target.color !== node.targetColor || target.liberties.length !== 4) {
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

const expandFourLibertyAttacker = (
  node: EndgameProofSearchNode,
  topology: Topology,
  liberties: readonly PointId[],
): ProofSearchExpansion<EndgameProofSearchMove> => {
  const placements = acceptedPlacements(node, topology, liberties);
  const reason = placements.hasKoDependency
    ? `${FOUR_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY}; ${FOUR_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY}`
    : FOUR_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY;

  return Object.freeze({
    moves: placements.moves,
    completeness: Object.freeze({
      kind: 'incomplete' as const,
      reason,
    }),
  });
};

const expandFourLibertyDefender = (
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
        reason: 'e2-6-defender-pass-transition-unavailable',
      }),
    });
  }

  return Object.freeze({
    moves: Object.freeze(moves),
    completeness: placements.hasKoDependency
      ? Object.freeze({
          kind: 'incomplete' as const,
          reason: FOUR_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY,
        })
      : Object.freeze({ kind: 'complete' as const }),
  });
};

/**
 * E2-6 exact-four-liberty extension of the E2-5 Go adapter.
 *
 * Attacker generation is intentionally narrow: only legal placements on the
 * target's four current liberties are considered. The move set stays explicit
 * incomplete, so a 4 -> 3 -> E2-5 chain may establish an existential kill but
 * failure to find one can never establish survival.
 *
 * Defender generation remains correctness-first and whole-board complete:
 * every empty point is checked through the authoritative transition helper and
 * Pass is included. Unknown-history structural simple-ko branches are omitted
 * and downgrade completeness, preventing a false universal kill.
 *
 * Nodes outside exact four liberties delegate to E2-5. Exact three-liberty
 * nodes therefore retain E2-5 generation; all other non-terminal nodes keep the
 * earlier E2-4b explicit incomplete boundary. Classifier integration is absent.
 */
export const createFourLibertyProofSearchGoAdapter = (
  topology: Topology,
): DeterministicProofSearchAdapter<EndgameProofSearchNode, EndgameProofSearchMove> => {
  const base = createThreeLibertyProofSearchGoAdapter(topology);

  return Object.freeze({
    nodeKey: (node: EndgameProofSearchNode): string =>
      `${FOUR_LIBERTY_GO_ADAPTER_ALGORITHM}|${base.nodeKey(node)}`,
    role: base.role,
    terminal: base.terminal,
    expand: (node: EndgameProofSearchNode): ProofSearchExpansion<EndgameProofSearchMove> => {
      const target = exactFourLibertyTarget(node, topology);
      if (!target) return base.expand(node);
      return node.role === 'attacker'
        ? expandFourLibertyAttacker(node, topology, target.liberties)
        : expandFourLibertyDefender(node, topology);
    },
    apply: base.apply,
    moveKey: base.moveKey,
  });
};
