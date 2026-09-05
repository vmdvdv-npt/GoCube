import type {
  EndgameClassification,
  EndgameEvidence,
  EndgameProposal,
  EndgameProposalStatus,
  GroupStatus,
} from './EndgameClassifier';
import {
  canonicalizeEndgameGroup,
  endgameGroupId,
} from './EndgameGroupIdentity';
import type { PointId } from '../topology/Topology';

export interface EndgameReviewProposal {
  readonly status: EndgameProposalStatus;
  readonly evidence?: EndgameEvidence;
}

export interface EndgameReviewGroup {
  readonly points: readonly PointId[];
  readonly proposal: EndgameReviewProposal;
  readonly userDecision: GroupStatus | null;
}

export interface EndgameReviewState {
  readonly groups: readonly EndgameReviewGroup[];
}

const isGroupStatus = (value: EndgameProposalStatus): value is GroupStatus =>
  value === 'alive' || value === 'dead' || value === 'seki';

export const effectiveEndgameStatus = (
  group: EndgameReviewGroup,
): EndgameProposalStatus => group.userDecision ?? group.proposal.status;

export const createEndgameReviewState = (
  proposal: EndgameProposal,
): EndgameReviewState => {
  const seen = new Set<string>();
  const groups = proposal.map((group) => {
    const points = canonicalizeEndgameGroup(group.points);
    if (points.length === 0) throw new Error('Endgame proposal group must contain points');
    const id = endgameGroupId(points);
    if (seen.has(id)) throw new Error(`Duplicate endgame proposal group: ${id}`);
    seen.add(id);

    return Object.freeze({
      points,
      proposal: Object.freeze({
        status: group.status,
        ...(group.evidence ? { evidence: Object.freeze({ ...group.evidence }) } : {}),
      }),
      userDecision: null,
    });
  });

  groups.sort((left, right) => {
    const leftId = endgameGroupId(left.points);
    const rightId = endgameGroupId(right.points);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });

  return Object.freeze({ groups: Object.freeze(groups) });
};

export const cloneEndgameReviewState = (
  review: EndgameReviewState | null | undefined,
): EndgameReviewState | null => {
  if (!review) return null;

  return Object.freeze({
    groups: Object.freeze(
      review.groups.map((group) =>
        Object.freeze({
          points: canonicalizeEndgameGroup(group.points),
          proposal: Object.freeze({
            status: group.proposal.status,
            ...(group.proposal.evidence
              ? { evidence: Object.freeze({ ...group.proposal.evidence }) }
              : {}),
          }),
          userDecision: group.userDecision,
        }),
      ),
    ),
  });
};

/**
 * Replace only automatic proposal facts after Final Proof Search. Explicit user
 * decisions are authoritative and are deliberately preserved unchanged.
 */
export const applyEndgameProposal = (
  review: EndgameReviewState,
  proposal: EndgameProposal,
): EndgameReviewState => {
  const byId = new Map(proposal.map((group) => [endgameGroupId(group.points), group] as const));
  if (byId.size !== review.groups.length || proposal.length !== review.groups.length) {
    throw new Error('Final endgame proposal does not match review groups');
  }

  const groups = review.groups.map((group) => {
    const id = endgameGroupId(group.points);
    const updated = byId.get(id);
    if (!updated) throw new Error(`Final endgame proposal is missing group: ${id}`);
    if (endgameGroupId(updated.points) !== id) {
      throw new Error(`Final endgame proposal group mismatch: ${id}`);
    }
    return Object.freeze({
      points: group.points,
      proposal: Object.freeze({
        status: updated.status,
        ...(updated.evidence
          ? { evidence: Object.freeze({ ...updated.evidence }) }
          : {}),
      }),
      userDecision: group.userDecision,
    });
  });

  return Object.freeze({ groups: Object.freeze(groups) });
};

export const setEndgameReviewDecision = (
  review: EndgameReviewState,
  points: readonly PointId[],
  status: GroupStatus,
): EndgameReviewState => {
  const id = endgameGroupId(points);
  let matched = false;
  let changed = false;

  const groups = review.groups.map((group) => {
    if (endgameGroupId(group.points) !== id) return group;
    matched = true;
    if (group.userDecision === status) return group;
    changed = true;
    return Object.freeze({ ...group, userDecision: status });
  });

  if (!matched) throw new Error(`Unknown manual endgame group: ${id}`);
  if (!changed) return review;
  return Object.freeze({ groups: Object.freeze(groups) });
};

export const resolveEndgameClassification = (
  review: EndgameReviewState,
): EndgameClassification | null => {
  const classification = [] as {
    points: readonly PointId[];
    status: GroupStatus;
    source: 'automatic' | 'user';
  }[];

  for (const group of review.groups) {
    const effective = effectiveEndgameStatus(group);
    if (!isGroupStatus(effective)) return null;
    classification.push(
      Object.freeze({
        points: canonicalizeEndgameGroup(group.points),
        status: effective,
        source: group.userDecision ? 'user' : 'automatic',
      }),
    );
  }

  return Object.freeze(classification);
};
