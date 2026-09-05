import { GameEngine } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import {
  runAndOrSearch,
  runAndOrSearchAsync,
  type AndOrProofTrace,
  type AndOrSearchAdapter,
  type AndOrSearchResult,
} from './AndOrSearchCore';
import {
  tryBuildEndgameStaticGraph,
  type EndgameStoneString,
} from './EndgameStaticGraph';
import { compareEndgamePointIds } from './EndgameGroupIdentity';
import {
  buildRelevanceZone,
  collectBensonSafeGroupKeys,
  type RelevanceZoneResult,
} from './RelevanceZone';

export const BOUNDED_SEMEAI_ALGORITHM = 'bounded-semeai-v2';

export type BoundedSemeaiFirstPlayer = 'left' | 'right';
export type BoundedSemeaiOrderOutcome =
  | 'left-wins'
  | 'right-wins'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-boundary'
  | 'unknown-cycle'
  | 'unknown-incomplete';
export type BoundedSemeaiOutcome =
  | 'stable-left-winner'
  | 'stable-right-winner'
  | 'first-player-dependent'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-boundary'
  | 'unknown-cycle'
  | 'unknown-incomplete';

export interface BoundedSemeaiOptions {
  readonly maxNodes?: number;
  readonly maxZonePoints?: number;
  readonly shouldStop?: () => boolean;
  readonly cooperativeCheckpoint?: () => Promise<boolean>;
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
  readonly leftGroupKey: string;
  readonly rightGroupKey: string;
  readonly leftColor: StoneColor;
  readonly rightColor: StoneColor;
  readonly leftCrucialStones: readonly PointId[];
  readonly rightCrucialStones: readonly PointId[];
  readonly sharedLiberties: readonly PointId[];
  readonly zonePoints: readonly PointId[];
  readonly leftZone: RelevanceZoneResult | null;
  readonly rightZone: RelevanceZoneResult | null;
  readonly leftFirst: BoundedSemeaiOrderResult;
  readonly rightFirst: BoundedSemeaiOrderResult;
  readonly exploredNodes: number;
  readonly proofReason: string;
}

const DEFAULT_MAX_NODES = 8_000;
const DEFAULT_MAX_ZONE_POINTS = 96;
type UncertainReason = 'boundary' | 'ko' | 'incomplete' | 'budget';
type KoContext =
  | Readonly<{ readonly kind: 'lifted' }>
  | Readonly<{ readonly kind: 'exact'; readonly previousBoard: BoardOccupancy }>;

type SemeaiSearchState =
  | Readonly<{ readonly kind: 'position'; readonly state: GameState; readonly mover: StoneColor; readonly koContext: KoContext }>
  | Readonly<{ readonly kind: 'uncertain'; readonly reason: UncertainReason; readonly mover: StoneColor }>;

type TargetAssessment = Readonly<{
  readonly status: 'intact' | 'captured' | 'invalid';
  readonly group: EndgameStoneString | null;
}>;

interface PairAssessment {
  readonly left: TargetAssessment;
  readonly right: TargetAssessment;
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
  readonly shouldStop: () => boolean;
}

const opponentOf = (color: StoneColor): StoneColor => color === 'black' ? 'white' : 'black';
const sortedPoints = (points: Iterable<PointId>): readonly PointId[] =>
  Object.freeze([...points].sort(compareEndgamePointIds));
const samePoints = (left: readonly PointId[], right: readonly PointId[]): boolean =>
  left.length === right.length && left.every((point, index) => point === right[index]);

const currentGroupMatches = (supplied: EndgameStoneString, current: EndgameStoneString | undefined): current is EndgameStoneString =>
  current !== undefined && current.color === supplied.color && samePoints(sortedPoints(current.points), sortedPoints(supplied.points));

const asPlayingState = (state: GameState, currentPlayer: StoneColor): GameState => Object.freeze({
  board: state.board,
  currentPlayer,
  moveNumber: state.moveNumber,
  consecutivePasses: 0,
  phase: 'playing' as const,
  captures: state.captures,
});

const occupancySignature = (board: BoardOccupancy, points: readonly PointId[]): string =>
  points.map((point) => board[point] === 'black' ? 'b' : board[point] === 'white' ? 'w' : '.').join('');

