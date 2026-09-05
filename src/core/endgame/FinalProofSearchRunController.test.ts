import { describe, expect, it } from 'vitest';
import type { FinalProofSearchProgress } from './FinalProofSearch';
import { FinalProofSearchRunController } from './FinalProofSearchRunController';

const progressFor = (
  analysisId: string,
  exploredNodes: number,
): FinalProofSearchProgress => Object.freeze({
  algorithm: 'final-proof-search-v2',
  analysisId,
  groupsTotal: 2,
  groupsCompleted: exploredNodes > 0 ? 1 : 0,
  groupsPending: exploredNodes > 0 ? 1 : 2,
  currentGroup: 'g1',
  currentTier: 1,
  currentTierName: 'tactical',
  currentTierIndex: 0,
  currentTierBudget: 300,
  exploredNodes,
  elapsedMilliseconds: exploredNodes,
  totalUnresolvedGroups: 2,
  completedGroups: exploredNodes > 0 ? 1 : 0,
  resolvedAutomatically: exploredNodes > 0 ? 1 : 0,
  remainingUnresolved: exploredNodes > 0 ? 1 : 2,
  currentGroupKey: 'g1',
});

describe('FinalProofSearchRunController isolation', () => {
  it('keeps two concurrent controller progress channels completely isolated', () => {
    const firstController = new FinalProofSearchRunController();
    const secondController = new FinalProofSearchRunController();
    const firstSeen: Array<FinalProofSearchProgress | null> = [];
    const secondSeen: Array<FinalProofSearchProgress | null> = [];
    firstController.subscribe((progress) => firstSeen.push(progress));
    secondController.subscribe((progress) => secondSeen.push(progress));

    const first = firstController.begin();
    const second = secondController.begin();
    first.publish(progressFor(first.analysisId, 10));
    second.publish(progressFor(second.analysisId, 20));

    expect(firstController.current()?.analysisId).toBe(first.analysisId);
    expect(firstController.current()?.exploredNodes).toBe(10);
    expect(secondController.current()?.analysisId).toBe(second.analysisId);
    expect(secondController.current()?.exploredNodes).toBe(20);
    expect(firstSeen.filter(Boolean).map((progress) => progress!.analysisId)).toEqual([first.analysisId]);
    expect(secondSeen.filter(Boolean).map((progress) => progress!.analysisId)).toEqual([second.analysisId]);
  });

  it('cancels an older run when a replacement begins and ignores stale publications', () => {
    const controller = new FinalProofSearchRunController();
    const seen: Array<FinalProofSearchProgress | null> = [];
    controller.subscribe((progress) => seen.push(progress));

    const first = controller.begin();
    first.publish(progressFor(first.analysisId, 1));
    const second = controller.begin();

    expect(first.shouldStop()).toBe(true);
    first.publish(progressFor(first.analysisId, 999));
    second.publish(progressFor(second.analysisId, 2));
    expect(controller.current()?.analysisId).toBe(second.analysisId);
    expect(controller.current()?.exploredNodes).toBe(2);
    expect(seen.filter(Boolean).some((progress) => progress!.exploredNodes === 999)).toBe(false);
  });

  it('rejects progress that carries another analysis id', () => {
    const controller = new FinalProofSearchRunController();
    const run = controller.begin();
    expect(() => run.publish(progressFor('foreign-analysis', 1))).toThrow(
      'Final proof progress analysisId does not match its owning run',
    );
    expect(run.shouldStop()).toBe(false);
  });

  it('clears only its own active run on finish or cancellation', () => {
    const firstController = new FinalProofSearchRunController();
    const secondController = new FinalProofSearchRunController();
    const first = firstController.begin();
    const second = secondController.begin();
    first.publish(progressFor(first.analysisId, 3));
    second.publish(progressFor(second.analysisId, 4));

    first.finish();
    expect(firstController.current()).toBeNull();
    expect(secondController.current()?.analysisId).toBe(second.analysisId);

    secondController.cancelActive();
    expect(second.shouldStop()).toBe(true);
    expect(secondController.current()).toBeNull();
  });
});
