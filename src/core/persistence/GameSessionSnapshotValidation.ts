import type {
  EndgameClassification,
  EndgameProposalStatus,
  GroupStatus,
} from '../endgame/EndgameClassifier';
import {
  canonicalizeEndgameGroup,
  endgameGroupId,
} from '../endgame/EndgameGroupIdentity';
import type { GameState, PointOccupancy, StoneColor } from '../game/types';
import type { ScoringStrategy } from '../scoring/Scoring';
import type { PointId, Topology } from '../topology/Topology';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStoneColor = (value: unknown): value is StoneColor =>
  value === 'black' || value === 'white';

const isPointOccupancy = (value: unknown): value is PointOccupancy =>
  value === 'empty' || isStoneColor(value);

const isGamePhase = (value: unknown): value is GameState['phase'] =>
  value === 'playing' || value === 'endgame' || value === 'finished';

const isGroupStatus = (value: unknown): value is GroupStatus =>
  value === 'alive' || value === 'dead' || value === 'seki';

const isProposalStatus = (value: unknown): value is EndgameProposalStatus =>
  isGroupStatus(value) || value === 'unresolved';

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * Runtime trust boundary for serialized GameState values.
 *
 * TypeScript types disappear at persistence boundaries. Every state restored
 * from storage must therefore prove its complete board shape and all
 * rule-relevant scalar fields before History, GameSession or presentation code
 * may treat it as GameState.
 */
export function assertSerializedGameState(
  value: unknown,
  topology: Topology,
  label: string,
): asserts value is GameState {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  const board = value.board;
  if (!isRecord(board)) {
    throw new Error(`${label} board must be an object`);
  }

  const expectedPoints = topology.points();
  const expectedPointSet = new Set(expectedPoints);
  const boardPoints = Object.keys(board);
  if (
    boardPoints.length !== expectedPoints.length ||
    boardPoints.some((point) => !expectedPointSet.has(point))
  ) {
    throw new Error(`${label} board point set does not match topology`);
  }

  for (const point of expectedPoints) {
    if (!Object.prototype.hasOwnProperty.call(board, point)) {
      throw new Error(`${label} board is missing point ${point}`);
    }
    if (!isPointOccupancy(board[point])) {
      throw new Error(`${label} has invalid occupancy at ${point}`);
    }
  }

  if (!isStoneColor(value.currentPlayer)) {
    throw new Error(`${label} has invalid current player`);
  }
  if (!isNonNegativeSafeInteger(value.moveNumber)) {
    throw new Error(`${label} has invalid move number`);
  }
  if (
    !isNonNegativeSafeInteger(value.consecutivePasses) ||
    value.consecutivePasses > 2 ||
    value.consecutivePasses > value.moveNumber
  ) {
    throw new Error(`${label} has invalid consecutive pass count`);
  }
  if (!isGamePhase(value.phase)) {
    throw new Error(`${label} has invalid phase`);
  }
  if (
    (value.phase === 'playing' && value.consecutivePasses >= 2) ||
    (value.phase !== 'playing' && value.consecutivePasses !== 2)
  ) {
    throw new Error(`${label} phase is inconsistent with consecutive passes`);
  }

  const captures = value.captures;
  if (
    !isRecord(captures) ||
    !isNonNegativeSafeInteger(captures.black) ||
    !isNonNegativeSafeInteger(captures.white)
  ) {
    throw new Error(`${label} has invalid capture counters`);
  }
}

