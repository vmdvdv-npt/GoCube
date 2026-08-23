import { GameEngine } from '../game/GameEngine';
import type { GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import type { EndgameGraph, EndgameStoneString } from './EndgameGraphCore';

export const ONE_LIBERTY_TACTICAL_ALGORITHM = 'one-liberty-tactical-reader-v1';

export type OneLibertyOutcome =
  | 'proven-dead'
  | 'critical'
  | 'ko-dependent'
  | 'unresolved';

export type DefenseReason = 'extend' | 'connect' | 'counter-capture';

export interface OneLibertyAttackLine {
  readonly move: PointId;
  readonly result: 'kill' | 'ko-dependent' | 'unresolved';
  readonly rejectionReason?: string;
}

export interface OneLibertyDefenseLine {
  readonly move: PointId;
  readonly reasons: readonly DefenseReason[];
  readonly result:
    | 'illegal'
    | 'immediately-killed'
    | 'escapes-immediate-capture'
    | 'ko-dependent';
  readonly attackerReply?: PointId;
  readonly rejectionReason?: string;
}

export interface OneLibertyTacticalResult {
  readonly algorithm: typeof ONE_LIBERTY_TACTICAL_ALGORITHM;
  readonly targetGroupKey: string;
  readonly crucialStones: readonly PointId[];
  readonly attackPoints: readonly PointId[];
  readonly defensePoints: readonly PointId[];
  readonly attackerFirst: OneLibertyAttackLine;
  readonly defenderFirst: Readonly<{
    readonly result: 'forced-kill' | 'escape' | 'ko-dependent' | 'unresolved';
    readonly lines: readonly OneLibertyDefenseLine[];
  }>;
  readonly outcome: OneLibertyOutcome;
  readonly exploredNodes: number;
  readonly maxDepth: number;
  readonly principalVariation: readonly PointId[];
}

interface DefenseCandidate {
  readonly point: PointId;
  readonly reasons: ReadonlySet<DefenseReason>;
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

const survivingTargetGroup = (
  engine: GameEngine,
  state: GameState,
  targetColor: StoneColor,
  crucialStones: readonly PointId[],
) => {
  const survivingPoint = crucialStones.find((point) => state.board[point] === targetColor);
  return survivingPoint ? engine.groupAt(state, survivingPoint) : null;
};

/**
 * The analysis context does not currently carry the board position preceding
 * the endgame position, so first-ply simple-ko legality cannot always be known.
 * A single-stone capture that leaves the newly placed stone as a one-stone
 * group with exactly the captured point as its sole liberty is the structural
 * shape that can be an immediate ko recapture. Treat it conservatively as a ko
 * dependency instead of assuming the first move is legal.
 */
const isPotentialSimpleKoCapture = (
  engine: GameEngine,
  stateAfterMove: GameState,
  move: PointId,
  mover: StoneColor,
  captured: readonly PointId[],
): boolean => {
  if (captured.length !== 1) return false;
  const placedGroup = engine.groupAt(stateAfterMove, move);
  return (
    placedGroup !== null &&
    placedGroup.color === mover &&
    placedGroup.points.length === 1 &&
    placedGroup.liberties.length === 1 &&
    placedGroup.liberties[0] === captured[0]
  );
};

const collectDefenseCandidates = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  target: EndgameStoneString,
): readonly DefenseCandidate[] => {
  const candidates = new Map<PointId, Set<DefenseReason>>();
  const add = (point: PointId, reason: DefenseReason): void => {
    const reasons = candidates.get(point) ?? new Set<DefenseReason>();
    reasons.add(reason);
    candidates.set(point, reasons);
  };

  const liberty = target.liberties[0]!;
  add(liberty, 'extend');

  for (const neighbor of topology.neighbors(liberty)) {
    const owner = graph.pointOwner.get(neighbor);
    if (owner && owner !== target.key && graph.groups.get(owner)?.color === target.color) {
      add(liberty, 'connect');
    }
  }

  const attacker = opponentOf(target.color);
  const adjacentEnemyKeys = new Set<string>();
  for (const point of target.points) {
    for (const neighbor of topology.neighbors(point)) {
      if (state.board[neighbor] !== attacker) continue;
      const owner = graph.pointOwner.get(neighbor);
      if (owner) adjacentEnemyKeys.add(owner);
    }
  }

  for (const groupKey of adjacentEnemyKeys) {
    const enemy = graph.groups.get(groupKey);
    if (!enemy || enemy.liberties.length !== 1) continue;
    add(enemy.liberties[0]!, 'counter-capture');
  }

  return Object.freeze(
    [...candidates.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([point, reasons]) =>
        Object.freeze({ point, reasons: new Set([...reasons].sort()) }),
      ),
  );
};

/**
 * Strict tactical reader for a target string with exactly one liberty.
 *
 * For attacker-first, the only immediate capture point is the sole liberty.
 * For defender-first, every move that can prevent that immediate capture must
 * either fill the target liberty (possibly connecting) or capture an adjacent
 * enemy string in atari. Any other move leaves the sole liberty unchanged and
 * therefore cannot save the target from the next capture.
 *
 * The reader intentionally stops as soon as a legal defense reaches two or
 * more liberties. That is an escape from this short proof, not a proof of life.
 * First-ply captures with a simple-ko recapture shape are also stopped as
 * `ko-dependent` because the preceding board position is not in this context.
 */
export const readOneLibertyTactics = (
  state: GameState,
  topology: Topology,
  graph: EndgameGraph,
  targetGroupKey: string,
): OneLibertyTacticalResult | null => {
  const target = graph.groups.get(targetGroupKey);
  if (!target || target.liberties.length !== 1) return null;

  const engine = new GameEngine(topology);
  const attacker = opponentOf(target.color);
  const defender = target.color;
  const attackPoint = target.liberties[0]!;
  const crucialStones = target.points;
  let exploredNodes = 0;
  let maxDepth = 1;

  const attackerState = asPlayingState(state, attacker);
  exploredNodes += 1;
  const attackerMove = engine.placeStone(attackerState, attackPoint, attacker);
  let attackerFirst: OneLibertyAttackLine;
  if (attackerMove.ok && crucialStonesCaptured(attackerMove.state, target.color, crucialStones)) {
    attackerFirst = isPotentialSimpleKoCapture(
      engine,
      attackerMove.state,
      attackPoint,
      attacker,
      attackerMove.captured,
    )
      ? Object.freeze({ move: attackPoint, result: 'ko-dependent' as const })
      : Object.freeze({ move: attackPoint, result: 'kill' as const });
  } else {
    attackerFirst = Object.freeze({
      move: attackPoint,
      result: 'unresolved' as const,
      ...(!attackerMove.ok ? { rejectionReason: attackerMove.reason } : {}),
    });
  }

  const defenseCandidates = collectDefenseCandidates(state, topology, graph, target);
  const defenseLines: OneLibertyDefenseLine[] = [];
  let legalDefenseCount = 0;
  let escapeFound = false;
  let koDependent = false;

  for (const candidate of defenseCandidates) {
    const defenderState = asPlayingState(state, defender);
    exploredNodes += 1;
    const defenseMove = engine.placeStone(defenderState, candidate.point, defender);
    const reasons = Object.freeze([...candidate.reasons].sort()) as readonly DefenseReason[];

    if (!defenseMove.ok) {
      defenseLines.push(
        Object.freeze({
          move: candidate.point,
          reasons,
          result: 'illegal' as const,
          rejectionReason: defenseMove.reason,
        }),
      );
      continue;
    }

    if (
      isPotentialSimpleKoCapture(
        engine,
        defenseMove.state,
        candidate.point,
        defender,
        defenseMove.captured,
      )
    ) {
      koDependent = true;
      defenseLines.push(
        Object.freeze({
          move: candidate.point,
          reasons,
          result: 'ko-dependent' as const,
        }),
      );
      continue;
    }

    legalDefenseCount += 1;
    const defendedTarget = survivingTargetGroup(
      engine,
      defenseMove.state,
      target.color,
      crucialStones,
    );

    if (!defendedTarget || defendedTarget.liberties.length !== 1) {
      escapeFound = true;
      defenseLines.push(
        Object.freeze({
          move: candidate.point,
          reasons,
          result: 'escapes-immediate-capture' as const,
        }),
      );
      continue;
    }

    const attackerReply = defendedTarget.liberties[0]!;
    maxDepth = 2;
    exploredNodes += 1;
    const reply = engine.placeStone(
      defenseMove.state,
      attackerReply,
      attacker,
      Object.freeze({ previousBoard: state.board }),
    );

    if (!reply.ok && reply.reason === 'repetition') {
      koDependent = true;
      defenseLines.push(
        Object.freeze({
          move: candidate.point,
          reasons,
          result: 'ko-dependent' as const,
          attackerReply,
          rejectionReason: reply.reason,
        }),
      );
      continue;
    }

    if (reply.ok && crucialStonesCaptured(reply.state, target.color, crucialStones)) {
      defenseLines.push(
        Object.freeze({
          move: candidate.point,
          reasons,
          result: 'immediately-killed' as const,
          attackerReply,
        }),
      );
      continue;
    }

    escapeFound = true;
    defenseLines.push(
      Object.freeze({
        move: candidate.point,
        reasons,
        result: 'escapes-immediate-capture' as const,
        attackerReply,
        ...(!reply.ok ? { rejectionReason: reply.reason } : {}),
      }),
    );
  }

  const defenderFirstResult = escapeFound
    ? 'escape'
    : koDependent
      ? 'ko-dependent'
      : legalDefenseCount === 0 || defenseLines.every((line) => line.result !== 'escapes-immediate-capture')
        ? 'forced-kill'
        : 'unresolved';

  const outcome: OneLibertyOutcome =
    attackerFirst.result === 'ko-dependent'
      ? 'ko-dependent'
      : attackerFirst.result !== 'kill'
        ? 'unresolved'
        : defenderFirstResult === 'forced-kill'
          ? 'proven-dead'
          : defenderFirstResult === 'ko-dependent'
            ? 'ko-dependent'
            : defenderFirstResult === 'escape'
              ? 'critical'
              : 'unresolved';

  const principalVariation =
    outcome === 'proven-dead'
      ? Object.freeze([attackPoint])
      : Object.freeze([] as PointId[]);

  return Object.freeze({
    algorithm: ONE_LIBERTY_TACTICAL_ALGORITHM,
    targetGroupKey,
    crucialStones,
    attackPoints: Object.freeze([attackPoint]),
    defensePoints: Object.freeze(defenseCandidates.map((candidate) => candidate.point)),
    attackerFirst,
    defenderFirst: Object.freeze({
      result: defenderFirstResult,
      lines: Object.freeze(defenseLines),
    }),
    outcome,
    exploredNodes,
    maxDepth,
    principalVariation,
  });
};
