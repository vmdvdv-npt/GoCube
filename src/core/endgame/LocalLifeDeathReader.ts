import { GameEngine, type StoneGroup } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import {
  runAndOrSearch,
  type AndOrProofTrace,
  type AndOrSearchAdapter,
  type AndOrSearchResult,
} from './AndOrSearchCore';
import { proveBensonPassAlive } from './BensonPassAlive';
import { buildEndgameStaticGraph, type EndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { compareEndgamePointIds } from './EndgameGroupIdentity';
import { buildRelevanceZone, type RelevanceZoneResult } from './RelevanceZone';

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
  /** Shared/global safety deadline. True stops the current AND/OR tree fail-closed. */
  readonly shouldStop?: () => boolean;
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
type UncertainReason = 'boundary' | 'ko';
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

interface TargetSnapshot {
  readonly graph: EndgameStaticGraph;
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
  const graph = buildEndgameStaticGraph(state.board, runtime.topology);
  const survivingStone = runtime.crucialStones.find((point) => state.board[point] === runtime.targetColor);
  if (!survivingStone) return Object.freeze({ graph, group: null, bensonAlive: false });

  const groupKey = graph.stringByPoint.get(survivingStone);
  const group = groupKey ? graph.stringsByKey.get(groupKey) ?? null : null;
  const bensonAlive = group !== null &&
    proveBensonPassAlive(state.board, runtime.topology, graph, runtime.targetColor).aliveGroups.has(group.key);
  return Object.freeze({ graph, group, bensonAlive });
};

const groupAtCrucialStone = (runtime: LocalRuntime, state: GameState): StoneGroup | null => {
  const survivingStone = runtime.crucialStones.find((point) => state.board[point] === runtime.targetColor);
  return survivingStone ? runtime.engine.groupAt(state, survivingStone) : null;
};

const isStillInsideCertifiedZone = (runtime: LocalRuntime, state: GameState): boolean => {
  const snapshot = targetSnapshot(runtime, state);
  if (!snapshot.group || snapshot.bensonAlive) return true;
  const currentZone = buildRelevanceZone(snapshot.group, state.board, runtime.topology, { maxPoints: runtime.maxZonePoints });
  return currentZone.outcome === 'bounded' && currentZone.points.every((point) => runtime.zonePointSet.has(point));
};

const createsSimpleKo = (runtime: LocalRuntime, before: GameState, after: GameState): boolean => {
  const recapturer = after.currentPlayer;
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
): readonly [number, number] => {
  const snapshot = targetSnapshot(runtime, childState);
  if (!snapshot.group) return mover === runtime.attackerColor ? [-2, 0] : [2, 0];
  if (snapshot.bensonAlive) return mover === runtime.targetColor ? [-2, 0] : [2, 0];
  const liberties = groupAtCrucialStone(runtime, childState)?.liberties.length ?? 0;
  return mover === runtime.attackerColor ? [0, liberties] : [0, -liberties];
};

const buildAdapter = (runtime: LocalRuntime): AndOrSearchAdapter<LocalSearchState> => ({
  stateKey: (state) => stateKey(runtime, state),
  nodeType: (state) => state.mover === runtime.attackerColor ? 'or' : 'and',
  terminal: (state) => {
    if (state.kind === 'uncertain') return null;
    const snapshot = targetSnapshot(runtime, state.state);
    if (!snapshot.group) return 'proved';
    if (snapshot.bensonAlive) return 'refuted';
    return null;
  },
  expand: (state) => {
    if (state.kind === 'uncertain') return Object.freeze({ children: Object.freeze([]), complete: false });
    if (!isStillInsideCertifiedZone(runtime, state.state)) {
      return Object.freeze({ children: Object.freeze([
        Object.freeze({ move: '[boundary-uncertain]', state: makeUncertain('boundary', state.mover) }),
      ]), complete: true });
    }

    const generated: Array<{ readonly move: PointId; readonly state: LocalSearchState; readonly metric: readonly [number, number] }> = [];
    const playing = asPlayingState(state.state, state.mover);
    const simpleKoContext = moveResultContext(state);

    for (const point of runtime.zonePoints) {
      if (state.state.board[point] !== 'empty') continue;
      const result = runtime.engine.placeStone(playing, point, state.mover, simpleKoContext);
      if (!result.ok) continue;

      if (createsSimpleKo(runtime, playing, result.state)) {
        generated.push(Object.freeze({ move: point, state: makeUncertain('ko', opponentOf(state.mover)), metric: Object.freeze([1, 0] as const) }));
        continue;
      }

      const snapshot = targetSnapshot(runtime, result.state);
      const terminal = !snapshot.group || snapshot.bensonAlive;
      if (!terminal && !isStillInsideCertifiedZone(runtime, result.state)) {
        generated.push(Object.freeze({ move: point, state: makeUncertain('boundary', opponentOf(state.mover)), metric: Object.freeze([1, 0] as const) }));
        continue;
      }

      generated.push(Object.freeze({
        move: point,
        state: makePosition(result.state, opponentOf(state.mover), Object.freeze({ kind: 'exact' as const, previousBoard: state.state.board })),
        metric: childOrderingMetric(runtime, result.state, state.mover),
      }));
    }

    generated.sort((left, right) => left.metric[0] - right.metric[0] || left.metric[1] - right.metric[1] || compareEndgamePointIds(left.move, right.move));
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
  if (search.unknownReason === 'budget') return 'unknown-budget';
  if (traceContainsUncertainReason(search.trace, 'ko')) return 'ko-dependent';
  if (traceContainsUncertainReason(search.trace, 'boundary')) return 'unknown-boundary';
  if (search.unknownReason === 'cycle') return 'unknown-cycle';
  return 'unknown-incomplete';
};

const runOrder = (
  runtime: LocalRuntime,
  state: GameState,
  firstPlayer: LocalLifeDeathFirstPlayer,
  maxNodes: number,
  shouldStop: () => boolean,
): LocalLifeDeathOrderResult => {
  const mover = firstPlayer === 'attacker' ? runtime.attackerColor : runtime.targetColor;
  const search = runAndOrSearch(
    makePosition(asPlayingState(state, mover), mover, Object.freeze({ kind: 'root-unknown' as const })),
    buildAdapter(runtime),
    { maxNodes, shouldStop },
  );
  return Object.freeze({ firstPlayer, outcome: mapOrderOutcome(search), search });
};

const boundaryOrderResult = (firstPlayer: LocalLifeDeathFirstPlayer): LocalLifeDeathOrderResult =>
  Object.freeze({ firstPlayer, outcome: 'unknown-boundary' as const, search: null });

export const readLocalLifeDeath = (
  target: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: LocalLifeDeathOptions = {},
): LocalLifeDeathResult => {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxZonePoints = options.maxZonePoints ?? DEFAULT_MAX_ZONE_POINTS;
  const shouldStop = options.shouldStop ?? (() => false);
  const crucialStones = Object.freeze([...target.points].sort(compareEndgamePointIds));
  const zone = buildRelevanceZone(target, state.board, topology, { maxPoints: maxZonePoints });

  if (zone.outcome !== 'bounded') {
    return Object.freeze({
      algorithm: LOCAL_LIFE_DEATH_ALGORITHM,
      outcome: 'unknown' as const,
      targetGroupKey: target.key,
      crucialStones,
      zone,
      attackerFirst: boundaryOrderResult('attacker'),
      defenderFirst: boundaryOrderResult('defender'),
      proofReason: 'the target has no certified bounded Relevance Zone',
    });
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
  };

  const attackerFirst = runOrder(runtime, state, 'attacker', maxNodes, shouldStop);
  const defenderFirst = runOrder(runtime, state, 'defender', maxNodes, shouldStop);
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
      : 'at least one first-player order remains unproved, ko-dependent, or outside the certified local proof boundary';

  return Object.freeze({
    algorithm: LOCAL_LIFE_DEATH_ALGORITHM,
    outcome,
    targetGroupKey: target.key,
    crucialStones,
    zone,
    attackerFirst,
    defenderFirst,
    proofReason,
  });
};