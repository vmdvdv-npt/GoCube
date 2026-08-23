import { GameEngine } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameGraph } from './EndgameGraphCore';
import {
  buildTwoLibertyDefenderRelevance,
  type TwoLibertyDefenderRelevance,
} from './TwoLibertyDefenderRelevance';
import {
  isPotentialSimpleKoCapture,
  readOneLibertyTactics,
} from './OneLibertyTacticalReader';
import {
  DEFAULT_TWO_LIBERTY_DEFENDER_PLACEMENT_BUDGET,
  readTwoLibertyTactics,
  type TwoLibertyAttackerFirstResult,
  type TwoLibertyDefenderMove,
} from './TwoLibertyTacticalReader';

export const TWO_LIBERTY_PRUNED_TACTICAL_ALGORITHM =
  'two-liberty-proof-pruned-reader-v1';
export const TWO_LIBERTY_IRRELEVANCE_CERTIFICATE =
  'outside-six-wave-string-closed-causal-cone';

export interface TwoLibertyPrunedDefenderLine {
  readonly move: TwoLibertyDefenderMove;
  readonly result: 'forced-kill' | 'not-proven' | 'ko-dependent';
  readonly evaluation: 'pass' | 'deep' | 'root-ko' | 'certified-irrelevant';
  readonly targetLibertiesAfter?: readonly PointId[];
  readonly irrelevanceCertificate?: typeof TWO_LIBERTY_IRRELEVANCE_CERTIFICATE;
}

export interface TwoLibertyPrunedDefenderFirstResult {
  readonly result: 'forced-kill' | 'unresolved' | 'ko-dependent' | 'budget-exhausted';
  readonly lines: readonly TwoLibertyPrunedDefenderLine[];
  readonly examinedPlacements: number;
  readonly legalPlacements: number;
  readonly deepEvaluatedPlacements: number;
  readonly certifiedIrrelevantPlacements: number;
  readonly includesPass: true;
  readonly placementBudget: number;
}

export interface TwoLibertyPruningSummary {
  readonly relevance: TwoLibertyDefenderRelevance;
  readonly deepEvaluatedPoints: readonly PointId[];
  readonly certifiedIrrelevantPoints: readonly PointId[];
}

export interface TwoLibertyPrunedTacticalResult {
  readonly algorithm: typeof TWO_LIBERTY_PRUNED_TACTICAL_ALGORITHM;
  readonly targetGroupKey: string;
  readonly crucialStones: readonly PointId[];
  readonly attackPoints: readonly PointId[];
  readonly attackerFirst: TwoLibertyAttackerFirstResult;
  readonly defenderFirst: TwoLibertyPrunedDefenderFirstResult;
  readonly pruning: TwoLibertyPruningSummary;
  readonly outcome: 'proven-dead' | 'ko-dependent' | 'unresolved';
  readonly exploredNodes: number;
  readonly maxDepth: number;
}

export interface TwoLibertyPrunedReadOptions {
  readonly maxRelevantDefenderPlacements?: number;
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

const survivingGroupKey = (
  state: GameState,
  graph: EndgameGraph,
  targetColor: StoneColor,
  crucialStones: readonly PointId[],
): string | null => {
  const survivingPoint = crucialStones.find((point) => state.board[point] === targetColor);
  return survivingPoint ? graph.pointOwner.get(survivingPoint) ?? null : null;
};

const readTwoLibertyAttackerOnly = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  targetGroupKey: string,
) =>
  readTwoLibertyTactics(
    state,
    topology,
    graph,
    targetGroupKey,
    Object.freeze({ maxDefenderPlacements: 0 }),
  );

const evaluateDefenderPositionConservatively = (
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
      result:
        proof?.attackerFirst.result === 'kill'
          ? ('forced-kill' as const)
          : ('not-proven' as const),
      targetLibertiesAfter,
      exploredNodes: proof?.exploredNodes ?? 0,
      maxDepth: proof?.maxDepth ?? 0,
    });
  }

  if (target.liberties.length === 2) {
    // Reuse the exhaustive reader's attacker-first implementation while
    // forcing its defender enumeration to stop immediately. This nested call
    // intentionally retains the root-ko guard rather than guessing unknown
    // history; the result can therefore lose coverage but cannot create a
    // false forced-kill relative to the exhaustive oracle.
    const attackOnly = readTwoLibertyAttackerOnly(
      stateAfterDefense,
      topology,
      graph,
      target.key,
    );
    return Object.freeze({
      result:
        attackOnly?.attackerFirst.result === 'forced-kill'
          ? ('forced-kill' as const)
          : ('not-proven' as const),
      targetLibertiesAfter,
      exploredNodes: attackOnly?.exploredNodes ?? 0,
      maxDepth: attackOnly?.maxDepth ?? 0,
    });
  }

  return Object.freeze({
    result: 'not-proven' as const,
    targetLibertiesAfter,
    exploredNodes: 0,
    maxDepth: 0,
  });
};

const frozenEmptySummary = (
  relevance: TwoLibertyDefenderRelevance,
): TwoLibertyPruningSummary =>
  Object.freeze({
    relevance,
    deepEvaluatedPoints: Object.freeze([] as PointId[]),
    certifiedIrrelevantPoints: Object.freeze([] as PointId[]),
  });