const makePosition = (state: GameState, mover: StoneColor, koContext: KoContext): SemeaiSearchState =>
  Object.freeze({ kind: 'position' as const, state, mover, koContext });
const makeUncertain = (reason: UncertainReason, mover: StoneColor): SemeaiSearchState =>
  Object.freeze({ kind: 'uncertain' as const, reason, mover });

const assessTarget = (
  graph: ReturnType<typeof tryBuildEndgameStaticGraph>,
  state: GameState,
  crucialStones: readonly PointId[],
  color: StoneColor,
): TargetAssessment => {
  const surviving = crucialStones.filter((point) => state.board[point] === color);
  if (surviving.length === 0) return Object.freeze({ status: 'captured' as const, group: null });
  if (surviving.length !== crucialStones.length || !graph) return Object.freeze({ status: 'invalid' as const, group: null });
  const key = graph.stringByPoint.get(surviving[0]!);
  const group = key ? graph.stringsByKey.get(key) ?? null : null;
  if (!group || group.color !== color || !crucialStones.every((point) => group.points.includes(point))) {
    return Object.freeze({ status: 'invalid' as const, group: null });
  }
  return Object.freeze({ status: 'intact' as const, group });
};

const assessPosition = (runtime: SemeaiRuntime, state: GameState): PairAssessment => {
  if (runtime.shouldStop()) {
    return Object.freeze({
      left: Object.freeze({ status: 'invalid' as const, group: null }),
      right: Object.freeze({ status: 'invalid' as const, group: null }),
    });
  }
  const graph = tryBuildEndgameStaticGraph(state.board, runtime.topology, { shouldStop: runtime.shouldStop });
  return Object.freeze({
    left: assessTarget(graph, state, runtime.leftCrucialStones, runtime.leftColor),
    right: assessTarget(graph, state, runtime.rightCrucialStones, runtime.rightColor),
  });
};

const terminalOutcome = (assessment: PairAssessment): 'proved' | 'refuted' | null => {
  if (assessment.left.status === 'captured' && assessment.right.status === 'intact') return 'refuted';
  if (assessment.right.status === 'captured' && assessment.left.status === 'intact') return 'proved';
  return null;
};

const remainsInsideCertifiedZone = (
  runtime: SemeaiRuntime,
  state: GameState,
  assessment: PairAssessment,
): boolean => {
  if (runtime.shouldStop()) return false;
  for (const target of [assessment.left, assessment.right] as const) {
    if (target.status === 'captured') continue;
    if (target.status !== 'intact' || !target.group) return false;
    const zone = buildRelevanceZone(target.group, state.board, runtime.topology, {
      maxPoints: runtime.maxZonePoints,
      shouldStop: runtime.shouldStop,
    });
    if (zone.outcome !== 'bounded' || !zone.points.every((point) => runtime.zonePointSet.has(point))) return false;
  }
  return true;
};

const createsSimpleKo = (
  runtime: SemeaiRuntime,
  before: GameState,
  after: GameState,
  nextMover: StoneColor,
): 'clear' | 'ko' | 'budget' => {
  for (const point of runtime.zonePoints) {
    if (runtime.shouldStop()) return 'budget';
    if (after.board[point] !== 'empty') continue;
    const recapture = runtime.engine.placeStone(
      asPlayingState(after, nextMover),
      point,
      nextMover,
      { previousBoard: before.board },
    );
    if (!recapture.ok && recapture.reason === 'repetition') return 'ko';
  }
  return 'clear';
};

const previousBoardFor = (state: SemeaiSearchState): Readonly<{ previousBoard: BoardOccupancy | null }> =>
  state.kind === 'position' && state.koContext.kind === 'exact'
    ? Object.freeze({ previousBoard: state.koContext.previousBoard })
    : Object.freeze({ previousBoard: null });

const stateKey = (runtime: SemeaiRuntime, state: SemeaiSearchState): string => {
  if (state.kind === 'uncertain') return `uncertain|${state.reason}|${state.mover}`;
  const current = occupancySignature(state.state.board, runtime.zonePoints);
  const previous = state.koContext.kind === 'exact'
    ? occupancySignature(state.koContext.previousBoard, runtime.zonePoints)
    : '-';
  return `${runtime.zoneIdentity}|${state.mover}|${state.koContext.kind}|${previous}|${current}`;
};

