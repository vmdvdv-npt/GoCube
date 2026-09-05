import { GameEngine, type StoneGroup } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import {
  runAndOrSearch,
  runAndOrSearchAsync,
  type AndOrProofTrace,
  type AndOrSearchAdapter,
  type AndOrSearchResult,
} from './AndOrSearchCore';
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

export const LOCAL_LIFE_DEATH_ALGORITHM = 'local-life-death-v2';

export type LocalLifeDeathFirstPlayer = 'attacker' | 'defender';
export type LocalLifeDeathOrderOutcome =
  | 'proved-dead'
  | 'proved-alive'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-boundary'
  | 'unknown-cycle'
  | 'unknown-incomplete';
export type LocalLifeDeathOutcome = 'proved-dead' | 'proved-alive' | 'unknown';

export interface LocalLifeDeathOptions {
  readonly maxNodes?: number;
  readonly maxZonePoints?: number;
  readonly shouldStop?: () => boolean;
  readonly cooperativeCheckpoint?: () => Promise<boolean>;
}

export interface LocalLifeDeathOrderResult {
  readonly firstPlayer: LocalLifeDeathFirstPlayer;
  readonly outcome: LocalLifeDeathOrderOutcome;
  readonly search: AndOrSearchResult | null;
}

export interface LocalLifeDeathResult {
  readonly algorithm: typeof LOCAL_LIFE_DEATH_ALGORITHM;
  readonly outcome: LocalLifeDeathOutcome;
  readonly targetGroupKey: string;
  readonly crucialStones: readonly PointId[];
  readonly zone: RelevanceZoneResult;
  readonly attackerFirst: LocalLifeDeathOrderResult;
  readonly defenderFirst: LocalLifeDeathOrderResult;
  readonly proofReason: string;
}

const DEFAULT_MAX_NODES = 10_000;
const DEFAULT_MAX_ZONE_POINTS = 96;
type UncertainReason = 'boundary' | 'ko' | 'incomplete' | 'budget';
type KoContext =
  | Readonly<{ readonly kind: 'root-unknown' }>
  | Readonly<{ readonly kind: 'lifted' }>
  | Readonly<{ readonly kind: 'exact'; readonly previousBoard: BoardOccupancy }>;

type LocalSearchState =
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

type TargetStatus = 'intact' | 'captured' | 'invalid';
interface TargetSnapshot {
  readonly graph: EndgameStaticGraph | null;
  readonly status: TargetStatus;
  readonly group: EndgameStoneString | null;
  readonly bensonAlive: boolean;
}

interface LocalRuntime {
  readonly topology: Topology;
  readonly engine: GameEngine;
  readonly targetColor: StoneColor;
  readonly attackerColor: StoneColor;
  readonly crucialStones: readonly PointId[];
  readonly initialZone: RelevanceZoneResult;
  readonly zonePoints: readonly PointId[];
  readonly zonePointSet: ReadonlySet<PointId>;
  readonly maxZonePoints: number;
  readonly shouldStop: () => boolean;
  readonly terminalCache: Map<string, TargetSnapshot>;
}

const opponentOf = (color: StoneColor): StoneColor => color === 'black' ? 'white' : 'black';

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

const targetSnapshot = (runtime: LocalRuntime, state: GameState): TargetSnapshot => {
  const cacheKey = occupancySignature(state.board, runtime.zonePoints);
  const cached = runtime.terminalCache.get(cacheKey);
  if (cached) return cached;
  if (runtime.shouldStop()) {
    return Object.freeze({ graph: null, status: 'invalid' as const, group: null, bensonAlive: false });
  }

  const surviving = runtime.crucialStones.filter((point) => state.board[point] === runtime.targetColor);
  if (surviving.length === 0) {
    const captured = Object.freeze({ graph: null, status: 'captured' as const, group: null, bensonAlive: false });
    runtime.terminalCache.set(cacheKey, captured);
    return captured;
  }
  if (surviving.length !== runtime.crucialStones.length) {
    return Object.freeze({ graph: null, status: 'invalid' as const, group: null, bensonAlive: false });
  }

  const graph = tryBuildEndgameStaticGraph(state.board, runtime.topology, { shouldStop: runtime.shouldStop });
  if (!graph) return Object.freeze({ graph: null, status: 'invalid' as const, group: null, bensonAlive: false });
  const groupKey = graph.stringByPoint.get(surviving[0]!);
  const group = groupKey ? graph.stringsByKey.get(groupKey) ?? null : null;
  if (!group || !runtime.crucialStones.every((point) => group.points.includes(point))) {
    return Object.freeze({ graph, status: 'invalid' as const, group: null, bensonAlive: false });
  }
  const benson = tryProveBensonPassAlive(
    state.board,
    runtime.topology,
    graph,
    runtime.targetColor,
    { shouldStop: runtime.shouldStop },
  );
  if (!benson) return Object.freeze({ graph, status: 'invalid' as const, group, bensonAlive: false });
  const snapshot = Object.freeze({
    graph,
    status: 'intact' as const,
    group,
    bensonAlive: benson.aliveGroups.has(group.key),
  });
  runtime.terminalCache.set(cacheKey, snapshot);
  return snapshot;
};