/**
 * Proof-pruned defender-first reader for an exact two-liberty target.
 *
 * The exhaustive v2 reader remains the correctness oracle and is unchanged.
 * This path scans every empty root placement through authoritative GameEngine
 * legality and root-ko detection. Only the deeper bounded tactical
 * continuation is skipped for legal non-ko placements carrying the explicit
 * `outside-six-wave-string-closed-causal-cone` certificate.
 *
 * Certified-irrelevant moves are used for a kill proof only when Pass itself
 * is proven losing. A remote root move outside the cone cannot improve the
 * bounded local defense; remote board differences may only relax first-reply
 * simple-ko equality, which can help the attacker. If Pass is not proven
 * losing, every certified branch remains conservatively `not-proven`.
 */
export const readTwoLibertyTacticsPruned = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  targetGroupKey: string,
  options: TwoLibertyPrunedReadOptions = Object.freeze({}),
): TwoLibertyPrunedTacticalResult | null => {
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.liberties.length !== 2) return null;

  const relevance = buildTwoLibertyDefenderRelevance(topology, graph, targetGroupKey);
  if (!relevance) return null;

  const placementBudget =
    options.maxRelevantDefenderPlacements ??
    DEFAULT_TWO_LIBERTY_DEFENDER_PLACEMENT_BUDGET;
  const attackerOnly = readTwoLibertyAttackerOnly(
    state,
    topology,
    graph,
    targetGroupKey,
  );
  if (!attackerOnly) return null;

  const emptyPoints = [...topology.points()]
    .filter((point) => state.board[point] === 'empty')
    .sort();
  const relevantSet = new Set(relevance.relevantRootPlacements);
  const relevantEmptyPoints = emptyPoints.filter((point) => relevantSet.has(point));

  let exploredNodes = attackerOnly.exploredNodes;
  let maxDepth = attackerOnly.maxDepth;
  const defenderLines: TwoLibertyPrunedDefenderLine[] = [];

  if (relevantEmptyPoints.length > placementBudget) {
    return Object.freeze({
      algorithm: TWO_LIBERTY_PRUNED_TACTICAL_ALGORITHM,
      targetGroupKey,
      crucialStones: target.points,
      attackPoints: target.liberties,
      attackerFirst: attackerOnly.attackerFirst,
      defenderFirst: Object.freeze({
        result: 'budget-exhausted' as const,
        lines: Object.freeze(defenderLines),
        examinedPlacements: 0,
        legalPlacements: 0,
        deepEvaluatedPlacements: 0,
        certifiedIrrelevantPlacements: 0,
        includesPass: true as const,
        placementBudget,
      }),
      pruning: frozenEmptySummary(relevance),
      outcome:
        attackerOnly.attackerFirst.hasKoDependency
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
  const deepEvaluatedPoints: PointId[] = [];
  const certifiedIrrelevantPoints: PointId[] = [];

  const passEvaluation = evaluateDefenderPositionConservatively(
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
      evaluation: 'pass' as const,
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
          evaluation: 'root-ko' as const,
        }),
      );
      continue;
    }

    legalPlacements += 1;

    if (!relevantSet.has(point)) {
      certifiedIrrelevantPoints.push(point);
      const certifiedResult =
        passEvaluation.result === 'forced-kill'
          ? ('forced-kill' as const)
          : ('not-proven' as const);
      if (certifiedResult !== 'forced-kill') hasNotProvenBranch = true;
      defenderLines.push(
        Object.freeze({
          move: Object.freeze({ kind: 'place' as const, point }),
          result: certifiedResult,
          evaluation: 'certified-irrelevant' as const,
          irrelevanceCertificate: TWO_LIBERTY_IRRELEVANCE_CERTIFICATE,
        }),
      );
      continue;
    }

    deepEvaluatedPoints.push(point);
    const branch = evaluateDefenderPositionConservatively(
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
        evaluation: 'deep' as const,
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
    attackerOnly.attackerFirst.result === 'forced-kill' &&
    defenderFirstResult === 'forced-kill'
      ? ('proven-dead' as const)
      : attackerOnly.attackerFirst.hasKoDependency ||
          defenderFirstResult === 'ko-dependent'
        ? ('ko-dependent' as const)
        : ('unresolved' as const);

  return Object.freeze({
    algorithm: TWO_LIBERTY_PRUNED_TACTICAL_ALGORITHM,
    targetGroupKey,
    crucialStones: target.points,
    attackPoints: target.liberties,
    attackerFirst: attackerOnly.attackerFirst,
    defenderFirst: Object.freeze({
      result: defenderFirstResult,
      lines: Object.freeze(defenderLines),
      examinedPlacements: emptyPoints.length,
      legalPlacements,
      deepEvaluatedPlacements: deepEvaluatedPoints.length,
      certifiedIrrelevantPlacements: certifiedIrrelevantPoints.length,
      includesPass: true as const,
      placementBudget,
    }),
    pruning: Object.freeze({
      relevance,
      deepEvaluatedPoints: Object.freeze(deepEvaluatedPoints),
      certifiedIrrelevantPoints: Object.freeze(certifiedIrrelevantPoints),
    }),
    outcome,
    exploredNodes,
    maxDepth,
  });
};