const libertiesFor = (assessment: TargetAssessment): number =>
  assessment.status === 'intact' ? assessment.group?.liberties.length ?? 0 : -1;

const childOrderingMetric = (
  runtime: SemeaiRuntime,
  assessment: PairAssessment,
  mover: StoneColor,
  capturedCount: number,
): readonly [number, number, number, number] => {
  const terminal = terminalOutcome(assessment);
  const moverWins = (mover === runtime.leftColor && terminal === 'proved') || (mover === runtime.rightColor && terminal === 'refuted');
  const opponent = mover === runtime.leftColor ? assessment.right : assessment.left;
  const own = mover === runtime.leftColor ? assessment.left : assessment.right;
  return Object.freeze([moverWins ? -2 : terminal ? 2 : 0, libertiesFor(opponent), -libertiesFor(own), -capturedCount] as const);
};

const buildAdapter = (runtime: SemeaiRuntime): AndOrSearchAdapter<SemeaiSearchState> => ({
  stateKey: (state) => stateKey(runtime, state),
  nodeType: (state) => state.mover === runtime.leftColor ? 'or' : 'and',
  terminal: (state) => state.kind === 'uncertain' ? null : terminalOutcome(assessPosition(runtime, state.state)),
  expand: (state) => {
    if (state.kind === 'uncertain') return Object.freeze({ children: Object.freeze([]), complete: false });
    if (runtime.shouldStop()) {
      return Object.freeze({ children: Object.freeze([
        Object.freeze({ move: '[budget-interrupted]', state: makeUncertain('budget', state.mover) }),
      ]), complete: true });
    }

    const assessment = assessPosition(runtime, state.state);
    if (assessment.left.status === 'invalid' || assessment.right.status === 'invalid') {
      return Object.freeze({ children: Object.freeze([
        Object.freeze({ move: '[incomplete-target-transition]', state: makeUncertain('incomplete', state.mover) }),
      ]), complete: true });
    }
    if (!terminalOutcome(assessment) && !remainsInsideCertifiedZone(runtime, state.state, assessment)) {
      return Object.freeze({ children: Object.freeze([
        Object.freeze({ move: '[boundary-uncertain]', state: makeUncertain('boundary', state.mover) }),
      ]), complete: true });
    }

    const generated: Array<Readonly<{ move: PointId; state: SemeaiSearchState; metric: readonly [number, number, number, number] }>> = [];
    const playing = asPlayingState(state.state, state.mover);
    const koContext = previousBoardFor(state);
    const nextMover = opponentOf(state.mover);

    for (const point of runtime.zonePoints) {
      if (runtime.shouldStop()) {
        generated.push(Object.freeze({ move: point, state: makeUncertain('budget', nextMover), metric: Object.freeze([4, 0, 0, 0] as const) }));
        break;
      }
      if (state.state.board[point] !== 'empty') continue;
      const result = runtime.engine.placeStone(playing, point, state.mover, koContext);
      if (!result.ok) continue;

      const ko = createsSimpleKo(runtime, playing, result.state, nextMover);
      if (ko === 'budget') {
        generated.push(Object.freeze({ move: point, state: makeUncertain('budget', nextMover), metric: Object.freeze([4, 0, 0, -result.captured.length] as const) }));
        break;
      }
      if (ko === 'ko') {
        generated.push(Object.freeze({ move: point, state: makeUncertain('ko', nextMover), metric: Object.freeze([1, 0, 0, -result.captured.length] as const) }));
        continue;
      }

      const childAssessment = assessPosition(runtime, result.state);
      const childTerminal = terminalOutcome(childAssessment);
      if (!childTerminal && (childAssessment.left.status === 'invalid' || childAssessment.right.status === 'invalid')) {
        generated.push(Object.freeze({ move: point, state: makeUncertain('incomplete', nextMover), metric: Object.freeze([2, 0, 0, -result.captured.length] as const) }));
        continue;
      }
      if (!childTerminal && !remainsInsideCertifiedZone(runtime, result.state, childAssessment)) {
        generated.push(Object.freeze({ move: point, state: makeUncertain('boundary', nextMover), metric: Object.freeze([1, 0, 0, -result.captured.length] as const) }));
        continue;
      }

      generated.push(Object.freeze({
        move: point,
        state: makePosition(result.state, nextMover, Object.freeze({ kind: 'exact' as const, previousBoard: state.state.board })),
        metric: childOrderingMetric(runtime, childAssessment, state.mover, result.captured.length),
      }));
    }

    generated.sort((left, right) =>
      left.metric[0] - right.metric[0] || left.metric[1] - right.metric[1] || left.metric[2] - right.metric[2] || left.metric[3] - right.metric[3] || compareEndgamePointIds(left.move, right.move));
    const children: Array<Readonly<{ move: string; state: SemeaiSearchState }>> = generated.map((child) =>
      Object.freeze({ move: `play:${child.move}`, state: child.state }));
    children.push(Object.freeze({ move: 'tenuki', state: makePosition(state.state, nextMover, Object.freeze({ kind: 'lifted' as const })) }));
    return Object.freeze({ children: Object.freeze(children), complete: true });
  },
});

