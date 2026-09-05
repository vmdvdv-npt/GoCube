import { GameEngine } from '../game/GameEngine';
import type { GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { tryProveBensonPassAlive } from './BensonPassAlive';
import {
  tryBuildEndgameStaticGraph,
  type EndgameStaticGraph,
  type EndgameStoneString,
} from './EndgameStaticGraph';
import { compareEndgamePointIds } from './EndgameGroupIdentity';
import {
  buildRelevanceZone,
  collectBensonSafeGroupKeys,
  type RelevanceZoneResult,
} from './RelevanceZone';
import {
  analyzeBoundedSemeaiAsync,
  type BoundedSemeaiOrderOutcome,
  type BoundedSemeaiResult,
} from './SemeaiSearch';

export const DYNAMIC_SEKI_ALGORITHM = 'dynamic-seki-v1';

export type DynamicSekiOutcome = 'seki' | 'ko-dependent' | 'unresolved';
export type DynamicSekiSide = 'left' | 'right';
export type DynamicSekiMoveOutcome =
  | 'initiator-loses'
  | 'initiator-wins'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-boundary'
  | 'unknown-cycle'
  | 'unknown-incomplete';
export type DynamicSekiInitiationOutcome =
  | 'all-local-initiations-lose'
  | 'winning-initiation'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-boundary'
  | 'unknown-cycle'
  | 'unknown-incomplete';
export type DynamicSekiReason =
  | 'stale-group'
  | 'same-color'
  | 'not-interacting'
  | 'no-shared-liberty'
  | 'independent-life'
  | 'unknown-boundary'
  | 'third-group-interference'
  | 'winning-initiation'
  | 'mixed-initiation-uncertainty'
  | 'budget'
  | null;

export interface DynamicSekiOptions {
  readonly maxNodes?: number;
  readonly maxZonePoints?: number;
  readonly shouldStop?: () => boolean;
  readonly cooperativeCheckpoint?: () => Promise<boolean>;
}

export interface DynamicSekiMoveResult {
  readonly point: PointId;
  readonly outcome: DynamicSekiMoveOutcome;
  readonly continuation: BoundedSemeaiResult | null;
}

export interface DynamicSekiInitiationResult {
  readonly initiator: DynamicSekiSide;
  readonly outcome: DynamicSekiInitiationOutcome;
  readonly moves: readonly DynamicSekiMoveResult[];
}

export interface DynamicSekiResult {
  readonly algorithm: typeof DYNAMIC_SEKI_ALGORITHM;
  readonly proof: 'every-legal-local-initiation-is-losing';
  readonly outcome: DynamicSekiOutcome;
  readonly reason: DynamicSekiReason;
  readonly participatingGroupIds: readonly [string, string];
  readonly leftGroupKey: string;
  readonly rightGroupKey: string;
  readonly leftColor: StoneColor;
  readonly rightColor: StoneColor;
  readonly leftCrucialStones: readonly PointId[];
  readonly rightCrucialStones: readonly PointId[];
  readonly sharedLiberties: readonly PointId[];
  readonly certifiedZone: readonly PointId[];
  readonly leftZone: RelevanceZoneResult | null;
  readonly rightZone: RelevanceZoneResult | null;
  readonly thirdGroupKeys: readonly string[];
  readonly leftInitiation: DynamicSekiInitiationResult;
  readonly rightInitiation: DynamicSekiInitiationResult;
  readonly exploredNodes: number;
  readonly proofReason: string;
}

const DEFAULT_MAX_NODES = 6_000;
const DEFAULT_MAX_ZONE_POINTS = 96;
const sortedPoints = (points: Iterable<PointId>): readonly PointId[] =>
  Object.freeze([...points].sort(compareEndgamePointIds));
const sortedStrings = (values: Iterable<string>): readonly string[] =>
  Object.freeze([...values].sort());
const samePoints = (left: readonly PointId[], right: readonly PointId[]): boolean =>
  left.length === right.length && left.every((point, index) => point === right[index]);
const opponentOf = (color: StoneColor): StoneColor => color === 'black' ? 'white' : 'black';

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

const unavailableInitiation = (
  initiator: DynamicSekiSide,
  outcome: Extract<DynamicSekiInitiationOutcome, 'unknown-boundary' | 'unknown-incomplete' | 'unknown-budget'>,
): DynamicSekiInitiationResult => Object.freeze({ initiator, outcome, moves: Object.freeze([]) });

const makeResult = (
  left: EndgameStoneString,
  right: EndgameStoneString,
  sharedLiberties: readonly PointId[],
  zone: readonly PointId[],
  leftZone: RelevanceZoneResult | null,
  rightZone: RelevanceZoneResult | null,
  thirdGroupKeys: readonly string[],
  leftInitiation: DynamicSekiInitiationResult,
  rightInitiation: DynamicSekiInitiationResult,
  outcome: DynamicSekiOutcome,
  reason: DynamicSekiReason,
  proofReason: string,
): DynamicSekiResult => {
  const exploredNodes = [...leftInitiation.moves, ...rightInitiation.moves]
    .reduce((sum, move) => sum + (move.continuation?.exploredNodes ?? 0), 0);
  return Object.freeze({
    algorithm: DYNAMIC_SEKI_ALGORITHM,
    proof: 'every-legal-local-initiation-is-losing' as const,
    outcome,
    reason,
    participatingGroupIds: Object.freeze([left.key, right.key] as [string, string]),
    leftGroupKey: left.key,
    rightGroupKey: right.key,
    leftColor: left.color,
    rightColor: right.color,
    leftCrucialStones: sortedPoints(left.points),
    rightCrucialStones: sortedPoints(right.points),
    sharedLiberties,
    certifiedZone: zone,
    leftZone,
    rightZone,
    thirdGroupKeys,
    leftInitiation,
    rightInitiation,
    exploredNodes,
    proofReason,
  });
};

const currentGroupFromCrucialStones = (
  state: GameState,
  topology: Topology,
  crucialStones: readonly PointId[],
  color: StoneColor,
  shouldStop: () => boolean,
): 'captured' | 'invalid' | EndgameStoneString => {
  const surviving = crucialStones.filter((point) => state.board[point] === color);
  if (surviving.length === 0) return 'captured';
  if (surviving.length !== crucialStones.length) return 'invalid';
  const graph = tryBuildEndgameStaticGraph(state.board, topology, { shouldStop });
  if (!graph) return 'invalid';
  const key = graph.stringByPoint.get(surviving[0]!);
  const group = key ? graph.stringsByKey.get(key) : undefined;
  if (!group || group.color !== color || !crucialStones.every((point) => group.points.includes(point))) return 'invalid';
  return group;
};

const createsImmediateSimpleKo = (
  engine: GameEngine,
  before: GameState,
  after: GameState,
  responder: StoneColor,
  zone: readonly PointId[],
  shouldStop: () => boolean,
): 'clear' | 'ko' | 'budget' => {
  for (const point of zone) {
    if (shouldStop()) return 'budget';
    if (after.board[point] !== 'empty') continue;
    const recapture = engine.placeStone(asPlayingState(after, responder), point, responder, { previousBoard: before.board });
    if (!recapture.ok && recapture.reason === 'repetition') return 'ko';
  }
  return 'clear';
};

const mapContinuationOutcome = (
  initiator: DynamicSekiSide,
  outcome: BoundedSemeaiOrderOutcome,
): DynamicSekiMoveOutcome => {
  switch (outcome) {
    case 'left-wins': return initiator === 'left' ? 'initiator-wins' : 'initiator-loses';
    case 'right-wins': return initiator === 'right' ? 'initiator-wins' : 'initiator-loses';
    case 'ko-dependent': return 'ko-dependent';
    case 'unknown-budget': return 'unknown-budget';
    case 'unknown-boundary': return 'unknown-boundary';
    case 'unknown-cycle': return 'unknown-cycle';
    case 'unknown-incomplete': return 'unknown-incomplete';
  }
};

const summarizeInitiationOutcome = (moves: readonly DynamicSekiMoveResult[]): DynamicSekiInitiationOutcome => {
  if (moves.length === 0) return 'unknown-incomplete';
  if (moves.some((move) => move.outcome === 'initiator-wins')) return 'winning-initiation';
  if (moves.some((move) => move.outcome === 'ko-dependent')) return 'ko-dependent';
  if (moves.some((move) => move.outcome === 'unknown-boundary')) return 'unknown-boundary';
  if (moves.some((move) => move.outcome === 'unknown-budget')) return 'unknown-budget';
  if (moves.some((move) => move.outcome === 'unknown-incomplete')) return 'unknown-incomplete';
  if (moves.some((move) => move.outcome === 'unknown-cycle')) return 'unknown-cycle';
  return 'all-local-initiations-lose';
};

const analyzeInitiations = async (
  initiator: DynamicSekiSide,
  left: EndgameStoneString,
  right: EndgameStoneString,
  state: GameState,
  topology: Topology,
  zone: readonly PointId[],
  maxNodes: number,
  maxZonePoints: number,
  shouldStop: () => boolean,
  checkpoint: () => Promise<boolean>,
): Promise<DynamicSekiInitiationResult> => {
  const engine = new GameEngine(topology);
  const initiatorColor = initiator === 'left' ? left.color : right.color;
  const responderColor = opponentOf(initiatorColor);
  const leftCrucialStones = sortedPoints(left.points);
  const rightCrucialStones = sortedPoints(right.points);
  const zoneSet = new Set(zone);
  const moves: DynamicSekiMoveResult[] = [];

  for (const point of zone) {
    if (await checkpoint() || shouldStop()) {
      moves.push(Object.freeze({ point, outcome: 'unknown-budget' as const, continuation: null }));
      break;
    }
    if (state.board[point] !== 'empty') continue;
    const played = engine.placeStone(asPlayingState(state, initiatorColor), point, initiatorColor);
    if (!played.ok) continue;

    const opponentCrucial = initiator === 'left' ? rightCrucialStones : leftCrucialStones;
    const opponentColor = initiator === 'left' ? right.color : left.color;
    if (opponentCrucial.every((stone) => played.state.board[stone] !== opponentColor)) {
      moves.push(Object.freeze({ point, outcome: 'initiator-wins' as const, continuation: null }));
      continue;
    }

    const ko = createsImmediateSimpleKo(engine, state, played.state, responderColor, zone, shouldStop);
    if (ko === 'budget') {
      moves.push(Object.freeze({ point, outcome: 'unknown-budget' as const, continuation: null }));
      break;
    }
    if (ko === 'ko') {
      moves.push(Object.freeze({ point, outcome: 'ko-dependent' as const, continuation: null }));
      continue;
    }

    const currentLeft = currentGroupFromCrucialStones(played.state, topology, leftCrucialStones, left.color, shouldStop);
    const currentRight = currentGroupFromCrucialStones(played.state, topology, rightCrucialStones, right.color, shouldStop);
    if (currentLeft === 'captured' || currentRight === 'captured' || currentLeft === 'invalid' || currentRight === 'invalid') {
      moves.push(Object.freeze({ point, outcome: shouldStop() ? 'unknown-budget' as const : 'unknown-incomplete' as const, continuation: null }));
      continue;
    }

    const continuation = await analyzeBoundedSemeaiAsync(currentLeft, currentRight, played.state, topology, {
      maxNodes,
      maxZonePoints,
      shouldStop,
      cooperativeCheckpoint: checkpoint,
    });
    if (!continuation.zonePoints.every((zonePoint) => zoneSet.has(zonePoint))) {
      moves.push(Object.freeze({ point, outcome: 'unknown-boundary' as const, continuation }));
      continue;
    }

    const responderOrder = initiator === 'left' ? continuation.rightFirst : continuation.leftFirst;
    moves.push(Object.freeze({ point, outcome: mapContinuationOutcome(initiator, responderOrder.outcome), continuation }));
  }

  const frozenMoves = Object.freeze(moves);
  return Object.freeze({ initiator, outcome: summarizeInitiationOutcome(frozenMoves), moves: frozenMoves });
};

const findThirdGroupInterference = (
  graph: EndgameStaticGraph,
  left: EndgameStoneString,
  right: EndgameStoneString,
  zone: readonly PointId[],
  safeGroupKeys: ReadonlySet<string>,
): readonly string[] => {
  const zoneSet = new Set(zone);
  const third = new Set<string>();
  for (const group of graph.strings) {
    if (group.key === left.key || group.key === right.key || safeGroupKeys.has(group.key)) continue;
    if (group.points.some((point) => zoneSet.has(point)) || group.liberties.some((point) => zoneSet.has(point))) third.add(group.key);
  }
  return sortedStrings(third);
};

export const analyzeDynamicSeki = async (
  suppliedLeft: EndgameStoneString,
  suppliedRight: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: DynamicSekiOptions = {},
): Promise<DynamicSekiResult> => {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxZonePoints = options.maxZonePoints ?? DEFAULT_MAX_ZONE_POINTS;
  const shouldStop = options.shouldStop ?? (() => false);
  const checkpoint = options.cooperativeCheckpoint ?? (async () => shouldStop());
  const unavailable = (left: EndgameStoneString, right: EndgameStoneString, reason: DynamicSekiReason, outcome: Extract<DynamicSekiInitiationOutcome, 'unknown-boundary' | 'unknown-incomplete' | 'unknown-budget'>, proofReason: string, shared: readonly PointId[] = Object.freeze([]), zone: readonly PointId[] = Object.freeze([]), leftZone: RelevanceZoneResult | null = null, rightZone: RelevanceZoneResult | null = null, third: readonly string[] = Object.freeze([])): DynamicSekiResult =>
    makeResult(left, right, shared, zone, leftZone, rightZone, third, unavailableInitiation('left', outcome), unavailableInitiation('right', outcome), 'unresolved', reason, proofReason);

  if (shouldStop()) return unavailable(suppliedLeft, suppliedRight, 'budget', 'unknown-budget', 'shared hard deadline reached before dynamic seki preparation');
  const graph = tryBuildEndgameStaticGraph(state.board, topology, { shouldStop });
  if (!graph) return unavailable(suppliedLeft, suppliedRight, 'budget', 'unknown-budget', 'graph preparation was interrupted');
  const currentLeft = graph.stringsByKey.get(suppliedLeft.key);
  const currentRight = graph.stringsByKey.get(suppliedRight.key);
  const left = currentLeft ?? suppliedLeft;
  const right = currentRight ?? suppliedRight;
  if (!currentGroupMatches(suppliedLeft, currentLeft) || !currentGroupMatches(suppliedRight, currentRight)) {
    return unavailable(left, right, 'stale-group', 'unknown-incomplete', 'one or both supplied target groups no longer match the board snapshot');
  }
  if (left.color === right.color) return unavailable(left, right, 'same-color', 'unknown-incomplete', 'dynamic seki requires opposing target groups');

  const rightLiberties = new Set(right.liberties);
  const sharedLiberties = sortedPoints(left.liberties.filter((point) => rightLiberties.has(point)));
  const rightPointSet = new Set(right.points);
  const directlyAdjacent = left.points.some((point) => topology.neighbors(point).some((neighbor) => rightPointSet.has(neighbor)));
  if (!directlyAdjacent && sharedLiberties.length === 0) return unavailable(left, right, 'not-interacting', 'unknown-incomplete', 'targets do not interact by adjacency or shared liberty', sharedLiberties);
  if (sharedLiberties.length === 0) return unavailable(left, right, 'no-shared-liberty', 'unknown-incomplete', 'strict dynamic seki requires explicit shared-liberty mutual dependence', sharedLiberties);

  const leftBenson = tryProveBensonPassAlive(state.board, topology, graph, left.color, { shouldStop });
  const rightBenson = tryProveBensonPassAlive(state.board, topology, graph, right.color, { shouldStop });
  if (!leftBenson || !rightBenson) return unavailable(left, right, 'budget', 'unknown-budget', 'Benson independence check was interrupted', sharedLiberties);
  if (leftBenson.aliveGroups.has(left.key) || rightBenson.aliveGroups.has(right.key)) {
    return unavailable(left, right, 'independent-life', 'unknown-incomplete', 'at least one target is independently Benson/pass-alive', sharedLiberties);
  }

  const safeGroupKeys = collectBensonSafeGroupKeys(state.board, topology, graph, shouldStop);
  if (!safeGroupKeys) return unavailable(left, right, 'budget', 'unknown-budget', 'Benson boundary preparation was interrupted', sharedLiberties);
  const leftZone = buildRelevanceZone(left, state.board, topology, { maxPoints: maxZonePoints, graph, safeGroupKeys, shouldStop });
  const rightZone = buildRelevanceZone(right, state.board, topology, { maxPoints: maxZonePoints, graph, safeGroupKeys, shouldStop });
  const zone = sortedPoints(new Set([...leftZone.points, ...rightZone.points]));
  if (leftZone.reason === 'interrupted' || rightZone.reason === 'interrupted') {
    return unavailable(left, right, 'budget', 'unknown-budget', 'zone certification was interrupted', sharedLiberties, zone, leftZone, rightZone);
  }
  if (leftZone.outcome !== 'bounded' || rightZone.outcome !== 'bounded' || zone.length > maxZonePoints) {
    return unavailable(left, right, 'unknown-boundary', 'unknown-boundary', 'mutually dependent targets do not fit inside one certified bounded conflict region', sharedLiberties, zone, leftZone, rightZone);
  }

  const thirdGroupKeys = findThirdGroupInterference(graph, left, right, zone, safeGroupKeys);
  if (thirdGroupKeys.length > 0) {
    return unavailable(left, right, 'third-group-interference', 'unknown-incomplete', 'a non-pass-alive third group participates in the certified conflict region; pairwise seki is not sound', sharedLiberties, zone, leftZone, rightZone, thirdGroupKeys);
  }

  const leftInitiation = await analyzeInitiations('left', left, right, state, topology, zone, maxNodes, maxZonePoints, shouldStop, checkpoint);
  const rightInitiation = shouldStop()
    ? unavailableInitiation('right', 'unknown-budget')
    : await analyzeInitiations('right', left, right, state, topology, zone, maxNodes, maxZonePoints, shouldStop, checkpoint);

  if (leftInitiation.outcome === 'all-local-initiations-lose' && rightInitiation.outcome === 'all-local-initiations-lose') {
    return makeResult(left, right, sharedLiberties, zone, leftZone, rightZone, thirdGroupKeys, leftInitiation, rightInitiation, 'seki', null, 'every legal local initiation by either side is proved losing for the initiator; tenuki preserves both crucial groups');
  }
  if (leftInitiation.outcome === 'winning-initiation' || rightInitiation.outcome === 'winning-initiation') {
    return makeResult(left, right, sharedLiberties, zone, leftZone, rightZone, thirdGroupKeys, leftInitiation, rightInitiation, 'unresolved', 'winning-initiation', 'at least one side has a legal local initiation that defeats mutual restraint');
  }
  if (leftInitiation.outcome === 'ko-dependent' || rightInitiation.outcome === 'ko-dependent') {
    return makeResult(left, right, sharedLiberties, zone, leftZone, rightZone, thirdGroupKeys, leftInitiation, rightInitiation, 'ko-dependent', null, 'at least one required initiation/response proof depends on simple ko');
  }
  const reason: DynamicSekiReason = leftInitiation.outcome === 'unknown-boundary' || rightInitiation.outcome === 'unknown-boundary'
    ? 'unknown-boundary'
    : leftInitiation.outcome === 'unknown-budget' || rightInitiation.outcome === 'unknown-budget'
      ? 'budget'
      : 'mixed-initiation-uncertainty';
  return makeResult(left, right, sharedLiberties, zone, leftZone, rightZone, thirdGroupKeys, leftInitiation, rightInitiation, 'unresolved', reason, 'at least one legal local initiation is not completely proved losing');
};
