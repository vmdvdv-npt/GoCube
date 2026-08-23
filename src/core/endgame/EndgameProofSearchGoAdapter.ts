import { GameEngine, type MoveRejectionReason } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import {
  type DeterministicProofSearchAdapter,
  type ProofSearchExpansion,
  type ProofSearchRole,
  type ProofSearchTerminal,
} from './DeterministicAndOrProofSearch';
import { buildEndgameGraph } from './EndgameGraphCore';
import { isPotentialSimpleKoCapture, readOneLibertyTactics } from './OneLibertyTacticalReader';
import { readTwoLibertyTacticsPruned } from './TwoLibertyPrunedTacticalReader';

export const ENDGAME_GO_ADAPTER_ALGORITHM = 'endgame-go-proof-adapter-v1';
export const ENDGAME_GO_MOVE_GENERATION_BOUNDARY =
  'go-move-generation-not-installed-e2-4b';

export type EndgameProofSearchMove =
  | Readonly<{ readonly kind: 'place'; readonly point: PointId }>
  | Readonly<{ readonly kind: 'pass' }>;

export interface EndgameProofSearchNode {
  readonly state: GameState;
  readonly targetColor: StoneColor;
  readonly crucialStones: readonly PointId[];
  readonly role: ProofSearchRole;
  /**
   * Board immediately preceding `state`, when known. Undefined at an external
   * root whose real game history was not supplied.
   */
  readonly previousBoard?: BoardOccupancy;
}

export type EndgameProofMoveTransition =
  | Readonly<{
      readonly result: 'accepted';
      readonly node: EndgameProofSearchNode;
    }>
  | Readonly<{
      readonly result: 'illegal';
      readonly reason: MoveRejectionReason | 'not-playing';
    }>
  | Readonly<{
      readonly result: 'ko-dependent';
      readonly reason: 'unknown-root-simple-ko';
    }>;

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const comparePoints = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

const playerForRole = (
  targetColor: StoneColor,
  role: ProofSearchRole,
): StoneColor => (role === 'defender' ? targetColor : opponentOf(targetColor));

const nextRole = (role: ProofSearchRole): ProofSearchRole =>
  role === 'attacker' ? 'defender' : 'attacker';

const asPlayingState = (state: GameState, currentPlayer: StoneColor): GameState =>
  Object.freeze({
    ...state,
    currentPlayer,
    consecutivePasses: 0,
    phase: 'playing' as const,
  });

const freezeNode = (
  state: GameState,
  targetColor: StoneColor,
  crucialStones: readonly PointId[],
  role: ProofSearchRole,
  previousBoard?: BoardOccupancy,
): EndgameProofSearchNode =>
  Object.freeze({
    state,
    targetColor,
    crucialStones: Object.freeze([...crucialStones].sort(comparePoints)),
    role,
    ...(previousBoard ? { previousBoard } : {}),
  });

export const createEndgameProofSearchNode = (
  topology: Topology,
  state: GameState,
  targetColor: StoneColor,
  crucialStones: readonly PointId[],
  role: ProofSearchRole,
  previousBoard?: BoardOccupancy,
): EndgameProofSearchNode => {
  const uniqueCrucialStones = [...new Set(crucialStones)].sort(comparePoints);
  if (uniqueCrucialStones.length === 0) {
    throw new Error('Endgame proof node requires at least one crucial stone');
  }
  for (const point of uniqueCrucialStones) {
    if (!topology.has(point)) throw new Error(`Unknown crucial stone point: ${point}`);
  }
  return freezeNode(state, targetColor, uniqueCrucialStones, role, previousBoard);
};

const allCrucialStonesCaptured = (node: EndgameProofSearchNode): boolean =>
  node.crucialStones.every((point) => node.state.board[point] !== node.targetColor);

const uniqueSurvivingTargetGroupKey = (
  node: EndgameProofSearchNode,
  topology: Topology,
): string | null => {
  const graph = buildEndgameGraph(node.state, topology);
  const owners = new Set<string>();
  for (const point of node.crucialStones) {
    if (node.state.board[point] !== node.targetColor) continue;
    const owner = graph.pointOwner.get(point);
    if (!owner) return null;
    owners.add(owner);
  }
  return owners.size === 1 ? [...owners][0]! : null;
};

/**
 * Maps only positive, role-appropriate specialised kill proofs into generic
 * terminal facts. A specialised non-proof is never mapped to survival.
 *
 * Ko/critical/unresolved specialised outcomes are intentionally not terminals
 * here: future generic move generation may still contain another decisive
 * branch. Until that generator exists, the adapter's explicit incomplete move
 * set makes the generic result UNRESOLVED rather than guessing.
 */