const groupAtCrucialStone = (runtime: LocalRuntime, state: GameState): StoneGroup | null => {
  const survivingStone = runtime.crucialStones.find((point) => state.board[point] === runtime.targetColor);
  return survivingStone ? runtime.engine.groupAt(state, survivingStone) : null;
};

const isStillInsideCertifiedZone = (runtime: LocalRuntime, state: GameState): boolean => {
  if (runtime.shouldStop()) return false;
  const snapshot = targetSnapshot(runtime, state);
  if (snapshot.status === 'captured' || snapshot.bensonAlive) return true;
  if (snapshot.status !== 'intact' || !snapshot.group || !snapshot.graph) return false;
  const currentZone = buildRelevanceZone(snapshot.group, state.board, runtime.topology, {
    maxPoints: runtime.maxZonePoints,
    graph: snapshot.graph,
    shouldStop: runtime.shouldStop,
  });
  return currentZone.outcome === 'bounded' && currentZone.points.every((point) => runtime.zonePointSet.has(point));
};

const createsSimpleKo = (runtime: LocalRuntime, before: GameState, after: GameState): 'clear' | 'ko' | 'budget' => {
  const recapturer = after.currentPlayer;
  for (const point of runtime.zonePoints) {
    if (runtime.shouldStop()) return 'budget';
    if (after.board[point] !== 'empty') continue;
    const recapture = runtime.engine.placeStone(
      asPlayingState(after, recapturer),
      point,
      recapturer,
      { previousBoard: before.board },
    );
    if (!recapture.ok && recapture.reason === 'repetition') return 'ko';
  }
  return 'clear';
};

const stateKey = (runtime: LocalRuntime, state: LocalSearchState): string => {
  if (state.kind === 'uncertain') return `uncertain|${state.reason}|${state.mover}`;
  const current = occupancySignature(state.state.board, runtime.zonePoints);
  const ko = state.koContext.kind === 'exact'
    ? `exact:${occupancySignature(state.koContext.previousBoard, runtime.zonePoints)}`
    : state.koContext.kind;
  return `${runtime.initialZone.localPositionKey}|${state.mover}|${ko}|${current}`;
};

const makeUncertain = (reason: UncertainReason, mover: StoneColor): LocalSearchState =>
  Object.freeze({ kind: 'uncertain' as const, reason, mover });
const makePosition = (state: GameState, mover: StoneColor, koContext: KoContext): LocalSearchState =>
  Object.freeze({ kind: 'position' as const, state, mover, koContext });

const moveResultContext = (state: LocalSearchState): Readonly<{ readonly previousBoard: BoardOccupancy | null }> => {
  if (state.kind !== 'position' || state.koContext.kind !== 'exact') return Object.freeze({ previousBoard: null });
  return Object.freeze({ previousBoard: state.koContext.previousBoard });
};

const childOrderingMetric = (
  runtime: LocalRuntime,
  childState: GameState,
  mover: StoneColor,
  capturedCount: number,
): readonly [number, number, number] => {
  const snapshot = targetSnapshot(runtime, childState);
  if (snapshot.status === 'captured') return mover === runtime.attackerColor ? [-3, 0, -capturedCount] : [3, 0, -capturedCount];
  if (snapshot.status === 'invalid') return [2, 0, -capturedCount];
  if (snapshot.bensonAlive) return mover === runtime.targetColor ? [-3, 0, -capturedCount] : [3, 0, -capturedCount];
  const liberties = groupAtCrucialStone(runtime, childState)?.liberties.length ?? 0;
  return mover === runtime.attackerColor
    ? [0, liberties, -capturedCount]
    : [0, -liberties, -capturedCount];
};