const traceContainsUncertainReason = (trace: AndOrProofTrace, reason: UncertainReason): boolean =>
  trace.nodeKey.startsWith(`uncertain|${reason}|`) || trace.children.some((child) => traceContainsUncertainReason(child.trace, reason));

const mapOrderOutcome = (search: AndOrSearchResult): BoundedSemeaiOrderOutcome => {
  if (search.outcome === 'proved') return 'left-wins';
  if (search.outcome === 'refuted') return 'right-wins';
  if (traceContainsUncertainReason(search.trace, 'ko')) return 'ko-dependent';
  if (traceContainsUncertainReason(search.trace, 'boundary')) return 'unknown-boundary';
  if (traceContainsUncertainReason(search.trace, 'incomplete')) return 'unknown-incomplete';
  if (search.unknownReason === 'budget' || traceContainsUncertainReason(search.trace, 'budget')) return 'unknown-budget';
  if (search.unknownReason === 'cycle') return 'unknown-cycle';
  return 'unknown-incomplete';
};

const unavailableOrder = (firstPlayer: BoundedSemeaiFirstPlayer, outcome: BoundedSemeaiOrderOutcome): BoundedSemeaiOrderResult =>
  Object.freeze({ firstPlayer, outcome, search: null });

const aggregateUnknown = (left: BoundedSemeaiOrderOutcome, right: BoundedSemeaiOrderOutcome): BoundedSemeaiOutcome => {
  const values = [left, right];
  if (values.includes('ko-dependent')) return 'ko-dependent';
  if (values.includes('unknown-boundary')) return 'unknown-boundary';
  if (values.includes('unknown-budget')) return 'unknown-budget';
  if (values.includes('unknown-cycle')) return 'unknown-cycle';
  return 'unknown-incomplete';
};

const finishResult = (
  left: EndgameStoneString,
  right: EndgameStoneString,
  sharedLiberties: readonly PointId[],
  zonePoints: readonly PointId[],
  leftZone: RelevanceZoneResult | null,
  rightZone: RelevanceZoneResult | null,
  leftFirst: BoundedSemeaiOrderResult,
  rightFirst: BoundedSemeaiOrderResult,
  fallbackReason: string,
): BoundedSemeaiResult => {
  const leftWinner = leftFirst.outcome === 'left-wins' || leftFirst.outcome === 'right-wins' ? leftFirst.outcome : null;
  const rightWinner = rightFirst.outcome === 'left-wins' || rightFirst.outcome === 'right-wins' ? rightFirst.outcome : null;
  let outcome: BoundedSemeaiOutcome;
  let proofReason = fallbackReason;
  if (leftWinner && rightWinner) {
    if (leftWinner === rightWinner) {
      outcome = leftWinner === 'left-wins' ? 'stable-left-winner' : 'stable-right-winner';
      proofReason = 'both first-player orders prove the same force-capture winner';
    } else {
      outcome = 'first-player-dependent';
      proofReason = 'the proved force-capture winner changes with the first player';
    }
  } else {
    outcome = aggregateUnknown(leftFirst.outcome, rightFirst.outcome);
  }
  return Object.freeze({
    algorithm: BOUNDED_SEMEAI_ALGORITHM,
    proof: 'bounded-and-or-capture-race' as const,
    outcome,
    leftGroupKey: left.key,
    rightGroupKey: right.key,
    leftColor: left.color,
    rightColor: right.color,
    leftCrucialStones: sortedPoints(left.points),
    rightCrucialStones: sortedPoints(right.points),
    sharedLiberties,
    zonePoints,
    leftZone,
    rightZone,
    leftFirst,
    rightFirst,
    exploredNodes: (leftFirst.search?.exploredNodes ?? 0) + (rightFirst.search?.exploredNodes ?? 0),
    proofReason,
  });
};

