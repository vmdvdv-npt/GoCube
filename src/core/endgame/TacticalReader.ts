import { GameEngine, type StoneGroup } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import type { EndgameStoneString } from './EndgameStaticGraph';

export const TACTICAL_READER_ALGORITHM = 'tactical-forced-capture-v1';

export type TacticalFirstPlayer = 'attacker' | 'defender';
export type TacticalReadOutcome =
  | 'proved-kill'
  | 'proved-survival'
  | 'ko-dependent'
  | 'unknown-budget'
  | 'unknown-depth'
  | 'unknown-boundary'
  | 'unknown-cycle';

export interface TacticalReaderOptions {
  readonly firstPlayer?: TacticalFirstPlayer;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxTargetLiberties?: number;
  readonly maxTopologyPoints?: number;
  readonly safeGroupPoints?: readonly PointId[];
  readonly shouldStop?: () => boolean;
  readonly cooperativeCheckpoint?: () => Promise<boolean>;
}

export interface TacticalReadResult {
  readonly algorithm: typeof TACTICAL_READER_ALGORITHM;
  readonly outcome: TacticalReadOutcome;
  readonly crucialStones: readonly PointId[];
  readonly exploredNodes: number;
  readonly maxDepth: number;
  readonly principalVariation: readonly PointId[];
  readonly proofReason: string;
}

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_NODES = 2_500;
const DEFAULT_MAX_TARGET_LIBERTIES = 3;
const DEFAULT_MAX_TOPOLOGY_POINTS = 128;

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const comparePoints = (left: PointId, right: PointId): number =>
  left < right ? -1 : left > right ? 1 : 0;

const freezeSearchState = (state: GameState, currentPlayer: StoneColor): GameState =>
  Object.freeze({
    board: state.board,
    currentPlayer,
    moveNumber: state.moveNumber,
    consecutivePasses: 0,
    phase: 'playing' as const,
    captures: state.captures,
  });

type SearchKind = 'kill' | 'survival' | 'unknown' | 'ko';
type UnknownReason = 'budget' | 'depth' | 'boundary' | 'cycle';
type CaptureKoCheck = 'clear' | 'ko' | 'budget';

interface SearchVerdict {
  readonly kind: SearchKind;
  readonly reason?: UnknownReason;
  readonly pv: readonly PointId[];
}

interface SearchNode {
  readonly state: GameState;
  readonly previousBoard: BoardOccupancy | null;
  readonly mover: StoneColor;
  readonly depthRemaining: number;
}

interface SearchRuntime {
  nodes: number;
  readonly maxNodes: number;
  readonly maxTargetLiberties: number;
  readonly engine: GameEngine;
  readonly topology: Topology;
  readonly targetColor: StoneColor;
  readonly attackerColor: StoneColor;
  readonly crucialStones: readonly PointId[];
  readonly safeGroupPoints: ReadonlySet<PointId>;
  readonly sortedPoints: readonly PointId[];
  readonly shouldStop: (() => boolean) | null;
  readonly cooperativeCheckpoint: (() => Promise<boolean>) | null;
}

interface DefenderMoveSet {
  readonly children: readonly Readonly<{ move: PointId; state: GameState }>[];
  readonly complete: boolean;
}

const targetGroupAt = (runtime: SearchRuntime, state: GameState): StoneGroup | null => {
  const surviving = runtime.crucialStones.filter((point) => state.board[point] === runtime.targetColor);
  if (surviving.length === 0) return null;
  if (surviving.length !== runtime.crucialStones.length) return null;
  const group = runtime.engine.groupAt(state, surviving[0]!);
  if (!group || !runtime.crucialStones.every((point) => group.points.includes(point))) return null;
  return group;
};

const connectsToSafeGroup = (runtime: SearchRuntime, group: StoneGroup): boolean =>
  group.points.some((point) => runtime.safeGroupPoints.has(point));