/** Validates every current/past/redo GameState before snapshot restoration. */
export const assertSerializedSnapshotGameStates = (
  snapshot: unknown,
  topology: Topology,
): void => {
  if (!isRecord(snapshot)) {
    throw new Error('Saved session snapshot must be an object');
  }

  if (!Array.isArray(snapshot.history) || snapshot.history.length === 0) {
    throw new Error('Saved game history must be a non-empty array');
  }

  snapshot.history.forEach((state, index) =>
    assertSerializedGameState(state, topology, `Saved history state ${index}`),
  );

  if (snapshot.redo === undefined) return;
  if (!Array.isArray(snapshot.redo)) {
    throw new Error('Saved Redo stack must be an array');
  }

  snapshot.redo.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Saved Redo entry ${index} must be an object`);
    }
    assertSerializedGameState(entry.state, topology, `Saved Redo state ${index}`);
  });
};

const logicalStoneGroups = (
  state: GameState,
  topology: Topology,
): readonly (readonly PointId[])[] => {
  const visited = new Set<PointId>();
  const groups: PointId[][] = [];

  for (const start of topology.points()) {
    if (visited.has(start)) continue;
    const color = state.board[start];
    if (color !== 'black' && color !== 'white') continue;

    const group: PointId[] = [];
    const pending = [start];
    visited.add(start);

    while (pending.length > 0) {
      const point = pending.pop()!;
      group.push(point);
      for (const neighbor of topology.neighbors(point)) {
        if (!visited.has(neighbor) && state.board[neighbor] === color) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
      }
    }

    groups.push([...canonicalizeEndgameGroup(group)]);
  }

  return groups;
};

const assertSerializedGroupPoints = (
  value: unknown,
  state: GameState,
  topology: Topology,
  label: string,
): readonly PointId[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain points`);
  }

  const seen = new Set<PointId>();
  const points: PointId[] = [];
  for (const point of value) {
    if (typeof point !== 'string' || !topology.has(point)) {
      throw new Error(`${label} contains an unknown point: ${String(point)}`);
    }
    if (state.board[point] !== 'black' && state.board[point] !== 'white') {
      throw new Error(`${label} contains a point that is not a stone: ${point}`);
    }
    if (seen.has(point)) {
      throw new Error(`${label} contains duplicate point: ${point}`);
    }
    seen.add(point);
    points.push(point);
  }

  return canonicalizeEndgameGroup(points);
};

const assertExactLogicalGroups = (
  actualIds: readonly string[],
  expectedIds: readonly string[],
  label: string,
): void => {
  const actual = [...actualIds].sort();
  const expected = [...expectedIds].sort();
  if (
    actual.length !== expected.length ||
    actual.some((id, index) => id !== expected[index])
  ) {
    throw new Error(`${label} does not match all logical stone groups exactly once`);
  }
};

const assertSerializedEndgameReview = (
  value: unknown,
  state: GameState,
  topology: Topology,
  expectedGroupIds: readonly string[],
  label: string,
): void => {
  if (!isRecord(value) || !Array.isArray(value.groups)) {
    throw new Error(`Endgame review for ${label} must contain a groups array`);
  }

  const actualIds: string[] = [];
  const seen = new Set<string>();
  value.groups.forEach((groupValue, index) => {
    if (!isRecord(groupValue)) {
      throw new Error(`Endgame review group ${index} for ${label} must be an object`);
    }

    const points = assertSerializedGroupPoints(
      groupValue.points,
      state,
      topology,
      `Endgame review group ${index} for ${label}`,
    );
    const id = endgameGroupId(points);
    if (seen.has(id)) {
      throw new Error(`Endgame review for ${label} contains duplicate groups`);
    }
    seen.add(id);
    actualIds.push(id);

    if (
      groupValue.status !== undefined &&
      groupValue.status !== null &&
      !isGroupStatus(groupValue.status)
    ) {
      throw new Error(`Endgame review group for ${label} has invalid legacy status`);
    }
    if (
      groupValue.userDecision !== undefined &&
      groupValue.userDecision !== null &&
      !isGroupStatus(groupValue.userDecision)
    ) {
      throw new Error(`Endgame review group for ${label} has invalid user decision`);
    }

    if (groupValue.proposal !== undefined) {
      if (!isRecord(groupValue.proposal)) {
        throw new Error(`Endgame review group for ${label} has invalid proposal`);
      }
      if (!isProposalStatus(groupValue.proposal.status)) {
        throw new Error(`Endgame review group for ${label} has invalid proposal status`);
      }
      if (
        groupValue.proposal.evidence !== undefined &&
        !isRecord(groupValue.proposal.evidence)
      ) {
        throw new Error(`Endgame review group for ${label} has invalid proposal evidence`);
      }

      if (groupValue.status !== undefined) {
        const proposalStatus = groupValue.proposal.status;
        const effective =
          groupValue.userDecision !== undefined
            ? groupValue.userDecision
            : isGroupStatus(proposalStatus)
              ? proposalStatus
              : null;
        if (groupValue.status !== effective) {
          throw new Error(`Endgame review group for ${label} has inconsistent legacy status`);
        }
      }
    }
  });

  assertExactLogicalGroups(actualIds, expectedGroupIds, `Endgame review for ${label}`);
};