const buildAdapter = (runtime: LocalRuntime): AndOrSearchAdapter<LocalSearchState> => ({
  stateKey: (state) => stateKey(runtime, state),
  nodeType: (state) => state.mover === runtime.attackerColor ? 'or' : 'and',
  terminal: (state) => {
    if (state.kind === 'uncertain') return null;
    const snapshot = targetSnapshot(runtime, state.state);
    if (snapshot.status === 'captured') return 'proved';
    if (snapshot.status === 'invalid') return null;
    if (snapshot.bensonAlive) return 'refuted';
    return null;
  },
  expand: (state) => {
    if (state.kind === 'uncertain') return Object.freeze({ children: Object.freeze([]), complete: false });
    if (runtime.shouldStop()) {
      return Object.freeze({ children: Object.freeze([
        Object.freeze({ move: '[budget-interrupted]', state: makeUncertain('budget', state.mover) }),
      ]), complete: true });
    }
    const current = targetSnapshot(runtime, state.state);
    if (current.status === 'invalid') {
      return Object.freeze({ children: Object.freeze([
        Object.freeze({ move: '[target-identity-uncertain]', state: makeUncertain('incomplete', state.mover) }),
      ]), complete: true });
    }
    if (!isStillInsideCertifiedZone(runtime, state.state)) {
      return Object.freeze({ children: Object.freeze([
        Object.freeze({ move: '[boundary-uncertain]', state: makeUncertain('boundary', state.mover) }),
      ]), complete: true });
    }

    const generated: Array<{ readonly move: PointId; readonly state: LocalSearchState; readonly metric: readonly [number, number, number] }> = [];
    const playing = asPlayingState(state.state, state.mover);
    const simpleKoContext = moveResultContext(state);

    for (const point of runtime.zonePoints) {
      if (runtime.shouldStop()) {
        generated.push(Object.freeze({ move: point, state: makeUncertain('budget', opponentOf(state.mover)), metric: Object.freeze([4, 0, 0] as const) }));
        break;
      }
      if (state.state.board[point] !== 'empty') continue;
      const result = runtime.engine.placeStone(playing, point, state.mover, simpleKoContext);
      if (!result.ok) continue;

      const koResult = createsSimpleKo(runtime, playing, result.state);
      if (koResult === 'budget') {
        generated.push(Object.freeze({ move: point, state: makeUncertain('budget', opponentOf(state.mover)), metric: Object.freeze([4, 0, -result.captured.length] as const) }));
        break;
      }
      if (koResult === 'ko') {
        generated.push(Object.freeze({ move: point, state: makeUncertain('ko', opponentOf(state.mover)), metric: Object.freeze([1, 0, -result.captured.length] as const) }));
        continue;
      }

      const snapshot = targetSnapshot(runtime, result.state);
      if (snapshot.status === 'invalid') {
        generated.push(Object.freeze({ move: point, state: makeUncertain('incomplete', opponentOf(state.mover)), metric: Object.freeze([2, 0, -result.captured.length] as const) }));
        continue;
      }
      const terminal = snapshot.status === 'captured' || snapshot.bensonAlive;
      if (!terminal && !isStillInsideCertifiedZone(runtime, result.state)) {
        generated.push(Object.freeze({ move: point, state: makeUncertain('boundary', opponentOf(state.mover)), metric: Object.freeze([1, 0, -result.captured.length] as const) }));
        continue;
      }

      generated.push(Object.freeze({
        move: point,
        state: makePosition(result.state, opponentOf(state.mover), Object.freeze({ kind: 'exact' as const, previousBoard: state.state.board })),
        metric: childOrderingMetric(runtime, result.state, state.mover, result.captured.length),
      }));
    }

    generated.sort((left, right) =>
      left.metric[0] - right.metric[0] ||
      left.metric[1] - right.metric[1] ||
      left.metric[2] - right.metric[2] ||
      compareEndgamePointIds(left.move, right.move));
    const children: Array<Readonly<{ readonly move: string; readonly state: LocalSearchState }>> = generated.map((child) =>
      Object.freeze({ move: `play:${child.move}`, state: child.state }));

    children.push(Object.freeze({
      move: 'tenuki',
      state: makePosition(state.state, opponentOf(state.mover), Object.freeze({ kind: 'lifted' as const })),
    }));
    return Object.freeze({ children: Object.freeze(children), complete: true });
  },
});