const stateKey = (runtime: SearchRuntime, node: SearchNode): string => {
  const occupancy = runtime.sortedPoints
    .map((point) => {
      const value = node.state.board[point];
      return value === 'black' ? 'b' : value === 'white' ? 'w' : '.';
    })
    .join('');
  const previous = node.previousBoard
    ? runtime.sortedPoints.map((point) => node.previousBoard![point] === 'black' ? 'b' : node.previousBoard![point] === 'white' ? 'w' : '.').join('')
    : '-';
  return `${node.mover}|${previous}|${occupancy}`;
};

const prependMove = (move: PointId, verdict: SearchVerdict): SearchVerdict =>
  Object.freeze({ ...verdict, pv: Object.freeze([move, ...verdict.pv]) });
const unknown = (reason: UnknownReason): SearchVerdict =>
  Object.freeze({ kind: 'unknown' as const, reason, pv: Object.freeze([]) });
const kill = (pv: readonly PointId[] = Object.freeze([])): SearchVerdict =>
  Object.freeze({ kind: 'kill' as const, pv });
const survival = (pv: readonly PointId[] = Object.freeze([])): SearchVerdict =>
  Object.freeze({ kind: 'survival' as const, pv });
const ko = (pv: readonly PointId[] = Object.freeze([])): SearchVerdict =>
  Object.freeze({ kind: 'ko' as const, pv });

const chooseUnknown = (values: readonly SearchVerdict[]): SearchVerdict => {
  const rank: Readonly<Record<UnknownReason, number>> = Object.freeze({ budget: 4, boundary: 3, cycle: 2, depth: 1 });
  let selected: SearchVerdict | null = null;
  for (const value of values) {
    if (value.kind === 'ko') return value;
    if (value.kind !== 'unknown' || !value.reason) continue;
    if (!selected || rank[value.reason] > rank[selected.reason!]) selected = value;
  }
  return selected ?? unknown('depth');
};

const attackerMoveCandidates = (
  runtime: SearchRuntime,
  state: GameState,
  target: StoneGroup,
): readonly PointId[] => {
  const liberties = [...target.liberties].sort(comparePoints);
  const direct = new Set<PointId>(liberties);
  const followUps = new Set<PointId>();

  for (const liberty of liberties) {
    for (const neighbor of runtime.topology.neighbors(liberty)) {
      if (state.board[neighbor] === 'empty' && !direct.has(neighbor)) followUps.add(neighbor);
    }
  }
  for (const point of target.points) {
    for (const neighbor of runtime.topology.neighbors(point)) {
      if (state.board[neighbor] === 'empty' && !direct.has(neighbor)) followUps.add(neighbor);
    }
  }
  return Object.freeze([...liberties, ...[...followUps].sort(comparePoints)]);
};

const atariSavingCandidates = (
  runtime: SearchRuntime,
  state: GameState,
  target: StoneGroup,
): readonly PointId[] => {
  const candidates = new Set<PointId>(target.liberties);
  const seenOpponent = new Set<PointId>();
  for (const point of target.points) {
    for (const neighbor of runtime.topology.neighbors(point)) {
      if (state.board[neighbor] !== runtime.attackerColor || seenOpponent.has(neighbor)) continue;
      const opponentGroup = runtime.engine.groupAt(state, neighbor);
      if (!opponentGroup) continue;
      for (const stone of opponentGroup.points) seenOpponent.add(stone);
      if (opponentGroup.liberties.length === 1) candidates.add(opponentGroup.liberties[0]!);
    }
  }
  return Object.freeze([...candidates].sort(comparePoints));
};

const allLegalDefenderMoves = (
  runtime: SearchRuntime,
  node: SearchNode,
  limit: number,
): DefenderMoveSet => {
  const results: Array<Readonly<{ move: PointId; state: GameState }>> = [];
  for (const point of runtime.sortedPoints) {
    if (runtime.shouldStop?.()) return Object.freeze({ children: Object.freeze(results), complete: false });
    if (node.state.board[point] !== 'empty') continue;
    const result = runtime.engine.placeStone(
      freezeSearchState(node.state, node.mover), point, node.mover, { previousBoard: node.previousBoard },
    );
    if (!result.ok) continue;
    if (results.length >= limit) return Object.freeze({ children: Object.freeze(results), complete: false });
    results.push(Object.freeze({ move: point, state: result.state }));
  }
  return Object.freeze({ children: Object.freeze(results), complete: true });
};

