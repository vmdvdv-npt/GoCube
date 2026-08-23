import { GameEngine } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameGraph } from './EndgameGraphCore';
import {
  isPotentialSimpleKoCapture,
  readOneLibertyTactics,
  type OneLibertyTacticalResult,
} from './OneLibertyTacticalReader';

export const TWO_LIBERTY_TACTICAL_ALGORITHM = 'two-liberty-exhaustive-reader-v2';
export const DEFAULT_TWO_LIBERTY_DEFENDER_PLACEMENT_BUDGET = 512;

export interface TwoLibertyReductionLine {
  readonly move: PointId;
  readonly result: 'forced-kill' | 'ko-dependent' | 'not-proven' | 'illegal';
  readonly remainingLiberties?: readonly PointId[];
  readonly rejectionReason?: string;
  readonly oneLibertyProof?: OneLibertyTacticalResult;
}

export interface TwoLibertyAttackerFirstResult {
  readonly result: 'forced-kill' | 'unresolved';
  readonly winningMoves: readonly PointId[];
  readonly lines: readonly TwoLibertyReductionLine[];
  readonly hasKoDependency: boolean;
}

export type TwoLibertyDefenderMove =
  | Readonly<{ readonly kind: 'pass' }>
  | Readonly<{ readonly kind: 'place'; readonly point: PointId }>;

export interface TwoLibertyDefenderLine {
  readonly move: TwoLibertyDefenderMove;
  readonly result: 'forced-kill' | 'not-proven' | 'ko-dependent';
  readonly targetLibertiesAfter?: readonly PointId[];
}

export interface TwoLibertyDefenderFirstResult {
  readonly result: 'forced-kill' | 'unresolved' | 'ko-dependent' | 'budget-exhausted';
  readonly lines: readonly TwoLibertyDefenderLine[];
  readonly examinedPlacements: number;
  readonly legalPlacements: number;
  readonly includesPass: true;
  readonly placementBudget: number;
}

export interface TwoLibertyTacticalResult {
  readonly algorithm: typeof TWO_LIBERTY_TACTICAL_ALGORITHM;
  readonly targetGroupKey: string;
  readonly crucialStones: readonly PointId[];
  readonly attackPoints: readonly PointId[];
  readonly attackerFirst: TwoLibertyAttackerFirstResult;
  readonly defenderFirst: TwoLibertyDefenderFirstResult;
  readonly outcome: 'proven-dead' | 'ko-dependent' | 'unresolved';
  readonly exploredNodes: number;
  readonly maxDepth: number;
}

export interface TwoLibertyReadOptions {
  readonly maxDefenderPlacements?: number;
}

interface KnownHistory {
  readonly previousBoard: BoardOccupancy;
}

interface AttackerFirstEvaluation {
  readonly result: TwoLibertyAttackerFirstResult;
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

const evaluateAttackerFirst = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  targetGroupKey: string,
  history?: KnownHistory,
): AttackerFirstEvaluation => {
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.liberties.length !== 2) {
    return Object.freeze({
      result: Object.freeze({
        result: 'unresolved' as const,
        winningMoves: Object.freeze([] as PointId[]),
        lines: Object.freeze([] as TwoLibertyReductionLine[]),
        hasKoDependency: false,
      }),
      exploredNodes: 0,
      maxDepth: 0,
    });
  }

  const engine = new GameEngine(topology);
  const attacker = opponentOf(target.color);
  const crucialStones = target.points;
  const attackPoints = Object.freeze([...target.liberties].sort());
  const lines: TwoLibertyReductionLine[] = [];
  const winningMoves: PointId[] = [];
  let hasKoDependency = false;
  let exploredNodes = 0;
  let maxDepth = 1;

  for (const move of attackPoints) {
    exploredNodes += 1;
    const attack = engine.placeStone(
      asPlayingState(state, attacker),
      move,
      attacker,
      history ? Object.freeze({ previousBoard: history.previousBoard }) : undefined,
    );

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
      !history &&
      isPotentialSimpleKoCapture(
        engine,
        attack.state,
        move,
        attacker,
        attack.captured,
      )
    ) {
      hasKoDependency = true;
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

    if (oneLibertyProof.defenderFirst.result === 'ko-dependent') hasKoDependency = true;
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
    result: Object.freeze({
      result: winningMoves.length > 0 ? ('forced-kill' as const) : ('unresolved' as const),
      winningMoves: Object.freeze(winningMoves),
      lines: Object.freeze(lines),
      hasKoDependency,
    }),
    exploredNodes,
    maxDepth,
  });
};