const traceContainsUncertainReason = (trace: AndOrProofTrace, reason: UncertainReason): boolean =>
  trace.nodeKey.startsWith(`uncertain|${reason}|`) || trace.children.some((child) => traceContainsUncertainReason(child.trace, reason));

const mapOrderOutcome = (search: AndOrSearchResult): LocalLifeDeathOrderOutcome => {
  if (search.outcome === 'proved') return 'proved-dead';
  if (search.outcome === 'refuted') return 'proved-alive';
  if (traceContainsUncertainReason(search.trace, 'ko')) return 'ko-dependent';
  if (traceContainsUncertainReason(search.trace, 'boundary')) return 'unknown-boundary';
  if (traceContainsUncertainReason(search.trace, 'incomplete')) return 'unknown-incomplete';
  if (search.unknownReason === 'budget' || traceContainsUncertainReason(search.trace, 'budget')) return 'unknown-budget';
  if (search.unknownReason === 'cycle') return 'unknown-cycle';
  return 'unknown-incomplete';
};

const runOrder = (
  runtime: LocalRuntime,
  state: GameState,
  firstPlayer: LocalLifeDeathFirstPlayer,
  maxNodes: number,
): LocalLifeDeathOrderResult => {
  const mover = firstPlayer === 'attacker' ? runtime.attackerColor : runtime.targetColor;
  const search = runAndOrSearch(
    makePosition(asPlayingState(state, mover), mover, Object.freeze({ kind: 'root-unknown' as const })),
    buildAdapter(runtime),
    { maxNodes, shouldStop: runtime.shouldStop },
  );
  return Object.freeze({ firstPlayer, outcome: mapOrderOutcome(search), search });
};

const runOrderAsync = async (
  runtime: LocalRuntime,
  state: GameState,
  firstPlayer: LocalLifeDeathFirstPlayer,
  maxNodes: number,
  cooperativeCheckpoint: () => Promise<boolean>,
): Promise<LocalLifeDeathOrderResult> => {
  const mover = firstPlayer === 'attacker' ? runtime.attackerColor : runtime.targetColor;
  const search = await runAndOrSearchAsync(
    makePosition(asPlayingState(state, mover), mover, Object.freeze({ kind: 'root-unknown' as const })),
    buildAdapter(runtime),
    { maxNodes, shouldStop: runtime.shouldStop, cooperativeCheckpoint },
  );
  return Object.freeze({ firstPlayer, outcome: mapOrderOutcome(search), search });
};

const unavailableOrderResult = (
  firstPlayer: LocalLifeDeathFirstPlayer,
  outcome: Extract<LocalLifeDeathOrderOutcome, 'unknown-boundary' | 'unknown-budget' | 'unknown-incomplete'>,
): LocalLifeDeathOrderResult => Object.freeze({ firstPlayer, outcome, search: null });

const prepareRuntime = (
  target: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: LocalLifeDeathOptions,
): Readonly<{ runtime: LocalRuntime | null; result: LocalLifeDeathResult | null }> => {
  const maxZonePoints = options.maxZonePoints ?? DEFAULT_MAX_ZONE_POINTS;
  const shouldStop = options.shouldStop ?? (() => false);
  const crucialStones = Object.freeze([...target.points].sort(compareEndgamePointIds));
  if (shouldStop()) {
    const zone = buildRelevanceZone(target, state.board, topology, { maxPoints: maxZonePoints, shouldStop });
    const order = (firstPlayer: LocalLifeDeathFirstPlayer) => unavailableOrderResult(firstPlayer, 'unknown-budget');
    return Object.freeze({ runtime: null, result: Object.freeze({
      algorithm: LOCAL_LIFE_DEATH_ALGORITHM,
      outcome: 'unknown' as const,
      targetGroupKey: target.key,
      crucialStones,
      zone,
      attackerFirst: order('attacker'),
      defenderFirst: order('defender'),
      proofReason: 'shared analysis budget was exhausted before local search preparation completed',
    }) });
  }

  const graph = tryBuildEndgameStaticGraph(state.board, topology, { shouldStop });
  if (!graph) {
    const zone = buildRelevanceZone(target, state.board, topology, { maxPoints: maxZonePoints, shouldStop });
    return Object.freeze({ runtime: null, result: Object.freeze({
      algorithm: LOCAL_LIFE_DEATH_ALGORITHM,
      outcome: 'unknown' as const,
      targetGroupKey: target.key,
      crucialStones,
      zone,
      attackerFirst: unavailableOrderResult('attacker', 'unknown-budget'),
      defenderFirst: unavailableOrderResult('defender', 'unknown-budget'),
      proofReason: 'graph preparation was interrupted by the shared analysis budget',
    }) });
  }
  const safeGroupKeys = collectBensonSafeGroupKeys(state.board, topology, graph, shouldStop);
  const zone = buildRelevanceZone(target, state.board, topology, {
    maxPoints: maxZonePoints,
    graph,
    ...(safeGroupKeys ? { safeGroupKeys } : {}),
    shouldStop,
  });

  if (zone.outcome !== 'bounded') {
    const outcome = zone.reason === 'interrupted' ? 'unknown-budget' as const : 'unknown-boundary' as const;
    return Object.freeze({ runtime: null, result: Object.freeze({
      algorithm: LOCAL_LIFE_DEATH_ALGORITHM,
      outcome: 'unknown' as const,
      targetGroupKey: target.key,
      crucialStones,
      zone,
      attackerFirst: unavailableOrderResult('attacker', outcome),
      defenderFirst: unavailableOrderResult('defender', outcome),
      proofReason: zone.reason === 'interrupted'
        ? 'Relevance Zone construction was interrupted by the shared analysis budget'
        : 'the target has no certified bounded Relevance Zone',
    }) });
  }

  const runtime: LocalRuntime = {
    topology,
    engine: new GameEngine(topology),
    targetColor: target.color,
    attackerColor: opponentOf(target.color),
    crucialStones,
    initialZone: zone,
    zonePoints: Object.freeze([...zone.points].sort(compareEndgamePointIds)),
    zonePointSet: new Set(zone.points),
    maxZonePoints,
    shouldStop,
    terminalCache: new Map(),
  };
  return Object.freeze({ runtime, result: null });
};

