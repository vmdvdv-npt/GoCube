import type { GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

export const AUTOMATIC_DEAD_ALGORITHM = 'sealed-single-liberty-dead-v1';

export interface DeadAnalysisGroup {
  readonly key: string;
  readonly points: readonly PointId[];
  readonly color: StoneColor;
  readonly liberties: readonly PointId[];
}

export interface DeadCandidate {
  readonly groupKey: string;
  readonly points: readonly PointId[];
  readonly color: StoneColor;
  readonly liberty: PointId;
}

export interface AutomaticDeadProof {
  readonly algorithm: typeof AUTOMATIC_DEAD_ALGORITHM;
  readonly candidate: 'single-liberty';
  readonly proof: 'sealed-liberty-with-pass-alive-boundary';
  readonly liberty: PointId;
  readonly boundaryAliveGroups: readonly (readonly PointId[])[];
}

export type DeadVerificationResult =
  | Readonly<{ readonly proven: true; readonly evidence: AutomaticDeadProof }>
  | Readonly<{
      readonly proven: false;
      readonly reason:
        | 'candidate-no-longer-single-liberty'
        | 'extension-has-external-liberty'
        | 'extension-connects-friendly-group'
        | 'boundary-group-not-indexed'
        | 'boundary-opponent-not-pass-alive';
    }>;

export interface DeadVerificationContext {
  readonly state: GameState;
  readonly topology: Topology;
  readonly groups: ReadonlyMap<string, DeadAnalysisGroup>;
  readonly pointOwner: ReadonlyMap<PointId, string>;
  readonly passAliveGroupKeys: ReadonlySet<string>;
}

const opponentOf = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

/**
 * Candidate generation is deliberately broader than the proof boundary.
 * A group with one liberty is tactically suspicious, but this function never
 * promotes the suspicion to an authoritative endgame status.
 */
export const generateDeadCandidates = (
  groups: ReadonlyMap<string, DeadAnalysisGroup>,
  passAliveGroupKeys: ReadonlySet<string>,
): readonly DeadCandidate[] =>
  Object.freeze(
    [...groups.values()]
      .filter((group) => !passAliveGroupKeys.has(group.key) && group.liberties.length === 1)
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .map((group) =>
        Object.freeze({
          groupKey: group.key,
          points: group.points,
          color: group.color,
          liberty: group.liberties[0]!,
        }),
      ),
  );

/**
 * Strict topology-neutral proof for the smallest safe Automatic Dead subset.
 *
 * The candidate has exactly one current liberty. Filling that liberty cannot
 * save it when the point has no further empty neighbor, cannot connect to a
 * friendly group, and every opponent group whose removal could create a new
 * liberty is already Benson/pass-alive. Therefore any move away from the sole
 * liberty leaves the candidate immediately capturable, while filling the sole
 * liberty is a suicide/no-save move. Anything outside this proof is unresolved.
 */
export const verifyDeadCandidate = (
  candidate: DeadCandidate,
  context: DeadVerificationContext,
): DeadVerificationResult => {
  const group = context.groups.get(candidate.groupKey);
  if (!group || group.liberties.length !== 1 || group.liberties[0] !== candidate.liberty) {
    return Object.freeze({ proven: false, reason: 'candidate-no-longer-single-liberty' });
  }

  const candidatePoints = new Set(candidate.points);
  const opponent = opponentOf(candidate.color);
  const boundaryOpponentKeys = new Set<string>();

  const inspectOccupiedBoundary = (point: PointId): DeadVerificationResult | null => {
    const occupancy = context.state.board[point];
    if (occupancy === 'empty') return null;

    const owner = context.pointOwner.get(point);
    if (!owner) {
      return Object.freeze({ proven: false, reason: 'boundary-group-not-indexed' });
    }

    if (occupancy === candidate.color) {
      if (owner !== candidate.groupKey && !candidatePoints.has(point)) {
        return Object.freeze({ proven: false, reason: 'extension-connects-friendly-group' });
      }
      return null;
    }

    if (occupancy === opponent) boundaryOpponentKeys.add(owner);
    return null;
  };

  for (const point of candidate.points) {
    for (const neighbor of context.topology.neighbors(point)) {
      if (neighbor === candidate.liberty || candidatePoints.has(neighbor)) continue;
      const rejected = inspectOccupiedBoundary(neighbor);
      if (rejected) return rejected;
    }
  }

  for (const neighbor of context.topology.neighbors(candidate.liberty)) {
    if (candidatePoints.has(neighbor)) continue;
    if (context.state.board[neighbor] === 'empty') {
      return Object.freeze({ proven: false, reason: 'extension-has-external-liberty' });
    }
    const rejected = inspectOccupiedBoundary(neighbor);
    if (rejected) return rejected;
  }

  for (const groupKey of boundaryOpponentKeys) {
    if (!context.passAliveGroupKeys.has(groupKey)) {
      return Object.freeze({ proven: false, reason: 'boundary-opponent-not-pass-alive' });
    }
  }

  const boundaryAliveGroups = Object.freeze(
    [...boundaryOpponentKeys]
      .sort()
      .map((groupKey) => context.groups.get(groupKey)?.points)
      .filter((points): points is readonly PointId[] => points !== undefined),
  );

  return Object.freeze({
    proven: true,
    evidence: Object.freeze({
      algorithm: AUTOMATIC_DEAD_ALGORITHM,
      candidate: 'single-liberty' as const,
      proof: 'sealed-liberty-with-pass-alive-boundary' as const,
      liberty: candidate.liberty,
      boundaryAliveGroups,
    }),
  });
};
