import { GameEngine, type StoneGroup } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';

export const SIMPLE_SEMEAI_ALGORITHM = 'simple-semeai-v1';

export type SimpleSemeaiOutcome =
  | 'left-wins'
  | 'right-wins'
  | 'first-player-dependent'
  | 'ko-dependent'
  | 'unresolved';

export type SimpleSemeaiReason =
  | 'stale-group'
  | 'same-color'
  | 'not-interacting'
  | 'shared-liberties-deferred'
  | 'multi-group-interaction'
  | 'too-many-liberties'
  | 'capture-not-simple';

export interface SimpleSemeaiOptions {
  /**
   * Work 7A intentionally keeps the all-orders capture certificate small.
   * Larger races are deferred to the bounded search work in 7B/7D.
   */
  readonly maxExclusiveLiberties?: number;
}

export interface SimpleSemeaiLibertyCounts {
  readonly leftExclusive: readonly PointId[];
  readonly rightExclusive: readonly PointId[];
  readonly shared: readonly PointId[];
}

export interface SimpleCaptureCertificate {
  readonly proof: 'all-exclusive-liberty-orders-capture-cleanly';
  readonly attackerColor: StoneColor;
  readonly targetGroupKey: string;
  readonly turns: number;
  readonly canonicalSequence: readonly PointId[];
}

export interface SimpleSemeaiFirstOrderResult {
  readonly firstPlayer: 'left' | 'right';
  readonly outcome: 'left-wins' | 'right-wins';
  readonly winner: StoneColor;
  readonly leftCapturePly: number;
  readonly rightCapturePly: number;
}

export interface SimpleSemeaiResult {
  readonly algorithm: typeof SIMPLE_SEMEAI_ALGORITHM;
  readonly outcome: SimpleSemeaiOutcome;
  readonly reason: SimpleSemeaiReason | null;
  readonly leftGroupKey: string;
  readonly rightGroupKey: string;
  readonly leftColor: StoneColor;
  readonly rightColor: StoneColor;
  readonly liberties: SimpleSemeaiLibertyCounts;
  readonly leftCapture: SimpleCaptureCertificate | null;
  readonly rightCapture: SimpleCaptureCertificate | null;
  readonly leftFirst: SimpleSemeaiFirstOrderResult | null;
  readonly rightFirst: SimpleSemeaiFirstOrderResult | null;
}

const DEFAULT_MAX_EXCLUSIVE_LIBERTIES = 5;

const comparePoints = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedPoints = (points: Iterable<PointId>): readonly PointId[] =>
  Object.freeze([...points].sort(comparePoints));

const samePoints = (left: readonly PointId[], right: readonly PointId[]): boolean =>
  left.length === right.length && left.every((point, index) => point === right[index]);

const freezeSearchState = (state: GameState, currentPlayer: StoneColor): GameState =>
  Object.freeze({
    board: state.board,
    currentPlayer,
    moveNumber: state.moveNumber,
    consecutivePasses: 0,
    phase: 'playing' as const,
    captures: state.captures,
  });

const pairMatches = (
  groups: readonly [string, string],
  leftKey: string,
  rightKey: string,
): boolean =>
  (groups[0] === leftKey && groups[1] === rightKey) ||
  (groups[0] === rightKey && groups[1] === leftKey);

const currentGroupMatches = (
  supplied: EndgameStoneString,
  current: EndgameStoneString | undefined,
): current is EndgameStoneString =>
  current !== undefined &&
  current.color === supplied.color &&
  samePoints(sortedPoints(current.points), sortedPoints(supplied.points));

const thirdGroupTouchesRace = (
  left: EndgameStoneString,
  right: EndgameStoneString,
  state: GameState,
  topology: Topology,
  stringByPoint: ReadonlyMap<PointId, string>,
): boolean => {
  const pairKeys = new Set([left.key, right.key]);
  const inspect = (point: PointId): boolean => {
    for (const neighbor of topology.neighbors(point)) {
      if (state.board[neighbor] === 'empty') continue;
      const owner = stringByPoint.get(neighbor);
      if (owner && !pairKeys.has(owner)) return true;
    }
    return false;
  };

  return [...left.points, ...right.points, ...left.liberties, ...right.liberties].some(inspect);
};