const finishResult = (
  target: EndgameStoneString,
  runtime: LocalRuntime,
  attackerFirst: LocalLifeDeathOrderResult,
  defenderFirst: LocalLifeDeathOrderResult,
): LocalLifeDeathResult => {
  const outcome: LocalLifeDeathOutcome =
    attackerFirst.outcome === 'proved-dead' && defenderFirst.outcome === 'proved-dead'
      ? 'proved-dead'
      : attackerFirst.outcome === 'proved-alive' && defenderFirst.outcome === 'proved-alive'
        ? 'proved-alive'
        : 'unknown';
  const proofReason = outcome === 'proved-dead'
    ? 'capture/death is proved for both attacker-first and defender-first orders'
    : outcome === 'proved-alive'
      ? 'survival is proved for both attacker-first and defender-first orders'
      : 'at least one first-player order remains unproved, ko-dependent, budget-limited, identity-uncertain, or outside the certified local proof boundary';

  return Object.freeze({
    algorithm: LOCAL_LIFE_DEATH_ALGORITHM,
    outcome,
    targetGroupKey: target.key,
    crucialStones: runtime.crucialStones,
    zone: runtime.initialZone,
    attackerFirst,
    defenderFirst,
    proofReason,
  });
};

export const readLocalLifeDeath = (
  target: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: LocalLifeDeathOptions = {},
): LocalLifeDeathResult => {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const prepared = prepareRuntime(target, state, topology, options);
  if (prepared.result) return prepared.result;
  const runtime = prepared.runtime!;
  const attackerFirst = runOrder(runtime, state, 'attacker', maxNodes);
  const defenderFirst = runOrder(runtime, state, 'defender', maxNodes);
  return finishResult(target, runtime, attackerFirst, defenderFirst);
};

/** Production cooperative variant. Proof semantics are identical to the sync reader. */
export const readLocalLifeDeathAsync = async (
  target: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: LocalLifeDeathOptions = {},
): Promise<LocalLifeDeathResult> => {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const cooperativeCheckpoint = options.cooperativeCheckpoint ?? (async () => options.shouldStop?.() ?? false);
  const prepared = prepareRuntime(target, state, topology, options);
  if (prepared.result) return prepared.result;
  const runtime = prepared.runtime!;
  const attackerFirst = await runOrderAsync(runtime, state, 'attacker', maxNodes, cooperativeCheckpoint);
  if (runtime.shouldStop()) {
    return finishResult(
      target,
      runtime,
      attackerFirst,
      unavailableOrderResult('defender', 'unknown-budget'),
    );
  }
  const defenderFirst = await runOrderAsync(runtime, state, 'defender', maxNodes, cooperativeCheckpoint);
  return finishResult(target, runtime, attackerFirst, defenderFirst);
};