const validatedEndgameClassification = (
  value: unknown,
  state: GameState,
  topology: Topology,
  expectedGroupIds: readonly string[],
  label: string,
): EndgameClassification => {
  if (!Array.isArray(value)) {
    throw new Error(`Endgame classification for ${label} must be an array`);
  }

  const actualIds: string[] = [];
  const seen = new Set<string>();
  const classification = value.map((groupValue, index) => {
    if (!isRecord(groupValue)) {
      throw new Error(`Endgame classification group ${index} for ${label} must be an object`);
    }

    const points = assertSerializedGroupPoints(
      groupValue.points,
      state,
      topology,
      `Endgame classification group ${index} for ${label}`,
    );
    const id = endgameGroupId(points);
    if (seen.has(id)) {
      throw new Error(`Endgame classification for ${label} contains duplicate groups`);
    }
    seen.add(id);
    actualIds.push(id);

    if (!isGroupStatus(groupValue.status)) {
      throw new Error(`Endgame classification group for ${label} has invalid status`);
    }
    if (groupValue.source !== 'automatic' && groupValue.source !== 'user') {
      throw new Error(`Endgame classification group for ${label} has invalid source`);
    }

    return Object.freeze({
      points,
      status: groupValue.status,
      source: groupValue.source,
    });
  });

  assertExactLogicalGroups(
    actualIds,
    expectedGroupIds,
    `Endgame classification for ${label}`,
  );
  return Object.freeze(classification);
};

const sameSerializedValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => sameSerializedValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    return false;
  }
  return leftKeys.every((key) => sameSerializedValue(left[key], right[key]));
};

const assertSerializedStateMetadata = (
  state: GameState,
  metadata: Record<string, unknown>,
  topology: Topology,
  scoringStrategy: ScoringStrategy,
  komi: number,
  label: string,
): void => {
  const expectedGroupIds = logicalStoneGroups(state, topology).map(endgameGroupId);
  const review = metadata.endgameReview;
  const classificationValue = metadata.endgameClassification;
  const finalScore = metadata.finalScore;

  if (state.phase !== 'endgame' && review !== undefined && review !== null) {
    throw new Error(`Non-endgame ${label} must not include partial endgame review`);
  }
  if (state.phase === 'endgame' && review !== undefined && review !== null) {
    assertSerializedEndgameReview(review, state, topology, expectedGroupIds, label);
  }

  if (state.phase !== 'finished') {
    if (classificationValue !== undefined && classificationValue !== null) {
      throw new Error(`Unfinished ${label} must not include endgame classification`);
    }
    if (finalScore !== undefined && finalScore !== null) {
      throw new Error(`Unfinished ${label} must not include FinalScore`);
    }
    return;
  }

  if (review !== undefined && review !== null) {
    throw new Error(`Non-endgame ${label} must not include partial endgame review`);
  }
  if (classificationValue === undefined || classificationValue === null) {
    throw new Error(`Finished ${label} must include endgame classification`);
  }
  if (finalScore === undefined || finalScore === null) {
    throw new Error(`Finished ${label} must include FinalScore`);
  }

  const classification = validatedEndgameClassification(
    classificationValue,
    state,
    topology,
    expectedGroupIds,
    label,
  );
  const expectedScore = scoringStrategy.score(state, classification, komi);
  if (!sameSerializedValue(finalScore, expectedScore)) {
    throw new Error(`Saved FinalScore for ${label} does not match recomputed score`);
  }
};

/**
 * Runtime trust boundary for session-level metadata that is not part of
 * GameState. Review/classification group identity is proven against the exact
 * logical stone groups of its associated state. Persisted FinalScore is treated
 * only as a serialized derived value and must equal a fresh authoritative score
 * from the configured strategy before any presentation code may consume it.
 */
export const assertSerializedSnapshotSessionMetadata = (
  snapshot: unknown,
  topology: Topology,
  scoringStrategy: ScoringStrategy,
  komi: number,
): void => {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.history) || snapshot.history.length === 0) {
    throw new Error('Saved session snapshot must contain validated history');
  }

  const currentState = snapshot.history[snapshot.history.length - 1];
  assertSerializedGameState(currentState, topology, 'Saved current state');
  assertSerializedStateMetadata(
    currentState,
    snapshot,
    topology,
    scoringStrategy,
    komi,
    'current saved state',
  );

  if (snapshot.redo === undefined) return;
  if (!Array.isArray(snapshot.redo)) {
    throw new Error('Saved Redo stack must be an array');
  }

  snapshot.redo.forEach((entryValue, index) => {
    if (!isRecord(entryValue)) {
      throw new Error(`Saved Redo entry ${index} must be an object`);
    }
    assertSerializedGameState(entryValue.state, topology, `Saved Redo state ${index}`);
    assertSerializedStateMetadata(
      entryValue.state,
      entryValue,
      topology,
      scoringStrategy,
      komi,
      `saved Redo state ${index}`,
    );
  });
};