const terminalCaptureKoCheck = (
  runtime: SearchRuntime,
  beforeCapture: GameState,
  afterCapture: GameState,
): CaptureKoCheck => {
  for (const point of runtime.sortedPoints) {
    if (runtime.shouldStop?.()) return 'budget';
    if (afterCapture.board[point] !== 'empty') continue;
    const recapture = runtime.engine.placeStone(
      freezeSearchState(afterCapture, runtime.targetColor),
      point,
      runtime.targetColor,
      { previousBoard: beforeCapture.board },
    );
    if (!recapture.ok && recapture.reason === 'repetition') return 'ko';
  }
  return 'clear';
};

const preNode = (runtime: SearchRuntime): SearchVerdict | null => {
  if (runtime.shouldStop?.()) return unknown('budget');
  runtime.nodes += 1;
  return runtime.nodes > runtime.maxNodes ? unknown('budget') : null;
};

const search = (
  runtime: SearchRuntime,
  node: SearchNode,
  path: ReadonlySet<string>,
): SearchVerdict => {
  const stopped = preNode(runtime);
  if (stopped) return stopped;

  const target = targetGroupAt(runtime, node.state);
  if (!target) return kill();
  if (connectsToSafeGroup(runtime, target)) return survival();
  if (target.liberties.length > runtime.maxTargetLiberties) return unknown('boundary');
  if (node.depthRemaining <= 0) return unknown('depth');

  const key = stateKey(runtime, node);
  if (path.has(key)) return unknown('cycle');
  const nextPath = new Set(path);
  nextPath.add(key);

  if (node.mover === runtime.attackerColor) {
    const unknowns: SearchVerdict[] = [];
    const legalMoves: Array<Readonly<{ move: PointId; state: GameState; targetLiberties: number; captured: number }>> = [];
    for (const move of attackerMoveCandidates(runtime, node.state, target)) {
      if (runtime.shouldStop?.()) return unknown('budget');
      const result = runtime.engine.placeStone(
        freezeSearchState(node.state, node.mover), move, node.mover, { previousBoard: node.previousBoard },
      );
      if (!result.ok) continue;
      const targetAfterMove = targetGroupAt(runtime, result.state);
      legalMoves.push(Object.freeze({ move, state: result.state, targetLiberties: targetAfterMove?.liberties.length ?? -1, captured: result.captured.length }));
    }
    legalMoves.sort((left, right) =>
      left.targetLiberties - right.targetLiberties || right.captured - left.captured || comparePoints(left.move, right.move));

    for (const childMove of legalMoves) {
      if (runtime.shouldStop?.()) return unknown('budget');
      const { move } = childMove;
      const targetCaptured = targetGroupAt(runtime, childMove.state) === null;
      if (targetCaptured) {
        const koCheck = terminalCaptureKoCheck(runtime, node.state, childMove.state);
        if (koCheck === 'budget') return unknown('budget');
        if (koCheck === 'ko') { unknowns.push(prependMove(move, ko())); continue; }
        return kill(Object.freeze([move]));
      }

      const child = search(runtime, Object.freeze({
        state: childMove.state,
        previousBoard: node.state.board,
        mover: runtime.targetColor,
        depthRemaining: node.depthRemaining - 1,
      }), nextPath);
      if (child.kind === 'kill') return prependMove(move, child);
      if (child.kind !== 'survival') unknowns.push(prependMove(move, child));
    }
    if (legalMoves.length === 0) return unknown('boundary');
    return unknowns.length > 0 ? chooseUnknown(unknowns) : unknown('boundary');
  }

  const defenderChildren: Array<Readonly<{ move: PointId | null; state: GameState }>> = [];
  if (target.liberties.length === 1) {
    for (const move of atariSavingCandidates(runtime, node.state, target)) {
      if (runtime.shouldStop?.()) return unknown('budget');
      const result = runtime.engine.placeStone(
        freezeSearchState(node.state, node.mover), move, node.mover, { previousBoard: node.previousBoard },
      );
      if (result.ok) defenderChildren.push(Object.freeze({ move, state: result.state }));
    }
    defenderChildren.push(Object.freeze({ move: null, state: node.state }));
  } else {
    const remainingChildBudget = Math.max(0, runtime.maxNodes - runtime.nodes);
    const legalDefenses = allLegalDefenderMoves(runtime, node, remainingChildBudget);
    if (!legalDefenses.complete) return unknown('budget');
    for (const child of legalDefenses.children) defenderChildren.push(child);
    defenderChildren.push(Object.freeze({ move: null, state: node.state }));
  }

  const unknowns: SearchVerdict[] = [];
  let representativeKill: SearchVerdict | null = null;
  for (const child of defenderChildren) {
    if (runtime.shouldStop?.()) return unknown('budget');
    const verdict = search(runtime, Object.freeze({
      state: child.state,
      previousBoard: node.state.board,
      mover: runtime.attackerColor,
      depthRemaining: node.depthRemaining - 1,
    }), nextPath);
    const withMove = child.move === null ? verdict : prependMove(child.move, verdict);
    if (withMove.kind === 'survival') return withMove;
    if (withMove.kind === 'ko' || withMove.kind === 'unknown') unknowns.push(withMove);
    if (withMove.kind === 'kill' && representativeKill === null) representativeKill = withMove;
  }
  if (unknowns.length > 0) return chooseUnknown(unknowns);
  return representativeKill ?? unknown('boundary');
};

