import { GameEngine } from '../game/GameEngine';
import type { GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { proveBensonPassAlive } from './BensonPassAlive';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { compareEndgamePointIds } from './EndgameGroupIdentity';
import { buildRelevanceZone, type RelevanceZoneResult } from './RelevanceZone';
import {
  analyzeBoundedSemeai,
  type BoundedSemeaiOrderOutcome,
  type BoundedSemeaiResult,
} from './SemeaiSearch';

export const BASIC_SEKI_ALGORITHM = 'basic-seki-v1';

export type BasicSekiOutcome = 'seki' | 'ko-dependent' | 'unresolved';
export type BasicSekiSide = 'left' | 'right';
export type BasicSekiMoveOutcome =
  | 'initiator-loses'
  | 'initiator-wins'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-boundary'
  | 'unknown-cycle'
  | 'unknown-incomplete';
export type BasicSekiInitiationOutcome =
  | 'all-local-initiations-lose'
  | 'winning-initiation'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-boundary'
  | 'unknown-cycle'
  | 'unknown-incomplete';
export type BasicSekiReason =
  | 'stale-group'
  | 'same-color'
  | 'not-interacting'
  | 'no-shared-liberty'
  | 'independent-life'
  | 'unknown-boundary'
  | 'winning-initiation'
  | 'mixed-initiation-uncertainty'
  | null;

export interface BasicSekiOptions {
  /** Deterministic Work 7B node budget for each tested local initiation. */
  readonly maxNodes?: number;
  /** Maximum certified local conflict region size. */
  readonly maxZonePoints?: number;
}

export interface BasicSekiMoveResult {
  readonly point: PointId;
  readonly outcome: BasicSekiMoveOutcome;
  readonly continuation: BoundedSemeaiResult | null;
}

export interface BasicSekiInitiationResult {
  readonly initiator: BasicSekiSide;
  readonly outcome: BasicSekiInitiationOutcome;
  readonly moves: readonly BasicSekiMoveResult[];
}

export interface BasicSekiResult {
  readonly algorithm: typeof BASIC_SEKI_ALGORITHM;
  readonly proof: 'every-legal-local-initiation-is-losing';
  readonly outcome: BasicSekiOutcome;
  readonly reason: BasicSekiReason;
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
  readonly leftInitiation: BasicSekiInitiationResult;
  readonly rightInitiation: BasicSekiInitiationResult;
  readonly proofReason: string;
}

const DEFAULT_MAX_NODES = 20_000;
const DEFAULT_MAX_ZONE_POINTS = 96;

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

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const unavailableInitiation = (
  initiator: BasicSekiSide,
  outcome: Extract<
    BasicSekiInitiationOutcome,
    'unknown-boundary' | 'unknown-incomplete'
  >,
): BasicSekiInitiationResult =>
  Object.freeze({ initiator, outcome, moves: Object.freeze([]) });

const makeUnavailableResult = (
  left: EndgameStoneString,
  right: EndgameStoneString,
  reason: Exclude<BasicSekiReason, 'winning-initiation' | 'mixed-initiation-uncertainty' | null>,
  initiationOutcome: Extract<
    BasicSekiInitiationOutcome,
    'unknown-boundary' | 'unknown-incomplete'
  >,
  leftZone: RelevanceZoneResult | null,
  rightZone: RelevanceZoneResult | null,
  sharedLiberties: readonly PointId[],
  zonePoints: readonly PointId[],
  proofReason: string,
): BasicSekiResult =>
  Object.freeze({
    algorithm: BASIC_SEKI_ALGORITHM,
    proof: 'every-legal-local-initiation-is-losing' as const,
    outcome: 'unresolved' as const,
    reason,
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
    leftInitiation: unavailableInitiation('left', initiationOutcome),
    rightInitiation: unavailableInitiation('right', initiationOutcome),
    proofReason,
  });

const currentGroupFromCrucialStones = (
  state: GameState,
  topology: Topology,
  crucialStones: readonly PointId[],
  color: StoneColor,
): 'captured' | 'invalid' | EndgameStoneString => {
  const surviving = crucialStones.filter((point) => state.board[point] === color);
  if (surviving.length === 0) return 'captured';
  if (surviving.length !== crucialStones.length) return 'invalid';

  const graph = buildEndgameGraph(state.board, topology);
  const groupKey = graph.stringByPoint.get(surviving[0]!);
  const group = groupKey ? graph.stringsByKey.get(groupKey) : undefined;
  if (!group || group.color !== color) return 'invalid';
  if (!crucialStones.every((point) => group.points.includes(point))) return 'invalid';
  return group;
};

/**
 * An initiation-created restoring simple ko must retain exact previous-board
 * context. Work 7B starts a new root with lifted ko context, so 7C checks this
 * boundary before delegating the continuation.
 */
const createsImmediateSimpleKo = (
  engine: GameEngine,
  stateBeforeInitiation: GameState,
  stateAfterInitiation: GameState,
  responder: StoneColor,
  zonePoints: readonly PointId[],
): boolean => {
  for (const point of zonePoints) {
    if (stateAfterInitiation.board[point] !== 'empty') continue;
    const recapture = engine.placeStone(
      asPlayingState(stateAfterInitiation, responder),
      point,
      responder,
      { previousBoard: stateBeforeInitiation.board },
    );
    if (!recapture.ok && recapture.reason === 'repetition') return true;
  }
  return false;
};

const mapContinuationOutcome = (
  initiator: BasicSekiSide,
  outcome: BoundedSemeaiOrderOutcome,
): BasicSekiMoveOutcome => {
  switch (outcome) {
    case 'left-wins':
      return initiator === 'left' ? 'initiator-wins' : 'initiator-loses';
    case 'right-wins':
      return initiator === 'right' ? 'initiator-wins' : 'initiator-loses';
    case 'ko-dependent':
    case 'unknown-budget':
    case 'unknown-boundary':
    case 'unknown-cycle':
    case 'unknown-incomplete':
      return outcome;
  }
};

const summarizeInitiationOutcome = (
  moves: readonly BasicSekiMoveResult[],
): BasicSekiInitiationOutcome => {
  if (moves.length === 0) return 'unknown-incomplete';
  if (moves.some((move) => move.outcome === 'initiator-wins')) return 'winning-initiation';
  if (moves.some((move) => move.outcome === 'ko-dependent')) return 'ko-dependent';
  if (moves.some((move) => move.outcome === 'unknown-boundary')) return 'unknown-boundary';
  if (moves.some((move) => move.outcome === 'unknown-budget')) return 'unknown-budget';
  if (moves.some((move) => move.outcome === 'unknown-incomplete')) return 'unknown-incomplete';
  if (moves.some((move) => move.outcome === 'unknown-cycle')) return 'unknown-cycle';
  return 'all-local-initiations-lose';
};

const analyzeInitiations = (
  initiator: BasicSekiSide,
  left: EndgameStoneString,
  right: EndgameStoneString,
  state: GameState,
  topology: Topology,
  zonePoints: readonly PointId[],
  maxNodes: number,
  maxZonePoints: number,
): BasicSekiInitiationResult => {
  const engine = new GameEngine(topology);
  const initiatorColor = initiator === 'left' ? left.color : right.color;
  const responderColor = opponentOf(initiatorColor);
  const leftCrucialStones = sortedPoints(left.points);
  const rightCrucialStones = sortedPoints(right.points);
  const zonePointSet = new Set(zonePoints);
  const moves: BasicSekiMoveResult[] = [];

  for (const point of zonePoints) {
    if (state.board[point] !== 'empty') continue;
    const played = engine.placeStone(
      asPlayingState(state, initiatorColor),
      point,
      initiatorColor,
    );
    if (!played.ok) continue;

    const opponentCrucialStones = initiator === 'left' ? rightCrucialStones : leftCrucialStones;
    const opponentColor = initiator === 'left' ? right.color : left.color;
    if (opponentCrucialStones.every((stone) => played.state.board[stone] !== opponentColor)) {
      moves.push(Object.freeze({ point, outcome: 'initiator-wins' as const, continuation: null }));
      continue;
    }

    if (createsImmediateSimpleKo(engine, state, played.state, responderColor, zonePoints)) {
      moves.push(Object.freeze({ point, outcome: 'ko-dependent' as const, continuation: null }));
      continue;
    }

    const currentLeft = currentGroupFromCrucialStones(
      played.state,
      topology,
      leftCrucialStones,
      left.color,
    );
    const currentRight = currentGroupFromCrucialStones(
      played.state,
      topology,
      rightCrucialStones,
      right.color,
    );
    if (
      currentLeft === 'captured' ||
      currentRight === 'captured' ||
      currentLeft === 'invalid' ||
      currentRight === 'invalid'
    ) {
      moves.push(
        Object.freeze({ point, outcome: 'unknown-incomplete' as const, continuation: null }),
      );
      continue;
    }

    const continuation = analyzeBoundedSemeai(
      currentLeft,
      currentRight,
      played.state,
      topology,
      { maxNodes, maxZonePoints },
    );
    if (!continuation.zonePoints.every((zonePoint) => zonePointSet.has(zonePoint))) {
      moves.push(
        Object.freeze({ point, outcome: 'unknown-boundary' as const, continuation }),
      );
      continue;
    }

    const responderOrder = initiator === 'left' ? continuation.rightFirst : continuation.leftFirst;
    moves.push(
      Object.freeze({
        point,
        outcome: mapContinuationOutcome(initiator, responderOrder.outcome),
        continuation,
      }),
    );
  }

  const frozenMoves = Object.freeze(moves);
  return Object.freeze({
    initiator,
    outcome: summarizeInitiationOutcome(frozenMoves),
    moves: frozenMoves,
  });
};

/**
 * Work 7C strict sufficient proof for a deliberately narrow basic-seki class.
 *
 * A position is labelled seki only when both non-Benson opposing targets share
 * liberties inside one certified bounded conflict region and exhaustive testing
 * of every legal local first move shows the same game-theoretic fact: after the
 * move, the opponent can force-capture the initiator's target before losing its
 * own target. Tenuki/pass is the safe alternative that leaves local occupancy
 * unchanged. Failure to prove any one initiation losing does not become seki.
 *
 * This is intentionally stronger than "7B found no winner". Budget, boundary,
 * cycle, incomplete and ko uncertainty all fail closed, and classifier
 * integration remains Work 7D.
 */
export const analyzeBasicSeki = (
  suppliedLeft: EndgameStoneString,
  suppliedRight: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: BasicSekiOptions = {},
): BasicSekiResult => {
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
      Object.freeze([]),
      'seki requires opposing target groups',
    );
  }

  const directlyAdjacent = graph.opponentAdjacencies.some((entry) =>
    pairMatches(entry.groups, currentLeft.key, currentRight.key),
  );
  const sharedLiberties = sortedPoints(
    graph.sharedLiberties
      .filter((entry) => pairMatches(entry.groups, currentLeft.key, currentRight.key))
      .flatMap((entry) => entry.liberties),
  );
  if (!directlyAdjacent && sharedLiberties.length === 0) {
    return makeUnavailableResult(
      currentLeft,
      currentRight,
      'not-interacting',
      'unknown-incomplete',
      null,
      null,
      sharedLiberties,
      Object.freeze([]),
      'the supplied targets do not directly interact by adjacency or shared liberty',
    );
  }

  if (sharedLiberties.length === 0) {
    return makeUnavailableResult(
      currentLeft,
      currentRight,
      'no-shared-liberty',
      'unknown-incomplete',
      null,
      null,
      sharedLiberties,
      Object.freeze([]),
      'basic-seki-v1 requires explicit shared-liberty mutual dependence',
    );
  }

  const leftBenson = proveBensonPassAlive(
    state.board,
    topology,
    graph,
    currentLeft.color,
  ).has(currentLeft.key);
  const rightBenson = proveBensonPassAlive(
    state.board,
    topology,
    graph,
    currentRight.color,
  ).has(currentRight.key);
  if (leftBenson || rightBenson) {
    return makeUnavailableResult(
      currentLeft,
      currentRight,
      'independent-life',
      'unknown-incomplete',
      null,
      null,
      sharedLiberties,
      Object.freeze([]),
      'at least one target is independently Benson/pass-alive rather than mutually dependent',
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
      sharedLiberties,
      zonePoints,
      'the mutually dependent targets do not fit inside one certified bounded conflict region',
    );
  }

  const leftInitiation = analyzeInitiations(
    'left',
    currentLeft,
    currentRight,
    state,
    topology,
    zonePoints,
    maxNodes,
    maxZonePoints,
  );
  const rightInitiation = analyzeInitiations(
    'right',
    currentLeft,
    currentRight,
    state,
    topology,
    zonePoints,
    maxNodes,
    maxZonePoints,
  );

  let outcome: BasicSekiOutcome = 'unresolved';
  let reason: BasicSekiReason = 'mixed-initiation-uncertainty';
  let proofReason = 'at least one legal local initiation is not proved losing';

  if (
    leftInitiation.outcome === 'all-local-initiations-lose' &&
    rightInitiation.outcome === 'all-local-initiations-lose'
  ) {
    outcome = 'seki';
    reason = null;
    proofReason =
      'every legal local initiation by either side lets the responder force-capture the initiator; tenuki preserves both targets';
  } else if (
    leftInitiation.outcome === 'winning-initiation' ||
    rightInitiation.outcome === 'winning-initiation'
  ) {
    reason = 'winning-initiation';
    proofReason = 'at least one side has a legal local initiation that defeats mutual restraint';
  } else if (
    leftInitiation.outcome === 'ko-dependent' ||
    rightInitiation.outcome === 'ko-dependent'
  ) {
    outcome = 'ko-dependent';
    reason = null;
    proofReason = 'at least one required initiation/response proof depends on simple ko';
  } else if (
    leftInitiation.outcome === 'unknown-boundary' ||
    rightInitiation.outcome === 'unknown-boundary'
  ) {
    reason = 'unknown-boundary';
    proofReason = 'at least one initiation continuation escapes the certified conflict region';
  }

  return Object.freeze({
    algorithm: BASIC_SEKI_ALGORITHM,
    proof: 'every-legal-local-initiation-is-losing' as const,
    outcome,
    reason,
    leftGroupKey: currentLeft.key,
    rightGroupKey: currentRight.key,
    leftColor: currentLeft.color,
    rightColor: currentRight.color,
    leftCrucialStones: sortedPoints(currentLeft.points),
    rightCrucialStones: sortedPoints(currentRight.points),
    sharedLiberties,
    zonePoints,
    leftZone,
    rightZone,
    leftInitiation,
    rightInitiation,
    proofReason,
  });
};