const prepare = (
  suppliedLeft: EndgameStoneString,
  suppliedRight: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: BoundedSemeaiOptions,
): Readonly<{ runtime: SemeaiRuntime | null; early: BoundedSemeaiResult | null; left: EndgameStoneString; right: EndgameStoneString; sharedLiberties: readonly PointId[]; leftZone: RelevanceZoneResult | null; rightZone: RelevanceZoneResult | null }> => {
  const maxZonePoints = options.maxZonePoints ?? DEFAULT_MAX_ZONE_POINTS;
  const shouldStop = options.shouldStop ?? (() => false);
  const graph = tryBuildEndgameStaticGraph(state.board, topology, { shouldStop });
  const currentLeft = graph?.stringsByKey.get(suppliedLeft.key);
  const currentRight = graph?.stringsByKey.get(suppliedRight.key);
  const left = currentLeft ?? suppliedLeft;
  const right = currentRight ?? suppliedRight;
  const noShared: readonly PointId[] = Object.freeze([]);

  const early = (orderOutcome: BoundedSemeaiOrderOutcome, reason: string, shared: readonly PointId[] = noShared, leftZone: RelevanceZoneResult | null = null, rightZone: RelevanceZoneResult | null = null, zonePoints: readonly PointId[] = Object.freeze([])): BoundedSemeaiResult =>
    finishResult(left, right, shared, zonePoints, leftZone, rightZone, unavailableOrder('left', orderOutcome), unavailableOrder('right', orderOutcome), reason);

  if (!graph || shouldStop()) return Object.freeze({ runtime: null, early: early('unknown-budget', 'shared hard deadline interrupted semeai preparation'), left, right, sharedLiberties: noShared, leftZone: null, rightZone: null });
  if (!currentGroupMatches(suppliedLeft, currentLeft) || !currentGroupMatches(suppliedRight, currentRight)) {
    return Object.freeze({ runtime: null, early: early('unknown-incomplete', 'one or both supplied target groups no longer match the board snapshot'), left, right, sharedLiberties: noShared, leftZone: null, rightZone: null });
  }
  if (left.color === right.color) return Object.freeze({ runtime: null, early: early('unknown-incomplete', 'semeai requires opposing target groups'), left, right, sharedLiberties: noShared, leftZone: null, rightZone: null });

  const rightPointSet = new Set(right.points);
  const directlyAdjacent = left.points.some((point) => topology.neighbors(point).some((neighbor) => rightPointSet.has(neighbor)));
  const rightLiberties = new Set(right.liberties);
  const sharedLiberties = sortedPoints(left.liberties.filter((point) => rightLiberties.has(point)));
  if (!directlyAdjacent && sharedLiberties.length === 0) {
    return Object.freeze({ runtime: null, early: early('unknown-incomplete', 'the supplied targets do not directly interact by adjacency or shared liberty', sharedLiberties), left, right, sharedLiberties, leftZone: null, rightZone: null });
  }

  const safeGroupKeys = collectBensonSafeGroupKeys(state.board, topology, graph, shouldStop);
  if (!safeGroupKeys) return Object.freeze({ runtime: null, early: early('unknown-budget', 'Benson boundary preparation was interrupted', sharedLiberties), left, right, sharedLiberties, leftZone: null, rightZone: null });
  const leftZone = buildRelevanceZone(left, state.board, topology, { maxPoints: maxZonePoints, graph, safeGroupKeys, shouldStop });
  const rightZone = buildRelevanceZone(right, state.board, topology, { maxPoints: maxZonePoints, graph, safeGroupKeys, shouldStop });
  const zonePoints = sortedPoints(new Set([...leftZone.points, ...rightZone.points]));
  if (leftZone.reason === 'interrupted' || rightZone.reason === 'interrupted') {
    return Object.freeze({ runtime: null, early: early('unknown-budget', 'shared hard deadline interrupted semeai zone certification', sharedLiberties, leftZone, rightZone, zonePoints), left, right, sharedLiberties, leftZone, rightZone });
  }
  if (leftZone.outcome !== 'bounded' || rightZone.outcome !== 'bounded' || zonePoints.length > maxZonePoints) {
    return Object.freeze({ runtime: null, early: early('unknown-boundary', 'the interacting targets do not fit inside one certified bounded conflict region', sharedLiberties, leftZone, rightZone, zonePoints), left, right, sharedLiberties, leftZone, rightZone });
  }

  const runtime: SemeaiRuntime = {
    topology,
    engine: new GameEngine(topology),
    leftColor: left.color,
    rightColor: right.color,
    leftCrucialStones: sortedPoints(left.points),
    rightCrucialStones: sortedPoints(right.points),
    zonePoints,
    zonePointSet: new Set(zonePoints),
    zoneIdentity: JSON.stringify({ topology: topology.id, left: left.key, right: right.key, points: zonePoints }),
    maxZonePoints,
    shouldStop,
  };
  return Object.freeze({ runtime, early: null, left, right, sharedLiberties, leftZone, rightZone });
};