const evaluateDefenderPosition = (
  stateAfterDefense: GameState,
  previousBoard: BoardOccupancy,
  topology: Topology,
  targetColor: StoneColor,
  crucialStones: readonly PointId[],
): Readonly<{
  result: 'forced-kill' | 'not-proven';
  targetLibertiesAfter?: readonly PointId[];
  exploredNodes: number;
  maxDepth: number;
}> => {
  const graph = buildEndgameGraph(stateAfterDefense, topology);
  const targetGroupKey = survivingGroupKey(
    stateAfterDefense,
    graph,
    targetColor,
    crucialStones,
  );
  if (!targetGroupKey) {
    return Object.freeze({ result: 'not-proven', exploredNodes: 0, maxDepth: 0 });
  }

  const target = graph.groups.get(targetGroupKey)!;
  const targetLibertiesAfter = target.liberties;

  if (target.liberties.length === 1) {
    const proof = readOneLibertyTactics(
      stateAfterDefense,
      topology,
      graph,
      target.key,
      Object.freeze({ previousBoard }),
    );
    return Object.freeze({
      result: proof?.attackerFirst.result === 'kill' ? ('forced-kill' as const) : ('not-proven' as const),
      targetLibertiesAfter,
      exploredNodes: proof?.exploredNodes ?? 0,
      maxDepth: proof?.maxDepth ?? 0,
    });
  }

  if (target.liberties.length === 2) {
    const attack = evaluateAttackerFirst(
      stateAfterDefense,
      topology,
      graph,
      target.key,
      Object.freeze({ previousBoard }),
    );
    return Object.freeze({
      result: attack.result.result === 'forced-kill' ? ('forced-kill' as const) : ('not-proven' as const),
      targetLibertiesAfter,
      exploredNodes: attack.exploredNodes,
      maxDepth: attack.maxDepth,
    });
  }

  return Object.freeze({
    result: 'not-proven' as const,
    targetLibertiesAfter,
    exploredNodes: 0,
    maxDepth: 0,
  });
};

/**
 * Exact-by-enumeration defender-first baseline for a target with two liberties.
 *
 * Attacker-first remains a specialised reduction: try the two current
 * liberties and accept a winning move only when it reaches the strict
 * one-liberty proof.
 *
 * Defender-first does NOT assume locality. It enumerates every empty logical
 * point on the whole Topology, filters through authoritative GameEngine
 * legality, and also includes Pass. Therefore, when the placement budget is
 * not exceeded, the defender move set is complete by construction. Relevance
 * zones may later prune this baseline only after their irrelevance proof is
 * established.
 *
 * Unknown root simple-ko history remains conservative: a structurally possible
 * ko recapture branch prevents a forced-kill proof.
 */
