import { GameEngine } from '../game/GameEngine';
import type { BoardOccupancy, GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { proveBensonPassAlive } from './BensonPassAlive';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { compareEndgamePointIds } from './EndgameGroupIdentity';
import { buildRelevanceZone, type RelevanceZoneReason } from './RelevanceZone';

export const SAFE_CONNECTION_ALGORITHM = 'safe-connection-v1';

export interface SafeConnectionOptions {
  readonly maxPoints?: number;
}

export interface SafeConnectionProof {
  readonly algorithm: typeof SAFE_CONNECTION_ALGORITHM;
  readonly proof: 'miai-two-shared-liberties-to-benson';
  readonly targetGroupKey: string;
  readonly safeGroupKey: string;
  readonly safeGroupPoints: readonly PointId[];
  readonly connectors: readonly [PointId, PointId];
  readonly relevanceLocalPositionKey: string;
}

export type SafeConnectionResult =
  | Readonly<{ readonly outcome: 'proven'; readonly evidence: SafeConnectionProof }>
  | Readonly<{
      readonly outcome: 'not-proven';
      readonly reason:
        | 'target-already-benson-alive'
        | 'no-benson-connection-candidate'
        | 'no-simple-miai-pair';
    }>
  | Readonly<{
      readonly outcome: 'unknown-boundary';
      readonly reason: RelevanceZoneReason;
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

const groupContainsBothStructures = (
  engine: GameEngine,
  state: GameState,
  connector: PointId,
  targetPoints: readonly PointId[],
  safePoints: readonly PointId[],
): boolean => {
  const connected = engine.groupAt(state, connector);
  if (!connected) return false;
  const points = new Set(connected.points);
  return targetPoints.some((point) => points.has(point)) && safePoints.some((point) => points.has(point));
};

const isQuietConnectionMove = (
  engine: GameEngine,
  state: GameState,
  connector: PointId,
  color: StoneColor,
  targetPoints: readonly PointId[],
  safePoints: readonly PointId[],
): boolean => {
  const result = engine.placeStone(state, connector, color);
  if (!result.ok || result.captured.length !== 0) return false;
  return groupContainsBothStructures(engine, result.state, connector, targetPoints, safePoints);
};

/**
 * Verifies the deliberately narrow Work 5B connection theorem.
 *
 * The target and one Benson/pass-alive friendly string must have two distinct
 * shared liberties inside an already-certified bounded Relevance Zone. Those
 * liberties are miai: an opponent move can occupy at most one of them, after
 * which the target connects on the other. We simulate both cut orders with the
 * authoritative GameEngine and accept only quiet, non-capturing moves; capture,
 * sacrifice, ko fights and deeper cut sequences are intentionally deferred.
 */
export const proveSafeConnectionToBenson = (
  target: EndgameStoneString,
  board: BoardOccupancy,
  topology: Topology,
  options: SafeConnectionOptions = {},
): SafeConnectionResult => {
  const zone = buildRelevanceZone(target, board, topology, options);
  if (zone.outcome !== 'bounded') {
    return Object.freeze({ outcome: 'unknown-boundary', reason: zone.reason });
  }

  const graph = buildEndgameGraph(board, topology);
  const currentTarget = graph.stringsByKey.get(target.key);
  if (!currentTarget || currentTarget.color !== target.color) {
    return Object.freeze({ outcome: 'unknown-boundary', reason: 'target-mismatch' });
  }

  const bensonProofs = proveBensonPassAlive(board, topology, graph, currentTarget.color);
  if (bensonProofs.has(currentTarget.key)) {
    return Object.freeze({ outcome: 'not-proven', reason: 'target-already-benson-alive' });
  }

  const zoneBoundary = new Set(zone.boundarySafeGroupKeys);
  const zonePoints = new Set(zone.points);
  const candidates = graph.possibleConnections
    .filter((candidate) => candidate.groups.includes(currentTarget.key))
    .map((candidate) => {
      const safeGroupKey = candidate.groups.find((groupKey) => groupKey !== currentTarget.key);
      const safeGroup = safeGroupKey ? graph.stringsByKey.get(safeGroupKey) : undefined;
      if (
        !safeGroupKey ||
        !safeGroup ||
        safeGroup.color !== currentTarget.color ||
        !zoneBoundary.has(safeGroupKey) ||
        !bensonProofs.has(safeGroupKey)
      ) {
        return null;
      }
      const connectors = candidate.sharedLiberties.filter((point) => zonePoints.has(point));
      return Object.freeze({ safeGroupKey, safeGroup, connectors });
    })
    .filter(
      (
        candidate,
      ): candidate is Readonly<{
        safeGroupKey: string;
        safeGroup: EndgameStoneString;
        connectors: readonly PointId[];
      }> => candidate !== null,
    )
    .sort((left, right) =>
      left.safeGroupKey < right.safeGroupKey ? -1 : left.safeGroupKey > right.safeGroupKey ? 1 : 0,
    );

  if (candidates.length === 0) {
    return Object.freeze({ outcome: 'not-proven', reason: 'no-benson-connection-candidate' });
  }

  const engine = new GameEngine(topology);
  const targetTurn = makePlayingState(board, currentTarget.color);
  const opponent = opponentOf(currentTarget.color);

  for (const candidate of candidates) {
    const connectors = [...candidate.connectors].sort(compareEndgamePointIds);
    for (let leftIndex = 0; leftIndex < connectors.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < connectors.length; rightIndex += 1) {
        const left = connectors[leftIndex]!;
        const right = connectors[rightIndex]!;

        if (
          !isQuietConnectionMove(
            engine,
            targetTurn,
            left,
            currentTarget.color,
            currentTarget.points,
            candidate.safeGroup.points,
          ) ||
          !isQuietConnectionMove(
            engine,
            targetTurn,
            right,
            currentTarget.color,
            currentTarget.points,
            candidate.safeGroup.points,
          )
        ) {
          continue;
        }

        let pairProven = true;
        for (const [blocked, response] of [
          [left, right],
          [right, left],
        ] as const) {
          const opponentTurn = makePlayingState(board, opponent);
          const block = engine.placeStone(opponentTurn, blocked, opponent);

          // Treat an unavailable cut as harmless. If it is legal, Work 5B only
          // accepts the quiet case; captures/fights belong to Work 5C or later.
          if (!block.ok) continue;
          if (block.captured.length !== 0) {
            pairProven = false;
            break;
          }

          if (
            !isQuietConnectionMove(
              engine,
              block.state,
              response,
              currentTarget.color,
              currentTarget.points,
              candidate.safeGroup.points,
            )
          ) {
            pairProven = false;
            break;
          }
        }

        if (!pairProven) continue;

        return Object.freeze({
          outcome: 'proven' as const,
          evidence: Object.freeze({
            algorithm: SAFE_CONNECTION_ALGORITHM,
            proof: 'miai-two-shared-liberties-to-benson' as const,
            targetGroupKey: currentTarget.key,
            safeGroupKey: candidate.safeGroupKey,
            safeGroupPoints: candidate.safeGroup.points,
            connectors: Object.freeze([left, right]) as readonly [PointId, PointId],
            relevanceLocalPositionKey: zone.localPositionKey!,
          }),
        });
      }
    }
  }

  return Object.freeze({ outcome: 'not-proven', reason: 'no-simple-miai-pair' });
};