const searchAsync = async (
  runtime: SearchRuntime,
  node: SearchNode,
  path: ReadonlySet<string>,
): Promise<SearchVerdict> => {
  if (runtime.cooperativeCheckpoint && await runtime.cooperativeCheckpoint()) return unknown('budget');
  const stopped = preNode(runtime);
  if (stopped) return stopped;

  const target = targetGroupAt(runtime, node.state);
  if (!target) return kill();
  if (connectsToSafeGroup(runtime, target)) return survival();
  if (target.liberties.length > runtime.maxTargetLiberties) return unknown('boundary');
  if (node.depthRemaining <= 0) return unknown('depth');

  const key = stateKey(runtime, node);
  if (path.has(key)) return unknown('cycle');
  const nextPath = new Set(path);
  nextPath.add(key);

  if (node.mover === runtime.attackerColor) {
    const unknowns: SearchVerdict[] = [];
    const legalMoves: Array<Readonly<{ move: PointId; state: GameState; targetLiberties: number; captured: number }>> = [];
    for (const move of attackerMoveCandidates(runtime, node.state, target)) {
      if (runtime.shouldStop?.()) return unknown('budget');
      const result = runtime.engine.placeStone(
        freezeSearchState(node.state, node.mover), move, node.mover, { previousBoard: node.previousBoard },
      );
      if (!result.ok) continue;
      const targetAfterMove = targetGroupAt(runtime, result.state);
      legalMoves.push(Object.freeze({ move, state: result.state, targetLiberties: targetAfterMove?.liberties.length ?? -1, captured: result.captured.length }));
    }
    legalMoves.sort((left, right) =>
      left.targetLiberties - right.targetLiberties || right.captured - left.captured || comparePoints(left.move, right.move));

    for (const childMove of legalMoves) {
      if (runtime.cooperativeCheckpoint && await runtime.cooperativeCheckpoint()) return unknown('budget');
      if (runtime.shouldStop?.()) return unknown('budget');
      const { move } = childMove;
      const targetCaptured = targetGroupAt(runtime, childMove.state) === null;
      if (targetCaptured) {
        const koCheck = terminalCaptureKoCheck(runtime, node.state, childMove.state);
        if (koCheck === 'budget') return unknown('budget');
        if (koCheck === 'ko') { unknowns.push(prependMove(move, ko())); continue; }
        return kill(Object.freeze([move]));
      }
      const child = await searchAsync(runtime, Object.freeze({
        state: childMove.state,
        previousBoard: node.state.board,
        mover: runtime.targetColor,
        depthRemaining: node.depthRemaining - 1,
      }), nextPath);
      if (child.kind === 'kill') return prependMove(move, child);
      if (child.kind !== 'survival') unknowns.push(prependMove(move, child));
    }
    if (legalMoves.length === 0) return unknown('boundary');
    return unknowns.length > 0 ? chooseUnknown(unknowns) : unknown('boundary');
  }

  const defenderChildren: Array<Readonly<{ move: PointId | null; state: GameState }>> = [];
  if (target.liberties.length === 1) {
    for (const move of atariSavingCandidates(runtime, node.state, target)) {
      if (runtime.shouldStop?.()) return unknown('budget');
      const result = runtime.engine.placeStone(
        freezeSearchState(node.state, node.mover), move, node.mover, { previousBoard: node.previousBoard },
      );
      if (result.ok) defenderChildren.push(Object.freeze({ move, state: result.state }));
    }
    defenderChildren.push(Object.freeze({ move: null, state: node.state }));
  } else {
    const remainingChildBudget = Math.max(0, runtime.maxNodes - runtime.nodes);
    const legalDefenses = allLegalDefenderMoves(runtime, node, remainingChildBudget);
    if (!legalDefenses.complete) return unknown('budget');
    for (const child of legalDefenses.children) defenderChildren.push(child);
    defenderChildren.push(Object.freeze({ move: null, state: node.state }));
  }

  const unknowns: SearchVerdict[] = [];
  let representativeKill: SearchVerdict | null = null;
  for (const child of defenderChildren) {
    if (runtime.cooperativeCheckpoint && await runtime.cooperativeCheckpoint()) return unknown('budget');
    if (runtime.shouldStop?.()) return unknown('budget');
    const verdict = await searchAsync(runtime, Object.freeze({
      state: child.state,
      previousBoard: node.state.board,
      mover: runtime.attackerColor,
      depthRemaining: node.depthRemaining - 1,
    }), nextPath);
    const withMove = child.move === null ? verdict : prependMove(child.move, verdict);
    if (withMove.kind === 'survival') return withMove;
    if (withMove.kind === 'ko' || withMove.kind === 'unknown') unknowns.push(withMove);
    if (withMove.kind === 'kill' && representativeKill === null) representativeKill = withMove;
  }
  if (unknowns.length > 0) return chooseUnknown(unknowns);
  return representativeKill ?? unknown('boundary');
};