const runOrder = (runtime: SemeaiRuntime, state: GameState, firstPlayer: BoundedSemeaiFirstPlayer, maxNodes: number): BoundedSemeaiOrderResult => {
  const mover = firstPlayer === 'left' ? runtime.leftColor : runtime.rightColor;
  const search = runAndOrSearch(makePosition(asPlayingState(state, mover), mover, Object.freeze({ kind: 'lifted' as const })), buildAdapter(runtime), { maxNodes, shouldStop: runtime.shouldStop });
  return Object.freeze({ firstPlayer, outcome: mapOrderOutcome(search), search });
};

const runOrderAsync = async (runtime: SemeaiRuntime, state: GameState, firstPlayer: BoundedSemeaiFirstPlayer, maxNodes: number, checkpoint: () => Promise<boolean>): Promise<BoundedSemeaiOrderResult> => {
  const mover = firstPlayer === 'left' ? runtime.leftColor : runtime.rightColor;
  const search = await runAndOrSearchAsync(makePosition(asPlayingState(state, mover), mover, Object.freeze({ kind: 'lifted' as const })), buildAdapter(runtime), { maxNodes, shouldStop: runtime.shouldStop, cooperativeCheckpoint: checkpoint });
  return Object.freeze({ firstPlayer, outcome: mapOrderOutcome(search), search });
};

export const analyzeBoundedSemeai = (
  left: EndgameStoneString,
  right: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: BoundedSemeaiOptions = {},
): BoundedSemeaiResult => {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const prepared = prepare(left, right, state, topology, options);
  if (prepared.early) return prepared.early;
  const runtime = prepared.runtime!;
  const leftFirst = runOrder(runtime, state, 'left', maxNodes);
  const rightFirst = runtime.shouldStop() ? unavailableOrder('right', 'unknown-budget') : runOrder(runtime, state, 'right', maxNodes);
  return finishResult(prepared.left, prepared.right, prepared.sharedLiberties, runtime.zonePoints, prepared.leftZone, prepared.rightZone, leftFirst, rightFirst, 'at least one first-player order remains unresolved');
};

export const analyzeBoundedSemeaiAsync = async (
  left: EndgameStoneString,
  right: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: BoundedSemeaiOptions = {},
): Promise<BoundedSemeaiResult> => {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const checkpoint = options.cooperativeCheckpoint ?? (async () => options.shouldStop?.() ?? false);
  const prepared = prepare(left, right, state, topology, options);
  if (prepared.early) return prepared.early;
  const runtime = prepared.runtime!;
  const leftFirst = await runOrderAsync(runtime, state, 'left', maxNodes, checkpoint);
  const rightFirst = runtime.shouldStop() ? unavailableOrder('right', 'unknown-budget') : await runOrderAsync(runtime, state, 'right', maxNodes, checkpoint);
  return finishResult(prepared.left, prepared.right, prepared.sharedLiberties, runtime.zonePoints, prepared.leftZone, prepared.rightZone, leftFirst, rightFirst, 'at least one first-player order remains unresolved');
};