const exclusiveFrontiersTouch = (
  leftExclusive: readonly PointId[],
  rightExclusive: readonly PointId[],
  topology: Topology,
): boolean => {
  const right = new Set(rightExclusive);
  return leftExclusive.some((point) => topology.neighbors(point).some((neighbor) => right.has(neighbor)));
};

const targetGroupAt = (
  engine: GameEngine,
  state: GameState,
  target: EndgameStoneString,
): StoneGroup | null => {
  const surviving = target.points.find((point) => state.board[point] === target.color);
  return surviving ? engine.groupAt(state, surviving) : null;
};

const terminalCaptureDependsOnKo = (
  engine: GameEngine,
  topology: Topology,
  targetColor: StoneColor,
  beforeCapture: GameState,
  afterCapture: GameState,
): boolean => {
  for (const point of sortedPoints(topology.points())) {
    if (afterCapture.board[point] !== 'empty') continue;
    const recapture = engine.placeStone(
      freezeSearchState(afterCapture, targetColor),
      point,
      targetColor,
      { previousBoard: beforeCapture.board },
    );
    if (!recapture.ok && recapture.reason === 'repetition') return true;
  }
  return false;
};

type CaptureCheck =
  | Readonly<{ readonly kind: 'simple'; readonly certificate: SimpleCaptureCertificate }>
  | Readonly<{ readonly kind: 'ko' }>
  | Readonly<{ readonly kind: 'too-large' }>
  | Readonly<{ readonly kind: 'not-simple' }>;

interface CaptureRuntime {
  readonly engine: GameEngine;
  readonly topology: Topology;
  readonly attacker: EndgameStoneString;
  readonly target: EndgameStoneString;
  readonly attackerPoints: readonly PointId[];
  readonly targetPoints: readonly PointId[];
}

const capturedExactlyTarget = (
  captured: readonly PointId[],
  targetPoints: readonly PointId[],
): boolean => samePoints(sortedPoints(captured), targetPoints);

const validateAllCaptureOrders = (
  runtime: CaptureRuntime,
  state: GameState,
  previousBoard: BoardOccupancy | null,
  remaining: readonly PointId[],
): 'simple' | 'ko' | 'not-simple' => {
  for (const move of remaining) {
    const before = freezeSearchState(state, runtime.attacker.color);
    const placed = runtime.engine.placeStone(before, move, runtime.attacker.color, {
      previousBoard,
    });
    if (!placed.ok) return 'not-simple';

    const nextRemaining = Object.freeze(remaining.filter((point) => point !== move));
    const targetAfter = targetGroupAt(runtime.engine, placed.state, runtime.target);

    if (targetAfter === null) {
      if (nextRemaining.length !== 0) return 'not-simple';
      if (!capturedExactlyTarget(placed.captured, runtime.targetPoints)) return 'not-simple';
      if (
        terminalCaptureDependsOnKo(
          runtime.engine,
          runtime.topology,
          runtime.target.color,
          before,
          placed.state,
        )
      ) {
        return 'ko';
      }
      continue;
    }

    if (placed.captured.length !== 0) return 'not-simple';
    if (!samePoints(sortedPoints(targetAfter.points), runtime.targetPoints)) return 'not-simple';
    if (!samePoints(sortedPoints(targetAfter.liberties), nextRemaining)) return 'not-simple';

    const attackerAfter = runtime.engine.groupAt(placed.state, runtime.attackerPoints[0]!);
    if (!attackerAfter) return 'not-simple';
    if (!samePoints(sortedPoints(attackerAfter.points), runtime.attackerPoints)) return 'not-simple';

    const child = validateAllCaptureOrders(
      runtime,
      placed.state,
      before.board,
      nextRemaining,
    );
    if (child !== 'simple') return child;
  }

  return 'simple';
};