export const readTwoLibertyTactics = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  targetGroupKey: string,
  options: TwoLibertyReadOptions = Object.freeze({}),
): TwoLibertyTacticalResult | null => {
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.liberties.length !== 2) return null;

  const placementBudget =
    options.maxDefenderPlacements ?? DEFAULT_TWO_LIBERTY_DEFENDER_PLACEMENT_BUDGET;
  const attackerEvaluation = evaluateAttackerFirst(state, topology, graph, targetGroupKey);
  const emptyPoints = [...topology.points()]
    .filter((point) => state.board[point] === 'empty')
    .sort();

  let exploredNodes = attackerEvaluation.exploredNodes;
  let maxDepth = attackerEvaluation.maxDepth;
  const defenderLines: TwoLibertyDefenderLine[] = [];

  if (emptyPoints.length > placementBudget) {
    return Object.freeze({
      algorithm: TWO_LIBERTY_TACTICAL_ALGORITHM,
      targetGroupKey,
      crucialStones: target.points,
      attackPoints: target.liberties,
      attackerFirst: attackerEvaluation.result,
      defenderFirst: Object.freeze({
        result: 'budget-exhausted' as const,
        lines: Object.freeze(defenderLines),
        examinedPlacements: 0,
        legalPlacements: 0,
        includesPass: true as const,
        placementBudget,
      }),
      outcome:
        attackerEvaluation.result.hasKoDependency
          ? ('ko-dependent' as const)
          : ('unresolved' as const),
      exploredNodes,
      maxDepth,
    });
  }

  const defender = target.color;
  const engine = new GameEngine(topology);
  let legalPlacements = 0;
  let hasNotProvenBranch = false;
  let hasKoDependency = false;

  // Pass is a real defender-first branch. After pass, the previous board for
  // the attack is the same occupancy, so simple-ko legality is exactly known.
  const passEvaluation = evaluateDefenderPosition(
    asPlayingState(state, opponentOf(defender)),
    state.board,
    topology,
    target.color,
    target.points,
  );
  exploredNodes += passEvaluation.exploredNodes;
  maxDepth = Math.max(maxDepth, 1 + passEvaluation.maxDepth);
  if (passEvaluation.result !== 'forced-kill') hasNotProvenBranch = true;
  defenderLines.push(
    Object.freeze({
      move: Object.freeze({ kind: 'pass' as const }),
      result: passEvaluation.result,
      ...(passEvaluation.targetLibertiesAfter
        ? { targetLibertiesAfter: passEvaluation.targetLibertiesAfter }
        : {}),
    }),
  );

  for (const point of emptyPoints) {
    exploredNodes += 1;
    const defense = engine.placeStone(asPlayingState(state, defender), point, defender);
    if (!defense.ok) continue;

    if (
      isPotentialSimpleKoCapture(
        engine,
        defense.state,
        point,
        defender,
        defense.captured,
      )
    ) {
      hasKoDependency = true;
      defenderLines.push(
        Object.freeze({
          move: Object.freeze({ kind: 'place' as const, point }),
          result: 'ko-dependent' as const,
        }),
      );
      continue;
    }

    legalPlacements += 1;
    const branch = evaluateDefenderPosition(
      defense.state,
      state.board,
      topology,
      target.color,
      target.points,
    );
    exploredNodes += branch.exploredNodes;
    maxDepth = Math.max(maxDepth, 1 + branch.maxDepth);
    if (branch.result !== 'forced-kill') hasNotProvenBranch = true;

    defenderLines.push(
      Object.freeze({
        move: Object.freeze({ kind: 'place' as const, point }),
        result: branch.result,
        ...(branch.targetLibertiesAfter
          ? { targetLibertiesAfter: branch.targetLibertiesAfter }
          : {}),
      }),
    );
  }

  const defenderFirstResult = hasNotProvenBranch
    ? ('unresolved' as const)
    : hasKoDependency
      ? ('ko-dependent' as const)
      : ('forced-kill' as const);

  const outcome =
    attackerEvaluation.result.result === 'forced-kill' && defenderFirstResult === 'forced-kill'
      ? ('proven-dead' as const)
      : attackerEvaluation.result.hasKoDependency || defenderFirstResult === 'ko-dependent'
        ? ('ko-dependent' as const)
        : ('unresolved' as const);

  return Object.freeze({
    algorithm: TWO_LIBERTY_TACTICAL_ALGORITHM,
    targetGroupKey,
    crucialStones: target.points,
    attackPoints: target.liberties,
    attackerFirst: attackerEvaluation.result,
    defenderFirst: Object.freeze({
      result: defenderFirstResult,
      lines: Object.freeze(defenderLines),
      examinedPlacements: emptyPoints.length,
      legalPlacements,
      includesPass: true as const,
      placementBudget,
    }),
    outcome,
    exploredNodes,
    maxDepth,
  });
};
