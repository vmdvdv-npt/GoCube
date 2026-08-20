import type { RepetitionContext, RepetitionPolicy } from '../rules/RepetitionPolicy';
import type { PointId, Topology } from '../topology/Topology';
import type {
  BoardOccupancy,
  GameState,
  PointOccupancy,
  StoneColor,
} from './types';

export interface StoneGroup {
  readonly color: StoneColor;
  readonly points: readonly PointId[];
  readonly liberties: readonly PointId[];
}

export type MoveRejectionReason = 'occupied' | 'suicide' | 'repetition';

export interface AcceptedPlaceStoneResult {
  readonly ok: true;
  readonly state: GameState;
  readonly captured: readonly PointId[];
}

export interface RejectedPlaceStoneResult {
  readonly ok: false;
  readonly state: GameState;
  readonly reason: MoveRejectionReason;
}

export type PlaceStoneResult =
  | AcceptedPlaceStoneResult
  | RejectedPlaceStoneResult;

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const freezeState = (board: Record<PointId, PointOccupancy>): GameState =>
  Object.freeze({ board: Object.freeze(board) });

const rejectedMove = (
  state: GameState,
  reason: MoveRejectionReason,
): RejectedPlaceStoneResult =>
  Object.freeze({
    ok: false,
    state,
    reason,
  });

export class GameEngine {
  constructor(private readonly topology: Topology) {}

  createInitialState(): GameState {
    const board: Record<PointId, PointOccupancy> = {};

    for (const point of this.topology.points()) {
      board[point] = 'empty';
    }

    return freezeState(board);
  }

  groupAt(state: GameState, point: PointId): StoneGroup | null {
    this.assertKnownPoint(point);
    const color = state.board[point];

    if (color === 'empty') {
      return null;
    }

    return this.collectGroup(state.board, point, color);
  }

  placeStone(
    state: GameState,
    point: PointId,
    color: StoneColor,
    repetitionPolicy?: RepetitionPolicy,
    repetitionContext?: RepetitionContext,
  ): PlaceStoneResult {
    this.assertKnownPoint(point);

    if (state.board[point] !== 'empty') {
      return rejectedMove(state, 'occupied');
    }

    const board: Record<PointId, PointOccupancy> = { ...state.board };
    board[point] = color;

    const opponent = opponentOf(color);
    const visitedOpponentPoints = new Set<PointId>();
    const captured: PointId[] = [];

    for (const neighbor of this.topology.neighbors(point)) {
      if (board[neighbor] !== opponent || visitedOpponentPoints.has(neighbor)) {
        continue;
      }

      const group = this.collectGroup(board, neighbor, opponent);

      for (const groupPoint of group.points) {
        visitedOpponentPoints.add(groupPoint);
      }

      if (group.liberties.length === 0) {
        captured.push(...group.points);
      }
    }

    for (const capturedPoint of captured) {
      board[capturedPoint] = 'empty';
    }

    const ownGroup = this.collectGroup(board, point, color);

    if (ownGroup.liberties.length === 0) {
      return rejectedMove(state, 'suicide');
    }

    const candidateState = freezeState(board);

    if (
      repetitionPolicy &&
      !repetitionPolicy.isAllowed(
        repetitionContext ?? { states: Object.freeze([state]) },
        candidateState,
      )
    ) {
      return rejectedMove(state, 'repetition');
    }

    return Object.freeze({
      ok: true,
      state: candidateState,
      captured: Object.freeze(captured),
    });
  }

  private collectGroup(
    board: BoardOccupancy,
    start: PointId,
    color: StoneColor,
  ): StoneGroup {
    const points: PointId[] = [];
    const liberties = new Set<PointId>();
    const visited = new Set<PointId>([start]);
    const pending: PointId[] = [start];

    while (pending.length > 0) {
      const point = pending.pop()!;
      points.push(point);

      for (const neighbor of this.topology.neighbors(point)) {
        const occupancy = board[neighbor];

        if (occupancy === 'empty') {
          liberties.add(neighbor);
          continue;
        }

        if (occupancy === color && !visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }

    return Object.freeze({
      color,
      points: Object.freeze(points),
      liberties: Object.freeze([...liberties]),
    });
  }

  private assertKnownPoint(point: PointId): void {
    if (!this.topology.has(point)) {
      throw new Error(`Unknown point: ${point}`);
    }
  }
}