const verifySimpleCaptureCountdown = (
  attacker: EndgameStoneString,
  target: EndgameStoneString,
  state: GameState,
  topology: Topology,
  maxExclusiveLiberties: number,
): CaptureCheck => {
  const targetLiberties = sortedPoints(target.liberties);
  if (targetLiberties.length === 0) return Object.freeze({ kind: 'not-simple' as const });
  if (targetLiberties.length > maxExclusiveLiberties) {
    return Object.freeze({ kind: 'too-large' as const });
  }

  const runtime: CaptureRuntime = Object.freeze({
    engine: new GameEngine(topology),
    topology,
    attacker,
    target,
    attackerPoints: sortedPoints(attacker.points),
    targetPoints: sortedPoints(target.points),
  });
  const verdict = validateAllCaptureOrders(runtime, state, null, targetLiberties);
  if (verdict === 'ko') return Object.freeze({ kind: 'ko' as const });
  if (verdict !== 'simple') return Object.freeze({ kind: 'not-simple' as const });

  return Object.freeze({
    kind: 'simple' as const,
    certificate: Object.freeze({
      proof: 'all-exclusive-liberty-orders-capture-cleanly' as const,
      attackerColor: attacker.color,
      targetGroupKey: target.key,
      turns: targetLiberties.length,
      canonicalSequence: targetLiberties,
    }),
  });
};

const firstOrderResult = (
  firstPlayer: 'left' | 'right',
  leftColor: StoneColor,
  rightColor: StoneColor,
  leftTurnsToCaptureRight: number,
  rightTurnsToCaptureLeft: number,
): SimpleSemeaiFirstOrderResult => {
  const leftCapturePly =
    firstPlayer === 'left'
      ? leftTurnsToCaptureRight * 2 - 1
      : leftTurnsToCaptureRight * 2;
  const rightCapturePly =
    firstPlayer === 'right'
      ? rightTurnsToCaptureLeft * 2 - 1
      : rightTurnsToCaptureLeft * 2;
  const leftWins = leftCapturePly < rightCapturePly;

  return Object.freeze({
    firstPlayer,
    outcome: leftWins ? ('left-wins' as const) : ('right-wins' as const),
    winner: leftWins ? leftColor : rightColor,
    leftCapturePly,
    rightCapturePly,
  });
};

const unresolvedResult = (
  left: EndgameStoneString,
  right: EndgameStoneString,
  liberties: SimpleSemeaiLibertyCounts,
  reason: SimpleSemeaiReason,
  outcome: 'unresolved' | 'ko-dependent' = 'unresolved',
): SimpleSemeaiResult =>
  Object.freeze({
    algorithm: SIMPLE_SEMEAI_ALGORITHM,
    outcome,
    reason,
    leftGroupKey: left.key,
    rightGroupKey: right.key,
    leftColor: left.color,
    rightColor: right.color,
    liberties,
    leftCapture: null,
    rightCapture: null,
    leftFirst: null,
    rightFirst: null,
  });

/**
 * Work 7A: conservative static proof for a two-group capturing race.
 *
 * Shared-liberty play, third-group interactions, ko and larger/branchier races are
 * deliberately not solved here. 7A proves only independent exclusive-liberty
 * countdowns whose every attack-point ordering has the same clean authoritative
 * GameEngine result. The returned first-player facts are not wired into the
 * production classifier; that integration remains Work 7D.
 */
