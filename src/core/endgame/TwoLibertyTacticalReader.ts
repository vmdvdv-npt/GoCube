import { GameEngine } from '../game/GameEngine';
import type { GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameGraph } from './EndgameGraphCore';
import {
  isPotentialSimpleKoCapture,
  readOneLibertyTactics,
  type OneLibertyTacticalResult,
} from './OneLibertyTacticalReader';

export const TWO_LIBERTY_TACTICAL_ALGORITHM = 'two-liberty-reduction-reader-v1';

export interface TwoLibertyReductionLine {
  readonly move: PointId;
  readonly result: 'forced-kill' | 'ko-dependent' | 'not-proven' | 'illegal';
  readonly remainingLiberties?: readonly PointId[];
  readonly rejectionReason?: string;
  readonly oneLibertyProof?: OneLibertyTacticalResult;
}

export interface TwoLibertyTacticalResult {
  readonly algorithm: typeof TWO_LIBERTY_TACTICAL_ALGORITHM;
  readonly targetGroupKey: string;
  readonly crucialStones: readonly PointId[];
  readonly attackPoints: readonly PointId[];
  readonly attackerFirst: Readonly<{
    readonly result: 'forced-kill' | 'unresolved';
    readonly winningMoves: readonly PointId[];
    readonly lines: readonly TwoLibertyReductionLine[];
  }>;
  readonly defenderFirst: Readonly<{
    readonly result: 'unresolved';
    readonly reason: 'complete-defender-move-set-not-proven';
  }>;
  readonly outcome: 'unresolved';
  readonly exploredNodes: number;
  readonly maxDepth: number;
}

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const asPlayingState = (state: GameState, currentPlayer: StoneColor): GameState =>
  Object.freeze({
    ...state,
    currentPlayer,
    consecutivePasses: 0,
    phase: 'playing' as const,
  });

const crucialStonesCaptured = (
  state: GameState,
  targetColor: StoneColor,
  crucialStones: readonly PointId[],
): boolean => crucialStones.every((point) => state.board[point] !== targetColor);

const survivingGroupKey = (
  state: GameState,
  graph: EndgameGraph,
  targetColor: StoneColor,
  crucialStones: readonly PointId[],
): string | null => {
  const survivingPoint = crucialStones.find((point) => state.board[point] === targetColor);
  return survivingPoint ? graph.pointOwner.get(survivingPoint) ?? null : null;
};

/**
 * Conservative first slice of two-liberty reading.
 *
 * It proves only an attacker-first raw fact: an attacker move on one of the two
 * current liberties is winning when that legal, non-ko-dependent move reduces
 * the target to exactly one liberty and the strict one-liberty reader proves
 * every immediate defender reply loses from the resulting position.
 *
 * This is deliberately NOT enough for automatic `dead`: the complete set of
 * meaningful defender-first moves in the original two-liberty position has not
 * yet been proven. Therefore the final outcome remains `unresolved` even when
 * an attacker-first forced kill is found.
 */
export const readTwoLibertyTactics = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  targetGroupKey: string,
): TwoLibertyTacticalResult | null => {
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.liberties.length !== 2) return null;

  const engine = new GameEngine(topology);
  const attacker = opponentOf(target.color);
  const crucialStones = target.points;
  const attackPoints = Object.freeze([...target.liberties].sort());
  const lines: TwoLibertyReductionLine[] = [];
  const winningMoves: PointId[] = [];
  let exploredNodes = 0;
  let maxDepth = 1;

  for (const move of attackPoints) {
    exploredNodes += 1;
    const attack = engine.placeStone(asPlayingState(state, attacker), move, attacker);

    if (!attack.ok) {
      lines.push(
        Object.freeze({
          move,
          result: 'illegal' as const,
          rejectionReason: attack.reason,
        }),
      );
      continue;
    }

    if (
      isPotentialSimpleKoCapture(
        engine,
        attack.state,
        move,
        attacker,
        attack.captured,
      )
    ) {
      lines.push(Object.freeze({ move, result: 'ko-dependent' as const }));
      continue;
    }

    if (crucialStonesCaptured(attack.state, target.color, crucialStones)) {
      winningMoves.push(move);
      lines.push(Object.freeze({ move, result: 'forced-kill' as const }));
      continue;
    }

    const reducedGraph = buildEndgameGraph(attack.state, topology);
    const reducedGroupKey = survivingGroupKey(
      attack.state,
      reducedGraph,
      target.color,
      crucialStones,
    );
    const reducedGroup = reducedGroupKey ? reducedGraph.groups.get(reducedGroupKey) : null;

    if (!reducedGroup || reducedGroup.liberties.length !== 1) {
      lines.push(
        Object.freeze({
          move,
          result: 'not-proven' as const,
          ...(reducedGroup
            ? { remainingLiberties: Object.freeze([...reducedGroup.liberties]) }
            : {}),
        }),
      );
      continue;
    }

    const oneLibertyProof = readOneLibertyTactics(
      attack.state,
      topology,
      reducedGraph,
      reducedGroup.key,
      Object.freeze({ previousBoard: state.board }),
    );
    if (!oneLibertyProof) {
      lines.push(
        Object.freeze({
          move,
          result: 'not-proven' as const,
          remainingLiberties: reducedGroup.liberties,
        }),
      );
      continue;
    }

    exploredNodes += oneLibertyProof.exploredNodes;
    maxDepth = Math.max(maxDepth, 1 + oneLibertyProof.maxDepth);

    if (oneLibertyProof.defenderFirst.result === 'forced-kill') {
      winningMoves.push(move);
      lines.push(
        Object.freeze({
          move,
          result: 'forced-kill' as const,
          remainingLiberties: reducedGroup.liberties,
          oneLibertyProof,
        }),
      );
      continue;
    }

    lines.push(
      Object.freeze({
        move,
        result:
          oneLibertyProof.defenderFirst.result === 'ko-dependent'
            ? ('ko-dependent' as const)
            : ('not-proven' as const),
        remainingLiberties: reducedGroup.liberties,
        oneLibertyProof,
      }),
    );
  }

  return Object.freeze({
    algorithm: TWO_LIBERTY_TACTICAL_ALGORITHM,
    targetGroupKey,
    crucialStones,
    attackPoints,
    attackerFirst: Object.freeze({
      result: winningMoves.length > 0 ? ('forced-kill' as const) : ('unresolved' as const),
      winningMoves: Object.freeze(winningMoves),
      lines: Object.freeze(lines),
    }),
    defenderFirst: Object.freeze({
      result: 'unresolved' as const,
      reason: 'complete-defender-move-set-not-proven' as const,
    }),
    outcome: 'unresolved' as const,
    exploredNodes,
    maxDepth,
  });
};