const buildRuntime = (
  target: EndgameStoneString,
  topology: Topology,
  options: TacticalReaderOptions,
): Readonly<{ runtime: SearchRuntime | null; early: TacticalReadResult | null; maxDepth: number }> => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxTargetLiberties = options.maxTargetLiberties ?? DEFAULT_MAX_TARGET_LIBERTIES;
  const maxTopologyPoints = options.maxTopologyPoints ?? DEFAULT_MAX_TOPOLOGY_POINTS;
  if (!Number.isInteger(maxTopologyPoints) || maxTopologyPoints < 1) throw new RangeError('maxTopologyPoints must be a positive integer');

  const crucialStones = Object.freeze([...target.points].sort(comparePoints));
  const sortedPoints = Object.freeze([...topology.points()].sort(comparePoints));
  if (options.shouldStop?.()) {
    return Object.freeze({ runtime: null, maxDepth, early: Object.freeze({
      algorithm: TACTICAL_READER_ALGORITHM,
      outcome: 'unknown-budget' as const,
      crucialStones,
      exploredNodes: 0,
      maxDepth,
      principalVariation: Object.freeze([]),
      proofReason: 'shared analysis budget exhausted before tactical search preparation',
    }) });
  }
  if (sortedPoints.length > maxTopologyPoints) {
    return Object.freeze({ runtime: null, maxDepth, early: Object.freeze({
      algorithm: TACTICAL_READER_ALGORITHM,
      outcome: 'unknown-boundary' as const,
      crucialStones,
      exploredNodes: 0,
      maxDepth,
      principalVariation: Object.freeze([]),
      proofReason: `topology size ${sortedPoints.length} exceeds the conservative tactical cost gate ${maxTopologyPoints}`,
    }) });
  }

  const attackerColor = opponentOf(target.color);
  return Object.freeze({ runtime: {
    nodes: 0,
    maxNodes,
    maxTargetLiberties,
    engine: new GameEngine(topology),
    topology,
    targetColor: target.color,
    attackerColor,
    crucialStones,
    safeGroupPoints: new Set(options.safeGroupPoints ?? []),
    sortedPoints,
    shouldStop: options.shouldStop ?? null,
    cooperativeCheckpoint: options.cooperativeCheckpoint ?? null,
  }, early: null, maxDepth });
};

