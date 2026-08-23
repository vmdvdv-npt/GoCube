import { GameEngine } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { proveBensonPassAlive } from './BensonPassAlive';
import {
  buildEndgameGraph,
  type EndgameGraph,
  type EndgameStoneString,
} from './EndgameGraphCore';
import { buildRelevanceZone, type RelevanceZoneReason } from './RelevanceZone';

export const SIMPLE_CUT_ALGORITHM = 'simple-cut-v1';

export interface SimpleCutOptions {
  readonly maxPoints?: number;
}

export interface SimpleCutProof {
  readonly algorithm: typeof SIMPLE_CUT_ALGORITHM;
  readonly proof: 'single-shared-liberty-benson-block';
  readonly targetGroupKey: string;
  readonly safeGroupKey: string;
  readonly safeGroupPoints: readonly PointId[];
  readonly cutPoint: PointId;
  readonly blockingSafeGroupKey: string;
  readonly blockingSafeGroupPoints: readonly PointId[];
  readonly relevanceLocalPositionKey: string;
}

export type SimpleCutResult =
  | Readonly<{ readonly outcome: 'proven'; readonly evidence: SimpleCutProof }>
  | Readonly<{
      readonly outcome: 'not-proven';
      readonly reason:
        | 'target-already-benson-alive'
        | 'no-benson-connection-candidate'
        | 'no-simple-safe-cut';
    }>
  | Readonly<{
      readonly outcome: 'unknown-boundary';
      readonly reason: RelevanceZoneReason;
    }>;

type CutCandidate = Readonly<{
  readonly safeGroupKey: string;
  readonly safeGroup: EndgameStoneString;
  readonly cutPoint: PointId;
}>;

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const makePlayingState = (board: BoardOccupancy, currentPlayer: StoneColor): GameState =>
  Object.freeze({
    board,
    currentPlayer,
    moveNumber: 0,
    consecutivePasses: 0,
    phase: 'playing' as const,
    captures: Object.freeze({ black: 0, white: 0 }),
  });

const groupContainingStructure = (
  graph: EndgameGraph,
  points: readonly PointId[],
): EndgameStoneString | null => {
  let groupKey: string | null = null;
  for (const point of points) {
    const owner = graph.stringByPoint.get(point);
    if (!owner) return null;
    if (groupKey === null) groupKey = owner;
    else if (owner !== groupKey) return null;
  }
  return groupKey === null ? null : graph.stringsByKey.get(groupKey) ?? null;
};

const stillHasDirectConnection = (
  graph: EndgameGraph,
  leftKey: string,
  rightKey: string,
): boolean =>
  graph.possibleConnections.some(
    (connection) => connection.groups.includes(leftKey) && connection.groups.includes(rightKey),
  );

/**
 * Proves the deliberately narrow Work 5C cut theorem.
 *
 * A non-Benson target and one same-color Benson/pass-alive string must have
 * exactly one actual shared liberty inside an already-certified bounded
 * Relevance Zone. The attacker must be able to occupy that point with a legal,
 * non-capturing move, and the resulting blocking string must itself be
 * Benson/pass-alive. The target and safe string must remain distinct and have
 * no remaining direct shared-liberty connection.
 *
 * This is a connection-reader fact, not a life/death verdict. Capture,
 * sacrifice, ko, unstable blockers and deeper cut/fight sequences are rejected
 * rather than promoted to a proof.
 */
