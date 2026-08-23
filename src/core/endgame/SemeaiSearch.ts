import { GameEngine } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import {
  runAndOrSearch,
  type AndOrProofTrace,
  type AndOrSearchAdapter,
  type AndOrSearchResult,
} from './AndOrSearchCore';
import { buildEndgameGraph, type EndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { compareEndgamePointIds } from './EndgameGroupIdentity';
import { buildRelevanceZone, type RelevanceZoneResult } from './RelevanceZone';

export const BOUNDED_SEMEAI_ALGORITHM = 'bounded-semeai-v1';

export type BoundedSemeaiFirstPlayer = 'left' | 'right';
export type BoundedSemeaiOutcome =
  | 'left-wins'
  | 'right-wins'
  | 'first-player-dependent'
  | 'ko-dependent'
  | 'unresolved';
export type BoundedSemeaiOrderOutcome =
  | 'left-wins'
  | 'right-wins'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-boundary'
  | 'unknown-cycle'
  | 'unknown-incomplete';
export type BoundedSemeaiReason =
  | 'stale-group'
  | 'same-color'
  | 'not-interacting'
  | 'unknown-boundary'
  | 'mixed-order-uncertainty'
  | null;

export interface BoundedSemeaiOptions {
  /** Deterministic AND/OR node budget for each first-player order. */
  readonly maxNodes?: number;
  /** Maximum certified local conflict region size. */
  readonly maxZonePoints?: number;
}

export interface BoundedSemeaiOrderResult {
  readonly firstPlayer: BoundedSemeaiFirstPlayer;
  readonly outcome: BoundedSemeaiOrderOutcome;
  readonly search: AndOrSearchResult | null;
}

export interface BoundedSemeaiResult {
  readonly algorithm: typeof BOUNDED_SEMEAI_ALGORITHM;
  readonly proof: 'bounded-and-or-capture-race';
  readonly outcome: BoundedSemeaiOutcome;
  readonly reason: BoundedSemeaiReason;
  readonly leftGroupKey: string;
  readonly rightGroupKey: string;
  readonly leftColor: StoneColor;
  readonly rightColor: StoneColor;
  readonly leftCrucialStones: readonly PointId[];
  readonly rightCrucialStones: readonly PointId[];
  readonly zonePoints: readonly PointId[];
  readonly leftZone: RelevanceZoneResult | null;
  readonly rightZone: RelevanceZoneResult | null;
  readonly leftFirst: BoundedSemeaiOrderResult;
  readonly rightFirst: BoundedSemeaiOrderResult;
  readonly proofReason: string;
}

const DEFAULT_MAX_NODES = 20_000;
const DEFAULT_MAX_ZONE_POINTS = 96;

type UncertainReason = 'boundary' | 'ko' | 'incomplete';
type KoContext =
  | Readonly<{ readonly kind: 'lifted' }>
  | Readonly<{ readonly kind: 'exact'; readonly previousBoard: BoardOccupancy }>;

type SemeaiSearchState =
  | Readonly<{
      readonly kind: 'position';
      readonly state: GameState;
      readonly mover: StoneColor;
      readonly koContext: KoContext;
    }>
  | Readonly<{
      readonly kind: 'uncertain';
      readonly reason: UncertainReason;
      readonly mover: StoneColor;
    }>;

interface CurrentTarget {
  readonly status: 'intact' | 'captured' | 'invalid';
  readonly group: EndgameStoneString | null;
}

interface PositionAssessment {
  readonly graph: EndgameGraph;
  readonly left: CurrentTarget;
  readonly right: CurrentTarget;
}

interface SemeaiRuntime {
  readonly topology: Topology;
  readonly engine: GameEngine;
  readonly leftColor: StoneColor;
  readonly rightColor: StoneColor;
  readonly leftCrucialStones: readonly PointId[];
  readonly rightCrucialStones: readonly PointId[];
  readonly zonePoints: readonly PointId[];
  readonly zonePointSet: ReadonlySet<PointId>;
  readonly zoneIdentity: string;
  readonly maxZonePoints: number;
}

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const sortedPoints = (points: Iterable<PointId>): readonly PointId[] =>
  Object.freeze([...points].sort(compareEndgamePointIds));

const samePoints = (left: readonly PointId[], right: readonly PointId[]): boolean =>
  left.length === right.length && left.every((point, index) => point === right[index]);

const currentGroupMatches = (
  supplied: EndgameStoneString,
  current: EndgameStoneString | undefined,
): current is EndgameStoneString =>
  current !== undefined &&
  current.color === supplied.color &&
  samePoints(sortedPoints(current.points), sortedPoints(supplied.points));

const pairMatches = (
  groups: readonly [string, string],
  leftKey: string,
  rightKey: string,
): boolean =>
  (groups[0] === leftKey && groups[1] === rightKey) ||
  (groups[0] === rightKey && groups[1] === leftKey);

const asPlayingState = (state: GameState, currentPlayer: StoneColor): GameState =>
  Object.freeze({
    board: state.board,
    currentPlayer,
    moveNumber: state.moveNumber,
    consecutivePasses: 0,
    phase: 'playing' as const,
    captures: state.captures,
  });

const occupancySignature = (
  board: BoardOccupancy,
  points: readonly PointId[],
): string =>
  points
    .map((point) => {
      const occupancy = board[point];
      return occupancy === 'black' ? 'b' : occupancy === 'white' ? 'w' : '.';
    })
    .join('');

const makeUncertain = (
  reason: UncertainReason,
  mover: StoneColor,
): SemeaiSearchState => Object.freeze({ kind: 'uncertain' as const, reason, mover });

const makePosition = (
  state: GameState,
  mover: StoneColor,
  koContext: KoContext,
): SemeaiSearchState => Object.freeze({ kind: 'position' as const, state, mover, koContext });

const targetFromCrucialStones = (
  graph: EndgameGraph,
  board: BoardOccupancy,
  crucialStones: readonly PointId[],
  color: StoneColor,
): CurrentTarget => {
  const surviving = crucialStones.filter((point) => board[point] === color);
  if (surviving.length === 0) {
    return Object.freeze({ status: 'captured' as const, group: null });
  }
  if (surviving.length !== crucialStones.length) {
    return Object.freeze({ status: 'invalid' as const, group: null });
  }

  const groupKey = graph.stringByPoint.get(surviving[0]!);
  const group = groupKey ? graph.stringsByKey.get(groupKey) : undefined;
  if (!group || group.color !== color) {
    return Object.freeze({ status: 'invalid' as const, group: null });
  }
  if (!crucialStones.every((point) => group.points.includes(point))) {
    return Object.freeze({ status: 'invalid' as const, group: null });
  }

  return Object.freeze({ status: 'intact' as const, group });
};

const assessPosition = (
  runtime: SemeaiRuntime,
  state: GameState,
): PositionAssessment => {
  const graph = buildEndgameGraph(state.board, runtime.topology);
  return Object.freeze({
    graph,
    left: targetFromCrucialStones(
      graph,
      state.board,
      runtime.leftCrucialStones,
      runtime.leftColor,
    ),
    right: targetFromCrucialStones(
      graph,
      state.board,
      runtime.rightCrucialStones,
      runtime.rightColor,
    ),
  });
};

const terminalOutcome = (
  assessment: PositionAssessment,
): 'proved' | 'refuted' | null => {
  if (assessment.right.status === 'captured') return 'proved';
  if (assessment.left.status === 'captured') return 'refuted';
  return null;
};

const remainsInsideCertifiedZone = (
  runtime: SemeaiRuntime,
  state: GameState,
  assessment: PositionAssessment,
): boolean => {
  for (const target of [assessment.left, assessment.right]) {
    if (target.status === 'captured') continue;
    if (target.status !== 'intact' || !target.group) return false;

    const currentZone = buildRelevanceZone(target.group, state.board, runtime.topology, {
      maxPoints: runtime.maxZonePoints,
    });
    if (currentZone.outcome !== 'bounded') return false;
    if (!currentZone.points.every((point) => runtime.zonePointSet.has(point))) return false;
  }
  return true;
};

/**
 * Any move that creates an immediate restoring simple-ko recapture is not an
 * unconditional semeai proof. External ko threats are outside the bounded race,
 * so the continuation is represented explicitly as ko-dependent uncertainty.
 */
const createsSimpleKo = (
  runtime: SemeaiRuntime,
  before: GameState,
  after: GameState,
  recapturer: StoneColor,
): boolean => {
  for (const point of runtime.zonePoints) {
    if (after.board[point] !== 'empty') continue;
    const recapture = runtime.engine.placeStone(
      asPlayingState(after, recapturer),
      point,
      recapturer,
      { previousBoard: before.board },
    );
    if (!recapture.ok && recapture.reason === 'repetition') return true;
  }
  return false;
};

const stateKey = (runtime: SemeaiRuntime, state: SemeaiSearchState): string => {
  if (state.kind === 'uncertain') return `uncertain|${state.reason}|${state.mover}`;
  const current = occupancySignature(state.state.board, runtime.zonePoints);
  const ko =
    state.koContext.kind === 'exact'
      ? `exact:${occupancySignature(state.koContext.previousBoard, runtime.zonePoints)}`
      : 'lifted';
  return `${runtime.zoneIdentity}|${state.mover}|${ko}|${current}`;
};

const previousBoardFor = (
  state: SemeaiSearchState,
): Readonly<{ readonly previousBoard: BoardOccupancy | null }> => {
  if (state.kind === 'position' && state.koContext.kind === 'exact') {
    return Object.freeze({ previousBoard: state.koContext.previousBoard });
  }
  return Object.freeze({ previousBoard: null });
};

const libertiesFor = (target: CurrentTarget): number =>
  target.status === 'intact' && target.group ? target.group.liberties.length : 0;

const childOrderingMetric = (
  runtime: SemeaiRuntime,
  assessment: PositionAssessment,
  mover: StoneColor,
  capturedCount: number,
): readonly [number, number, number, number] => {
  const terminal = terminalOutcome(assessment);
  const moverWins =
    (mover === runtime.leftColor && terminal === 'proved') ||
    (mover === runtime.rightColor && terminal === 'refuted');
  const opponent = mover === runtime.leftColor ? assessment.right : assessment.left;
  const own = mover === runtime.leftColor ? assessment.left : assessment.right;
  return Object.freeze([
    moverWins ? -2 : terminal ? 2 : 0,
    libertiesFor(opponent),
    -libertiesFor(own),
    -capturedCount,
  ] as const);
};

const buildAdapter = (runtime: SemeaiRuntime): AndOrSearchAdapter<SemeaiSearchState> => ({
  stateKey: (state) => stateKey(runtime, state),
  nodeType: (state) => (state.mover === runtime.leftColor ? 'or' : 'and'),
  terminal: (state) => {
    if (state.kind === 'uncertain') return null;
    return terminalOutcome(assessPosition(runtime, state.state));
  },
  expand: (state) => {
    if (state.kind === 'uncertain') {
      return Object.freeze({ children: Object.freeze([]), complete: false });
    }

    const assessment = assessPosition(runtime, state.state);
    if (
      assessment.left.status === 'invalid' ||
      assessment.right.status === 'invalid'
    ) {
      return Object.freeze({
        children: Object.freeze([
          Object.freeze({
            move: '[incomplete-target-transition]',
            state: makeUncertain('incomplete', state.mover),
          }),
        ]),
        complete: true,
      });
    }

    if (!remainsInsideCertifiedZone(runtime, state.state, assessment)) {
      return Object.freeze({
        children: Object.freeze([
          Object.freeze({
            move: '[boundary-uncertain]',
            state: makeUncertain('boundary', state.mover),
          }),
        ]),
        complete: true,
      });
    }

    const generated: Array<{
      readonly move: PointId;
      readonly state: SemeaiSearchState;
      readonly metric: readonly [number, number, number, number];
    }> = [];
    const playing = asPlayingState(state.state, state.mover);
    const koContext = previousBoardFor(state);
    const nextMover = opponentOf(state.mover);

    for (const point of runtime.zonePoints) {
      if (state.state.board[point] !== 'empty') continue;
      const result = runtime.engine.placeStone(playing, point, state.mover, koContext);
      if (!result.ok) continue;

      if (createsSimpleKo(runtime, playing, result.state, nextMover)) {
        generated.push(
          Object.freeze({
            move: point,
            state: makeUncertain('ko', nextMover),
            metric: Object.freeze([1, 0, 0, -result.captured.length] as const),
          }),
        );
        continue;
      }

      const childAssessment = assessPosition(runtime, result.state);
      const childTerminal = terminalOutcome(childAssessment);
      if (
        !childTerminal &&
        (childAssessment.left.status === 'invalid' ||
          childAssessment.right.status === 'invalid')
      ) {
        generated.push(
          Object.freeze({
            move: point,
            state: makeUncertain('incomplete', nextMover),
            metric: Object.freeze([1, 0, 0, -result.captured.length] as const),
          }),
        );
        continue;
      }

      if (
        !childTerminal &&
        !remainsInsideCertifiedZone(runtime, result.state, childAssessment)
      ) {
        generated.push(
          Object.freeze({
            move: point,
            state: makeUncertain('boundary', nextMover),
            metric: Object.freeze([1, 0, 0, -result.captured.length] as const),
          }),
        );
        continue;
      }

      generated.push(
        Object.freeze({
          move: point,
          state: makePosition(
            result.state,
            nextMover,
            Object.freeze({ kind: 'exact' as const, previousBoard: state.state.board }),
          ),
          metric: childOrderingMetric(
            runtime,
            childAssessment,
            state.mover,
            result.captured.length,
          ),
        }),
      );
    }

    generated.sort(
      (left, right) =>
        left.metric[0] - right.metric[0] ||
        left.metric[1] - right.metric[1] ||
        left.metric[2] - right.metric[2] ||
        left.metric[3] - right.metric[3] ||
        compareEndgamePointIds(left.move, right.move),
    );

    const children: Array<Readonly<{ readonly move: string; readonly state: SemeaiSearchState }>> =
      generated.map((child) =>
        Object.freeze({ move: `play:${child.move}`, state: child.state }),
      );

    // One no-op stands for Pass or any move outside the certified conflict zone.
    // Such a move changes the side to move and lifts immediate simple-ko.
    children.push(
      Object.freeze({
        move: 'tenuki',
        state: makePosition(
          state.state,
          nextMover,
          Object.freeze({ kind: 'lifted' as const }),
        ),
      }),
    );

    return Object.freeze({ children: Object.freeze(children), complete: true });
  },
});

const traceContainsUncertainReason = (
  trace: AndOrProofTrace,
  reason: UncertainReason,
): boolean => {
  if (trace.nodeKey.startsWith(`uncertain|${reason}|`)) return true;
  return trace.children.some((child) => traceContainsUncertainReason(child.trace, reason));
};

const mapOrderOutcome = (search: AndOrSearchResult): BoundedSemeaiOrderOutcome => {
  if (search.outcome === 'proved') return 'left-wins';
  if (search.outcome === 'refuted') return 'right-wins';
  if (search.unknownReason === 'budget') return 'unknown-budget';
  if (traceContainsUncertainReason(search.trace, 'ko')) return 'ko-dependent';
  if (traceContainsUncertainReason(search.trace, 'boundary')) return 'unknown-boundary';
  if (search.unknownReason === 'cycle') return 'unknown-cycle';
  return 'unknown-incomplete';
};

const runOrder = (
  runtime: SemeaiRuntime,
  state: GameState,
  firstPlayer: BoundedSemeaiFirstPlayer,
  maxNodes: number,
): BoundedSemeaiOrderResult => {
  const mover = firstPlayer === 'left' ? runtime.leftColor : runtime.rightColor;
  const search = runAndOrSearch(
    makePosition(
      asPlayingState(state, mover),
      mover,
      Object.freeze({ kind: 'lifted' as const }),
    ),
    buildAdapter(runtime),
    { maxNodes },
  );
  return Object.freeze({ firstPlayer, outcome: mapOrderOutcome(search), search });
};

const unavailableOrder = (
  firstPlayer: BoundedSemeaiFirstPlayer,
  outcome: Extract<BoundedSemeaiOrderOutcome, 'unknown-boundary' | 'unknown-incomplete'>,
): BoundedSemeaiOrderResult => Object.freeze({ firstPlayer, outcome, search: null });

const makeUnavailableResult = (
  left: EndgameStoneString,
  right: EndgameStoneString,
  reason: Exclude<BoundedSemeaiReason, 'mixed-order-uncertainty' | null>,
  orderOutcome: Extract<BoundedSemeaiOrderOutcome, 'unknown-boundary' | 'unknown-incomplete'>,
  leftZone: RelevanceZoneResult | null,
  rightZone: RelevanceZoneResult | null,
  zonePoints: readonly PointId[],
  proofReason: string,
): BoundedSemeaiResult =>
  Object.freeze({
    algorithm: BOUNDED_SEMEAI_ALGORITHM,
    proof: 'bounded-and-or-capture-race' as const,
    outcome: 'unresolved' as const,
    reason,
    leftGroupKey: left.key,
    rightGroupKey: right.key,
    leftColor: left.color,
    rightColor: right.color,
    leftCrucialStones: sortedPoints(left.points),
    rightCrucialStones: sortedPoints(right.points),
    zonePoints,
    leftZone,
    rightZone,
    leftFirst: unavailableOrder('left', orderOutcome),
    rightFirst: unavailableOrder('right', orderOutcome),
    proofReason,
  });

const orderWinner = (
  order: BoundedSemeaiOrderResult,
): 'left-wins' | 'right-wins' | null =>
  order.outcome === 'left-wins' || order.outcome === 'right-wins' ? order.outcome : null;

/**
 * Work 7B: bounded game-theoretic semeai reader for a pair of opposing target
 * strings inside one certified local conflict region.
 *
 * Unlike Work 7A, this reader expands every legal local placement plus an
 * explicit tenuki through authoritative GameEngine transitions. Connections,
 * captures of neighboring groups and changing shared liberties are therefore
 * normal search transitions rather than reasons to reject the position.
 *
 * The reader proves only which original target is force-captured first. It does
 * not label seki and is intentionally not connected to the production classifier;
 * both remain later Work 7 stages.
 */
export const analyzeBoundedSemeai = (
  suppliedLeft: EndgameStoneString,
  suppliedRight: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: BoundedSemeaiOptions = {},
): BoundedSemeaiResult => {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxZonePoints = options.maxZonePoints ?? DEFAULT_MAX_ZONE_POINTS;
  const graph = buildEndgameGraph(state.board, topology);
  const currentLeft = graph.stringsByKey.get(suppliedLeft.key);
  const currentRight = graph.stringsByKey.get(suppliedRight.key);

  if (
    !currentGroupMatches(suppliedLeft, currentLeft) ||
    !currentGroupMatches(suppliedRight, currentRight)
  ) {
    return makeUnavailableResult(
      suppliedLeft,
      suppliedRight,
      'stale-group',
      'unknown-incomplete',
      null,
      null,
      Object.freeze([]),
      'one or both supplied target groups no longer match the board snapshot',
    );
  }

  if (currentLeft.color === currentRight.color) {
    return makeUnavailableResult(
      currentLeft,
      currentRight,
      'same-color',
      'unknown-incomplete',
      null,
      null,
      Object.freeze([]),
      'semeai requires opposing target groups',
    );
  }

  const directlyAdjacent = graph.opponentAdjacencies.some((entry) =>
    pairMatches(entry.groups, currentLeft.key, currentRight.key),
  );
  const sharesLiberty = graph.sharedLiberties.some((entry) =>
    pairMatches(entry.groups, currentLeft.key, currentRight.key),
  );
  if (!directlyAdjacent && !sharesLiberty) {
    return makeUnavailableResult(
      currentLeft,
      currentRight,
      'not-interacting',
      'unknown-incomplete',
      null,
      null,
      Object.freeze([]),
      'the supplied targets do not directly interact by adjacency or shared liberty',
    );
  }

  const leftZone = buildRelevanceZone(currentLeft, state.board, topology, {
    maxPoints: maxZonePoints,
  });
  const rightZone = buildRelevanceZone(currentRight, state.board, topology, {
    maxPoints: maxZonePoints,
  });
  const zonePoints = sortedPoints(new Set([...leftZone.points, ...rightZone.points]));

  if (
    leftZone.outcome !== 'bounded' ||
    rightZone.outcome !== 'bounded' ||
    zonePoints.length > maxZonePoints
  ) {
    return makeUnavailableResult(
      currentLeft,
      currentRight,
      'unknown-boundary',
      'unknown-boundary',
      leftZone,
      rightZone,
      zonePoints,
      'the interacting targets do not fit inside one certified bounded conflict region',
    );
  }

  const runtime: SemeaiRuntime = {
    topology,
    engine: new GameEngine(topology),
    leftColor: currentLeft.color,
    rightColor: currentRight.color,
    leftCrucialStones: sortedPoints(currentLeft.points),
    rightCrucialStones: sortedPoints(currentRight.points),
    zonePoints,
    zonePointSet: new Set(zonePoints),
    zoneIdentity: JSON.stringify({
      topology: topology.id,
      left: currentLeft.key,
      right: currentRight.key,
      points: zonePoints,
    }),
    maxZonePoints,
  };

  const leftFirst = runOrder(runtime, state, 'left', maxNodes);
  const rightFirst = runOrder(runtime, state, 'right', maxNodes);
  const leftFirstWinner = orderWinner(leftFirst);
  const rightFirstWinner = orderWinner(rightFirst);

  let outcome: BoundedSemeaiOutcome = 'unresolved';
  let reason: BoundedSemeaiReason = 'mixed-order-uncertainty';
  let proofReason = 'at least one first-player order remains unresolved';

  if (leftFirstWinner && rightFirstWinner) {
    if (leftFirstWinner === rightFirstWinner) {
      outcome = leftFirstWinner;
      reason = null;
      proofReason = 'both first-player orders prove the same force-capture winner';
    } else {
      outcome = 'first-player-dependent';
      reason = null;
      proofReason = 'the proved force-capture winner changes with the first player';
    }
  } else if (
    leftFirst.outcome === 'ko-dependent' ||
    rightFirst.outcome === 'ko-dependent'
  ) {
    outcome = 'ko-dependent';
    reason = null;
    proofReason = 'at least one first-player order reaches a required simple-ko continuation';
  }

  return Object.freeze({
    algorithm: BOUNDED_SEMEAI_ALGORITHM,
    proof: 'bounded-and-or-capture-race' as const,
    outcome,
    reason,
    leftGroupKey: currentLeft.key,
    rightGroupKey: currentRight.key,
    leftColor: currentLeft.color,
    rightColor: currentRight.color,
    leftCrucialStones: runtime.leftCrucialStones,
    rightCrucialStones: runtime.rightCrucialStones,
    zonePoints,
    leftZone,
    rightZone,
    leftFirst,
    rightFirst,
    proofReason,
  });
};