const finish = (runtime: SearchRuntime, maxDepth: number, verdict: SearchVerdict): TacticalReadResult => {
  const outcome: TacticalReadOutcome =
    verdict.kind === 'kill' ? 'proved-kill'
      : verdict.kind === 'survival' ? 'proved-survival'
        : verdict.kind === 'ko' ? 'ko-dependent'
          : verdict.reason === 'budget' ? 'unknown-budget'
            : verdict.reason === 'boundary' ? 'unknown-boundary'
              : verdict.reason === 'cycle' ? 'unknown-cycle'
                : 'unknown-depth';
  const proofReason = outcome === 'proved-kill'
    ? 'all defender continuations required by the tactical proof lead to capture of the crucial stones'
    : outcome === 'proved-survival'
      ? 'the target connects to a proven-safe group'
      : outcome === 'ko-dependent'
        ? 'the capture line depends on an immediate-ko transition'
        : outcome;
  return Object.freeze({
    algorithm: TACTICAL_READER_ALGORITHM,
    outcome,
    crucialStones: runtime.crucialStones,
    exploredNodes: runtime.nodes,
    maxDepth,
    principalVariation: Object.freeze([...verdict.pv]),
    proofReason,
  });
};

const rootNode = (runtime: SearchRuntime, state: GameState, firstPlayer: TacticalFirstPlayer, maxDepth: number): SearchNode =>
  Object.freeze({
    state: freezeSearchState(state, firstPlayer === 'attacker' ? runtime.attackerColor : runtime.targetColor),
    previousBoard: null,
    mover: firstPlayer === 'attacker' ? runtime.attackerColor : runtime.targetColor,
    depthRemaining: maxDepth,
  });

export const readTacticalCapture = (
  target: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: TacticalReaderOptions = {},
): TacticalReadResult => {
  const firstPlayer = options.firstPlayer ?? 'attacker';
  const built = buildRuntime(target, topology, options);
  if (built.early) return built.early;
  const runtime = built.runtime!;
  return finish(runtime, built.maxDepth, search(runtime, rootNode(runtime, state, firstPlayer, built.maxDepth), new Set()));
};

/** Production cooperative variant with the same conservative proof semantics. */
export const readTacticalCaptureAsync = async (
  target: EndgameStoneString,
  state: GameState,
  topology: Topology,
  options: TacticalReaderOptions = {},
): Promise<TacticalReadResult> => {
  const firstPlayer = options.firstPlayer ?? 'attacker';
  const built = buildRuntime(target, topology, options);
  if (built.early) return built.early;
  const runtime = built.runtime!;
  const verdict = await searchAsync(runtime, rootNode(runtime, state, firstPlayer, built.maxDepth), new Set());
  return finish(runtime, built.maxDepth, verdict);
};
