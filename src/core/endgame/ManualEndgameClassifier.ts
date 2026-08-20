import type {
  EndgameClassification,
  EndgameClassifier,
  GroupStatus,
} from './EndgameClassifier';
import type { GameState, PointOccupancy, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

export interface ManualGroupDecision {
  readonly points: readonly PointId[];
  readonly status: GroupStatus;
}

interface ValidatedGroup {
  readonly key: string;
  readonly points: readonly PointId[];
}

const isGroupStatus = (value: unknown): value is GroupStatus =>
  value === 'alive' || value === 'dead' || value === 'seki';

const comparePointIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalizePoints = (points: readonly PointId[]): readonly PointId[] =>
  Object.freeze([...points].sort(comparePointIds));

const groupKey = (points: readonly PointId[]): string => JSON.stringify(points);

/**
 * Converts explicit player decisions into the shared endgame classification format.
 * It validates groups against the logical board/topology, but never infers or overrides a status.
 */
export class ManualEndgameClassifier implements EndgameClassifier {
  private readonly board: Readonly<Record<PointId, PointOccupancy>>;
  private readonly decisions: readonly ManualGroupDecision[];

  constructor(
    state: GameState,
    private readonly topology: Topology,
    decisions: readonly ManualGroupDecision[],
  ) {
    this.board = Object.freeze({ ...state.board });
    this.decisions = Object.freeze(
      decisions.map((decision) =>
        Object.freeze({
          points: Object.freeze([...decision.points]),
          status: decision.status,
        }),
      ),
    );
  }

  async classify(groups: readonly (readonly PointId[])[]): Promise<EndgameClassification> {
    const requested = new Map<string, ValidatedGroup>();
    const requestedPointOwners = new Map<PointId, string>();

    for (const group of groups) {
      const validated = this.validateGroup(group, 'Requested group');
      if (requested.has(validated.key)) {
        throw new Error(`Duplicate group requested for classification: ${validated.key}`);
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

    const decisionsByGroup = new Map<string, GroupStatus>();

    for (const decision of this.decisions) {
      if (!isGroupStatus(decision.status)) {
        throw new Error(`Invalid manual group status: ${String(decision.status)}`);
      }

      const validated = this.validateGroup(decision.points, 'Manual decision');
      if (!requested.has(validated.key)) {
        throw new Error(`Manual decision does not match a requested group: ${validated.key}`);
      }

      const existingStatus = decisionsByGroup.get(validated.key);
      if (existingStatus) {
        if (existingStatus !== decision.status) {
          throw new Error(`Conflicting manual decisions for group: ${validated.key}`);
        }
        throw new Error(`Duplicate manual decision for group: ${validated.key}`);
      }

      decisionsByGroup.set(validated.key, decision.status);
    }

    const result = [...requested.values()]
      .sort((left, right) => comparePointIds(left.key, right.key))
      .map((group) => {
        const status = decisionsByGroup.get(group.key);
        if (!status) throw new Error(`Missing manual decision for group: ${group.key}`);

        return Object.freeze({
          points: group.points,
          status,
          source: 'user' as const,
        });
      });

    return Object.freeze(result);
  }

  private validateGroup(points: readonly PointId[], label: string): ValidatedGroup {
    if (points.length === 0) throw new Error(`${label} must contain at least one point`);

    const canonicalPoints = canonicalizePoints(points);
    const pointSet = new Set<PointId>();
    let color: StoneColor | null = null;

    for (const point of canonicalPoints) {
      if (pointSet.has(point)) throw new Error(`${label} contains duplicate point: ${point}`);
      pointSet.add(point);

      if (!this.topology.has(point)) throw new Error(`${label} contains unknown point: ${point}`);

      const occupancy = this.board[point];
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
      for (const neighbor of this.topology.neighbors(point)) {
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
      for (const neighbor of this.topology.neighbors(point)) {
        if (this.board[neighbor] === color && !pointSet.has(neighbor)) {
          throw new Error(`${label} is not a complete stone group: missing ${neighbor}`);
        }
      }
    }

    return Object.freeze({
      key: groupKey(canonicalPoints),
      points: canonicalPoints,
    });
  }
}
