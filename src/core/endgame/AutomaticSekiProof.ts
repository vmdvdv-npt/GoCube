import type { GameState, StoneColor } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

export const AUTOMATIC_SEKI_ALGORITHM = 'closed-mutual-two-liberties-seki-v1';

export interface SekiAnalysisGroup {
  readonly key: string;
  readonly points: readonly PointId[];
  readonly color: StoneColor;
  readonly liberties: readonly PointId[];
}

export interface SekiCandidate {
  readonly groupKeys: readonly [string, string];
  readonly sharedLiberties: readonly [PointId, PointId];
}

export interface AutomaticSekiProof {
  readonly algorithm: typeof AUTOMATIC_SEKI_ALGORITHM;
  readonly candidate: 'two-shared-liberties';
  readonly proof: 'closed-mutual-capture';
  readonly sharedLiberties: readonly [PointId, PointId];
  readonly groups: readonly (readonly PointId[])[];
}

export type SekiVerificationResult =
  | Readonly<{ readonly proven: true; readonly evidence: AutomaticSekiProof }>
  | Readonly<{
      readonly proven: false;
      readonly reason:
        | 'candidate-group-missing'
        | 'candidate-colors-not-opposed'
        | 'candidate-no-longer-two-shared-liberties'
        | 'shared-liberty-not-empty'
        | 'shared-liberty-not-mutual'
        | 'shared-liberty-has-external-empty-neighbor'
        | 'boundary-group-not-indexed'
        | 'shared-liberty-touches-third-group';
    }>;

export interface SekiVerificationContext {
  readonly state: GameState;
  readonly topology: Topology;
  readonly groups: ReadonlyMap<string, SekiAnalysisGroup>;
  readonly pointOwner: ReadonlyMap<PointId, string>;
}

const sortedLiberties = (group: SekiAnalysisGroup): readonly PointId[] =>
  [...group.liberties].sort();

const haveSameTwoLiberties = (
  first: SekiAnalysisGroup,
  second: SekiAnalysisGroup,
): first is SekiAnalysisGroup & { readonly liberties: readonly [PointId, PointId] } => {
  if (first.liberties.length !== 2 || second.liberties.length !== 2) return false;
  const firstLiberties = sortedLiberties(first);
  const secondLiberties = sortedLiberties(second);
  return (
    firstLiberties[0] === secondLiberties[0] &&
    firstLiberties[1] === secondLiberties[1]
  );
};

/**
 * Candidate generation intentionally recognizes only the smallest structural
 * shape worth verifying: two unresolved opposing groups with exactly the same
 * two liberties. The verifier is responsible for proving that those liberties
 * form a closed mutual-capture boundary before either group can become seki.
 */
export const generateSekiCandidates = (
  groups: ReadonlyMap<string, SekiAnalysisGroup>,
  excludedGroupKeys: ReadonlySet<string>,
): readonly SekiCandidate[] => {
  const eligible = [...groups.values()]
    .filter((group) => !excludedGroupKeys.has(group.key) && group.liberties.length === 2)
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  const candidates: SekiCandidate[] = [];

  for (let firstIndex = 0; firstIndex < eligible.length; firstIndex += 1) {
    const first = eligible[firstIndex]!;
    for (let secondIndex = firstIndex + 1; secondIndex < eligible.length; secondIndex += 1) {
      const second = eligible[secondIndex]!;
      if (first.color === second.color || !haveSameTwoLiberties(first, second)) continue;
      const sharedLiberties = sortedLiberties(first) as readonly [PointId, PointId];
      candidates.push(
        Object.freeze({
          groupKeys: Object.freeze([first.key, second.key]) as readonly [string, string],
          sharedLiberties: Object.freeze([...sharedLiberties]) as readonly [PointId, PointId],
        }),
      );
    }
  }

  return Object.freeze(candidates);
};

/**
 * Strict proof for an intentionally narrow automatic-seki subset.
 *
 * Both opposing groups must have exactly the same two liberties. Each shared
 * liberty may touch only the two candidate groups and, optionally, the other
 * shared liberty; no third group or additional empty escape point is allowed.
 *
 * Under that closed boundary, playing either liberty joins the mover's group
 * while both groups are left with only the other shared liberty. The opponent
 * can answer on that last liberty and capture the initiating group. The same is
 * true symmetrically for either color, so neither group can force a capture by
 * initiating play and the two shared points remain neutral mutual-life space.
 * Anything outside this proof remains unresolved.
 */
export const verifySekiCandidate = (
  candidate: SekiCandidate,
  context: SekiVerificationContext,
): SekiVerificationResult => {
  const [firstKey, secondKey] = candidate.groupKeys;
  const first = context.groups.get(firstKey);
  const second = context.groups.get(secondKey);
  if (!first || !second) {
    return Object.freeze({ proven: false, reason: 'candidate-group-missing' });
  }
  if (first.color === second.color) {
    return Object.freeze({ proven: false, reason: 'candidate-colors-not-opposed' });
  }
  if (!haveSameTwoLiberties(first, second)) {
    return Object.freeze({
      proven: false,
      reason: 'candidate-no-longer-two-shared-liberties',
    });
  }

  const actualLiberties = sortedLiberties(first);
  if (
    actualLiberties[0] !== candidate.sharedLiberties[0] ||
    actualLiberties[1] !== candidate.sharedLiberties[1]
  ) {
    return Object.freeze({
      proven: false,
      reason: 'candidate-no-longer-two-shared-liberties',
    });
  }

  const pairKeys = new Set(candidate.groupKeys);
  const sharedLiberties = new Set<PointId>(candidate.sharedLiberties);

  for (const liberty of candidate.sharedLiberties) {
    if (context.state.board[liberty] !== 'empty') {
      return Object.freeze({ proven: false, reason: 'shared-liberty-not-empty' });
    }

    const adjacentOwners = new Set<string>();
    for (const neighbor of context.topology.neighbors(liberty)) {
      if (context.state.board[neighbor] === 'empty') {
        if (!sharedLiberties.has(neighbor)) {
          return Object.freeze({
            proven: false,
            reason: 'shared-liberty-has-external-empty-neighbor',
          });
        }
        continue;
      }

      const owner = context.pointOwner.get(neighbor);
      if (!owner) {
        return Object.freeze({ proven: false, reason: 'boundary-group-not-indexed' });
      }
      if (!pairKeys.has(owner)) {
        return Object.freeze({ proven: false, reason: 'shared-liberty-touches-third-group' });
      }
      adjacentOwners.add(owner);
    }

    if (!adjacentOwners.has(firstKey) || !adjacentOwners.has(secondKey)) {
      return Object.freeze({ proven: false, reason: 'shared-liberty-not-mutual' });
    }
  }

  return Object.freeze({
    proven: true,
    evidence: Object.freeze({
      algorithm: AUTOMATIC_SEKI_ALGORITHM,
      candidate: 'two-shared-liberties' as const,
      proof: 'closed-mutual-capture' as const,
      sharedLiberties: candidate.sharedLiberties,
      groups: Object.freeze([first.points, second.points]),
    }),
  });
};
