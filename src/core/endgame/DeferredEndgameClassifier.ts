import type {
  EndgameClassification,
  EndgameClassifier,
} from './EndgameClassifier';
import type { PointId } from '../topology/Topology';

/**
 * Bridges GameSession's classifier boundary to an interactive endgame review.
 *
 * The session can enter ENDGAME_REVIEW and persist its review state immediately,
 * while completion remains suspended until an application-level review flow
 * resolves a fully validated EndgameClassification. The bridge is topology- and
 * renderer-neutral so both Torus and Cube use the same lifecycle seam.
 *
 * Version 0.3 can replace or compose this bridge with an assisted classifier
 * without changing GameSession, scoring, persistence, or renderer ownership.
 */
export class DeferredEndgameClassifier implements EndgameClassifier {
  private groups: readonly (readonly PointId[])[] | null = null;
  private resolvePending:
    | ((classification: EndgameClassification) => void)
    | null = null;
  private rejectPending: ((reason?: unknown) => void) | null = null;

  classify(
    groups: readonly (readonly PointId[])[],
  ): Promise<EndgameClassification> {
    if (this.resolvePending || this.rejectPending) {
      return Promise.reject(new Error('Endgame classification is already pending'));
    }

    this.groups = Object.freeze(
      groups.map((group) => Object.freeze([...group])),
    );

    return new Promise((resolve, reject) => {
      this.resolvePending = resolve;
      this.rejectPending = reject;
    });
  }

  pendingGroups(): readonly (readonly PointId[])[] | null {
    return this.groups;
  }

  resolve(classification: EndgameClassification): void {
    const resolve = this.resolvePending;
    if (!resolve || !this.groups) {
      throw new Error('No endgame classification is pending');
    }

    this.groups = null;
    this.resolvePending = null;
    this.rejectPending = null;
    resolve(classification);
  }

  cancel(): void {
    const reject = this.rejectPending;
    if (!reject || !this.groups) {
      throw new Error('No endgame classification is pending');
    }

    this.groups = null;
    this.resolvePending = null;
    this.rejectPending = null;
    reject(new Error('Endgame classification cancelled'));
  }
}