export const proveSimpleCutFromBenson = (
  target: EndgameStoneString,
  board: BoardOccupancy,
  topology: Topology,
  options: SimpleCutOptions = {},
): SimpleCutResult => {
  const zone = buildRelevanceZone(target, board, topology, options);
  if (zone.outcome !== 'bounded') {
    return Object.freeze({ outcome: 'unknown-boundary', reason: zone.reason });
  }

  const graph = buildEndgameGraph(board, topology);
  const currentTarget = graph.stringsByKey.get(target.key);
  if (!currentTarget || currentTarget.color !== target.color) {
    return Object.freeze({ outcome: 'unknown-boundary', reason: 'target-mismatch' });
  }

  const targetBenson = proveBensonPassAlive(board, topology, graph, currentTarget.color);
  if (targetBenson.has(currentTarget.key)) {
    return Object.freeze({ outcome: 'not-proven', reason: 'target-already-benson-alive' });
  }

  const zoneBoundary = new Set(zone.boundarySafeGroupKeys);
  const zonePoints = new Set(zone.points);
  const candidates: CutCandidate[] = [];

  for (const connection of graph.possibleConnections) {
    if (!connection.groups.includes(currentTarget.key)) continue;

    const safeGroupKey = connection.groups.find((groupKey) => groupKey !== currentTarget.key);
    const safeGroup = safeGroupKey ? graph.stringsByKey.get(safeGroupKey) : undefined;
    if (
      !safeGroupKey ||
      !safeGroup ||
      safeGroup.color !== currentTarget.color ||
      !zoneBoundary.has(safeGroupKey) ||
      !targetBenson.has(safeGroupKey) ||
      connection.sharedLiberties.length !== 1
    ) {
      continue;
    }

    const cutPoint = connection.sharedLiberties[0]!;
    if (!zonePoints.has(cutPoint)) continue;
    candidates.push(Object.freeze({ safeGroupKey, safeGroup, cutPoint }));
  }

  candidates.sort((left, right) =>
    left.safeGroupKey < right.safeGroupKey ? -1 : left.safeGroupKey > right.safeGroupKey ? 1 : 0,
  );

  if (candidates.length === 0) {
    const hasBensonConnectionCandidate = graph.possibleConnections.some((connection) => {
      if (!connection.groups.includes(currentTarget.key)) return false;
      const otherKey = connection.groups.find((groupKey) => groupKey !== currentTarget.key);
      return otherKey !== undefined && targetBenson.has(otherKey);
    });
    return Object.freeze({
      outcome: 'not-proven',
      reason: hasBensonConnectionCandidate
        ? 'no-simple-safe-cut'
        : 'no-benson-connection-candidate',
    });
  }

  const attacker = opponentOf(currentTarget.color);
  const engine = new GameEngine(topology);
  const attackerTurn = makePlayingState(board, attacker);

  for (const candidate of candidates) {
    const block = engine.placeStone(attackerTurn, candidate.cutPoint, attacker);
    if (!block.ok || block.captured.length !== 0) continue;

    const cutGraph = buildEndgameGraph(block.state.board, topology);
    const targetAfterCut = groupContainingStructure(cutGraph, currentTarget.points);
    const safeAfterCut = groupContainingStructure(cutGraph, candidate.safeGroup.points);
    const blocker = cutGraph.stringByPoint.get(candidate.cutPoint);
    const blockingGroup = blocker ? cutGraph.stringsByKey.get(blocker) : undefined;

    if (
      !targetAfterCut ||
      !safeAfterCut ||
      !blockingGroup ||
      blockingGroup.color !== attacker ||
      targetAfterCut.key === safeAfterCut.key ||
      stillHasDirectConnection(cutGraph, targetAfterCut.key, safeAfterCut.key)
    ) {
      continue;
    }

    const blockingBenson = proveBensonPassAlive(block.state.board, topology, cutGraph, attacker);
    if (!blockingBenson.has(blockingGroup.key)) continue;

    return Object.freeze({
      outcome: 'proven' as const,
      evidence: Object.freeze({
        algorithm: SIMPLE_CUT_ALGORITHM,
        proof: 'single-shared-liberty-benson-block' as const,
        targetGroupKey: currentTarget.key,
        safeGroupKey: candidate.safeGroupKey,
        safeGroupPoints: candidate.safeGroup.points,
        cutPoint: candidate.cutPoint,
        blockingSafeGroupKey: blockingGroup.key,
        blockingSafeGroupPoints: blockingGroup.points,
        relevanceLocalPositionKey: zone.localPositionKey!,
      }),
    });
  }

  return Object.freeze({ outcome: 'not-proven', reason: 'no-simple-safe-cut' });
};
