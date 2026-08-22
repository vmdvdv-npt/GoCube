import type {
  EndgameAnalysisContext,
  EndgameClassifier,
  EndgameProposal,
} from './EndgameClassifier';
import {
  canonicalizeEndgameGroup,
  endgameGroupId,
} from './EndgameGroupIdentity';
import type { PointOccupancy, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

interface ValidatedGroup {
  readonly key: string;
  readonly points: readonly PointId[];
}

/**
 * Manual-only implementation of the proposal contract.
 * It validates the complete logical stone groups and deliberately leaves every
 * group unresolved for the session-owned review to resolve.
 */
export class ManualEndgameClassifier implements EndgameClassifier {
  async analyze(context: EndgameAnalysisContext): Promise<EndgameProposal> {
    const requested = new Map<string, ValidatedGroup>();
    const requestedPointOwners = new Map<PointId, string>();

    for (const group of context.groups) {
      const validated = validateGroup(
        context.state.board,
        context.topology,
        group,
        'Requested group',
      );
      if (requested.has(validated.key)) {
        throw new Error(`Duplicate group requested for analysis: ${validated.key}`);
      }

      for (const point of validated.points) {
        const existingGroup = requestedPointOwners.get(point);
        if (existingGroup) {
          throw new Error(`Requested groups overlap at point: ${point}`);
        }
        requestedPointOwners.set(point, validated.key);
      }

      requested.set(validated.key, validated);
    }

    return Object.freeze(
      [...requested.values()]
        .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
        .map((group) =>
          Object.freeze({
            points: group.points,
            status: 'unresolved' as const,
          }),
        ),
    );
  }
}

export const validateEndgameGroup = (
  board: Readonly<Record<PointId, PointOccupancy>>,
  topology: Topology,
  points: readonly PointId[],
): readonly PointId[] => validateGroup(board, topology, points, 'Endgame group').points;

const validateGroup = (
  board: Readonly<Record<PointId, PointOccupancy>>,
  topology: Topology,
  points: readonly PointId[],
  label: string,
): ValidatedGroup => {
  if (points.length === 0) throw new Error(`${label} must contain at least one point`);

  const canonicalPoints = canonicalizeEndgameGroup(points);
  const pointSet = new Set<PointId>();
  let color: StoneColor | null = null;

  for (const point of canonicalPoints) {
    if (pointSet.has(point)) throw new Error(`${label} contains duplicate point: ${point}`);
    pointSet.add(point);

    if (!topology.has(point)) throw new Error(`${label} contains unknown point: ${point}`);

    const occupancy = board[point];
    if (occupancy !== 'black' && occupancy !== 'white') {
      throw new Error(`${label} contains non-stone point: ${point}`);
    }

    if (color === null) color = occupancy;
    else if (occupancy !== color) throw new Error(`${label} contains stones of different colors`);
  }

  const visited = new Set<PointId>();
  const pending: PointId[] = [canonicalPoints[0]!];
  visited.add(canonicalPoints[0]!);

  while (pending.length > 0) {
    const point = pending.pop()!;
    for (const neighbor of topology.neighbors(point)) {
      if (pointSet.has(neighbor) && !visited.has(neighbor)) {
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
  }

  if (visited.size !== canonicalPoints.length) {
    throw new Error(`${label} is not connected through Topology`);
  }

  for (const point of canonicalPoints) {
    for (const neighbor of topology.neighbors(point)) {
      if (board[neighbor] === color && !pointSet.has(neighbor)) {
        throw new Error(`${label} is not a complete stone group: missing ${neighbor}`);
      }
    }
  }

  return Object.freeze({
    key: endgameGroupId(canonicalPoints),
    points: canonicalPoints,
  });
};