export const evaluateEndgameSpecialisedTerminal = (
  node: EndgameProofSearchNode,
  topology: Topology,
): ProofSearchTerminal | null => {
  if (allCrucialStonesCaptured(node)) {
    return Object.freeze({
      outcome: 'proven-kill' as const,
      reason: 'target-crucial-stones-captured',
    });
  }

  const graph = buildEndgameGraph(node.state, topology);
  const targetGroupKey = uniqueSurvivingTargetGroupKey(node, topology);
  if (!targetGroupKey) return null;
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.color !== node.targetColor) return null;

  if (target.liberties.length === 1) {
    const proof = readOneLibertyTactics(
      node.state,
      topology,
      graph,
      targetGroupKey,
      node.previousBoard
        ? Object.freeze({ previousBoard: node.previousBoard })
        : undefined,
    );
    if (!proof) return null;

    const provenKill =
      node.role === 'attacker'
        ? proof.attackerFirst.result === 'kill'
        : proof.defenderFirst.result === 'forced-kill';
    return provenKill
      ? Object.freeze({
          outcome: 'proven-kill' as const,
          reason:
            node.role === 'attacker'
              ? 'one-liberty-attacker-proof'
              : 'one-liberty-defender-proof',
        })
      : null;
  }

  if (target.liberties.length === 2) {
    const proof = readTwoLibertyTacticsPruned(
      node.state,
      topology,
      graph,
      targetGroupKey,
    );
    if (!proof) return null;

    const provenKill =
      node.role === 'attacker'
        ? proof.attackerFirst.result === 'forced-kill'
        : proof.defenderFirst.result === 'forced-kill';
    return provenKill
      ? Object.freeze({
          outcome: 'proven-kill' as const,
          reason:
            node.role === 'attacker'
              ? 'two-liberty-attacker-proof'
              : 'two-liberty-defender-proof',
        })
      : null;
  }

  return null;
};

/**
 * Authoritative Go transition helper for future generic move generators.
 *
 * - legality is delegated to GameEngine;
 * - when `previousBoard` is known it is supplied as exact simple-ko context;
 * - at an unknown-history root, a structural simple-ko-shaped placement does
 *   not create a child node and returns `ko-dependent` instead;
 * - every accepted child carries `previousBoard = parent.state.board`.
 */
export const transitionEndgameProofSearchMove = (
  node: EndgameProofSearchNode,
  topology: Topology,
  move: EndgameProofSearchMove,
): EndgameProofMoveTransition => {
  const engine = new GameEngine(topology);
  const player = playerForRole(node.targetColor, node.role);
  const playingState = asPlayingState(node.state, player);

  if (move.kind === 'pass') {
    const passed = engine.pass(playingState);
    if (!passed.ok) {
      return Object.freeze({ result: 'illegal' as const, reason: passed.reason });
    }
    return Object.freeze({
      result: 'accepted' as const,
      node: freezeNode(
        passed.state,
        node.targetColor,
        node.crucialStones,
        nextRole(node.role),
        node.state.board,
      ),
    });
  }

  const placed = engine.placeStone(
    playingState,
    move.point,
    player,
    node.previousBoard
      ? Object.freeze({ previousBoard: node.previousBoard })
      : undefined,
  );
  if (!placed.ok) {
    return Object.freeze({ result: 'illegal' as const, reason: placed.reason });
  }

  if (
    !node.previousBoard &&
    isPotentialSimpleKoCapture(
      engine,
      placed.state,
      move.point,
      player,
      placed.captured,
    )
  ) {
    return Object.freeze({
      result: 'ko-dependent' as const,
      reason: 'unknown-root-simple-ko' as const,
    });
  }

  return Object.freeze({
    result: 'accepted' as const,
    node: freezeNode(
      placed.state,
      node.targetColor,
      node.crucialStones,
      nextRole(node.role),
      node.state.board,
    ),
  });
};

const boardSignature = (
  board: BoardOccupancy,
  orderedPoints: readonly PointId[],
): string =>
  orderedPoints
    .map((point) => {
      const occupancy = board[point];
      return occupancy === 'black' ? 'b' : occupancy === 'white' ? 'w' : '.';
    })
    .join('');

export const endgameProofSearchNodeKey = (
  node: EndgameProofSearchNode,
  topology: Topology,
): string => {
  const points = [...topology.points()].sort(comparePoints);
  const previous = node.previousBoard
    ? boardSignature(node.previousBoard, points)
    : '?';
  return [
    ENDGAME_GO_ADAPTER_ALGORITHM,
    node.targetColor,
    node.role,
    node.crucialStones.join(','),
    boardSignature(node.state.board, points),
    `prev:${previous}`,
  ].join('|');
};

/**
 * E2-4b adapter bridge. It deliberately exposes no generic Go move generator
 * yet. Non-terminal nodes therefore have an explicit incomplete expansion and
 * resolve to UNRESOLVED under the E2-4a core. E2-5 may later replace this
 * expansion with proven-complete/proof-safe move generation without changing
 * terminal or transition semantics.
 */
export const createEndgameProofSearchGoAdapter = (
  topology: Topology,
): DeterministicProofSearchAdapter<EndgameProofSearchNode, EndgameProofSearchMove> =>
  Object.freeze({
    nodeKey: (node: EndgameProofSearchNode): string =>
      endgameProofSearchNodeKey(node, topology),
    role: (node: EndgameProofSearchNode): ProofSearchRole => node.role,
    terminal: (node: EndgameProofSearchNode): ProofSearchTerminal | null =>
      evaluateEndgameSpecialisedTerminal(node, topology),
    expand: (_node: EndgameProofSearchNode): ProofSearchExpansion<EndgameProofSearchMove> =>
      Object.freeze({
        moves: Object.freeze([] as EndgameProofSearchMove[]),
        completeness: Object.freeze({
          kind: 'incomplete' as const,
          reason: ENDGAME_GO_MOVE_GENERATION_BOUNDARY,
        }),
      }),
    apply: (node: EndgameProofSearchNode, move: EndgameProofSearchMove): EndgameProofSearchNode => {
      const transition = transitionEndgameProofSearchMove(node, topology, move);
      if (transition.result !== 'accepted') {
        throw new Error(
          `Proof-search adapter apply received non-accepted move '${move.kind === 'pass' ? 'pass' : move.point}': ${transition.result}`,
        );
      }
      return transition.node;
    },
    moveKey: (move: EndgameProofSearchMove): string =>
      move.kind === 'pass' ? 'pass' : `place:${move.point}`,
  });