export const analyzeSimpleSemeai = (
  suppliedLeft: EndgameStoneString,
  suppliedRight: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: SimpleSemeaiOptions = {},
): SimpleSemeaiResult => {
  const graph = buildEndgameGraph(state.board, topology);
  const currentLeft = graph.stringsByKey.get(suppliedLeft.key);
  const currentRight = graph.stringsByKey.get(suppliedRight.key);

  const fallbackShared = sortedPoints(
    suppliedLeft.liberties.filter((point) => suppliedRight.liberties.includes(point)),
  );
  const fallbackLiberties: SimpleSemeaiLibertyCounts = Object.freeze({
    leftExclusive: sortedPoints(
      suppliedLeft.liberties.filter((point) => !fallbackShared.includes(point)),
    ),
    rightExclusive: sortedPoints(
      suppliedRight.liberties.filter((point) => !fallbackShared.includes(point)),
    ),
    shared: fallbackShared,
  });

  if (
    !currentGroupMatches(suppliedLeft, currentLeft) ||
    !currentGroupMatches(suppliedRight, currentRight)
  ) {
    return unresolvedResult(suppliedLeft, suppliedRight, fallbackLiberties, 'stale-group');
  }

  const sharedSet = new Set(
    currentLeft.liberties.filter((point) => currentRight.liberties.includes(point)),
  );
  const liberties: SimpleSemeaiLibertyCounts = Object.freeze({
    leftExclusive: sortedPoints(currentLeft.liberties.filter((point) => !sharedSet.has(point))),
    rightExclusive: sortedPoints(currentRight.liberties.filter((point) => !sharedSet.has(point))),
    shared: sortedPoints(sharedSet),
  });

  if (currentLeft.color === currentRight.color) {
    return unresolvedResult(currentLeft, currentRight, liberties, 'same-color');
  }

  const directlyAdjacent = graph.opponentAdjacencies.some((entry) =>
    pairMatches(entry.groups, currentLeft.key, currentRight.key),
  );
  const sharesLiberty = graph.sharedLiberties.some((entry) =>
    pairMatches(entry.groups, currentLeft.key, currentRight.key),
  );
  if (!directlyAdjacent && !sharesLiberty) {
    return unresolvedResult(currentLeft, currentRight, liberties, 'not-interacting');
  }

  if (liberties.shared.length > 0) {
    return unresolvedResult(currentLeft, currentRight, liberties, 'shared-liberties-deferred');
  }

  if (
    thirdGroupTouchesRace(
      currentLeft,
      currentRight,
      state,
      topology,
      graph.stringByPoint,
    ) ||
    exclusiveFrontiersTouch(liberties.leftExclusive, liberties.rightExclusive, topology)
  ) {
    return unresolvedResult(currentLeft, currentRight, liberties, 'multi-group-interaction');
  }

  const maxExclusiveLiberties =
    options.maxExclusiveLiberties ?? DEFAULT_MAX_EXCLUSIVE_LIBERTIES;
  const leftCapture = verifySimpleCaptureCountdown(
    currentLeft,
    currentRight,
    state,
    topology,
    maxExclusiveLiberties,
  );
  const rightCapture = verifySimpleCaptureCountdown(
    currentRight,
    currentLeft,
    state,
    topology,
    maxExclusiveLiberties,
  );

  if (leftCapture.kind === 'ko' || rightCapture.kind === 'ko') {
    return unresolvedResult(
      currentLeft,
      currentRight,
      liberties,
      'capture-not-simple',
      'ko-dependent',
    );
  }
  if (leftCapture.kind === 'too-large' || rightCapture.kind === 'too-large') {
    return unresolvedResult(currentLeft, currentRight, liberties, 'too-many-liberties');
  }
  if (leftCapture.kind !== 'simple' || rightCapture.kind !== 'simple') {
    return unresolvedResult(currentLeft, currentRight, liberties, 'capture-not-simple');
  }

  const leftFirst = firstOrderResult(
    'left',
    currentLeft.color,
    currentRight.color,
    leftCapture.certificate.turns,
    rightCapture.certificate.turns,
  );
  const rightFirst = firstOrderResult(
    'right',
    currentLeft.color,
    currentRight.color,
    leftCapture.certificate.turns,
    rightCapture.certificate.turns,
  );
  const outcome: SimpleSemeaiOutcome =
    leftFirst.outcome === rightFirst.outcome
      ? leftFirst.outcome
      : 'first-player-dependent';

  return Object.freeze({
    algorithm: SIMPLE_SEMEAI_ALGORITHM,
    outcome,
    reason: null,
    leftGroupKey: currentLeft.key,
    rightGroupKey: currentRight.key,
    leftColor: currentLeft.color,
    rightColor: currentRight.color,
    liberties,
    leftCapture: leftCapture.certificate,
    rightCapture: rightCapture.certificate,
    leftFirst,
    rightFirst,
  });
};
