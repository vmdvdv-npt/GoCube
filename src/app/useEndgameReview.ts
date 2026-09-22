import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { PointId, Topology } from '../core/topology/Topology';
import {
  buildEndgamePresentation,
  type EndgamePresentationModel,
} from '../presentation/EndgamePresentation';
import type { EndgameTerritoryOwner } from '../presentation/EndgameTerritoryPresentation';
import type { GameViewModel } from '../presentation/PresentationModel';
import type {
  EndgameReviewReadyListener,
  SharedEndgameDecisions,
  SharedEndgameGroup,
} from './GameSessionControllerFacade';

export interface EndgameReviewController {
  readonly topology: Topology;
  viewModel(): GameViewModel;
  endgameReviewReady(): boolean;
  endgameGroups(): readonly SharedEndgameGroup[];
  endgameDecisions(): SharedEndgameDecisions;
  endgameTerritory(): ReadonlyMap<PointId, EndgameTerritoryOwner>;
  endgameManualGroupIds(): readonly string[];
  canFinishEndgame(): boolean;
  setEndgameDecision(groupId: string, status: GroupStatus): Promise<void>;
  subscribeEndgameReviewReady(listener: EndgameReviewReadyListener): () => void;
}

export interface UseEndgameReviewOptions {
  readonly onReviewReady?: (viewModel: GameViewModel) => void;
}

const emptyTerritory = (): ReadonlyMap<PointId, EndgameTerritoryOwner> => new Map();

export function useEndgameReview(
  controller: EndgameReviewController,
  options: UseEndgameReviewOptions = {},
) {
  const initial = controller.viewModel();
  const [groups, setGroups] = useState<readonly SharedEndgameGroup[]>(() =>
    initial.phase === 'endgame' ? controller.endgameGroups() : [],
  );
  const [decisions, setDecisions] = useState<SharedEndgameDecisions>(() =>
    initial.phase === 'endgame' ? controller.endgameDecisions() : {},
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [reviewReady, setReviewReady] = useState(
    initial.phase === 'endgame' && controller.endgameReviewReady(),
  );
  const [territory, setTerritory] = useState<ReadonlyMap<PointId, EndgameTerritoryOwner>>(() =>
    initial.phase === 'endgame' && controller.endgameReviewReady()
      ? controller.endgameTerritory()
      : emptyTerritory(),
  );
  const [manualGroupIds, setManualGroupIds] = useState<readonly string[]>(() =>
    initial.phase === 'endgame' && controller.endgameReviewReady()
      ? controller.endgameManualGroupIds()
      : [],
  );
  const [canFinish, setCanFinish] = useState(
    initial.phase === 'endgame' && controller.canFinishEndgame(),
  );

  const sync = useCallback((viewModel: GameViewModel = controller.viewModel()): void => {
    if (viewModel.phase !== 'endgame') {
      setGroups([]);
      setDecisions({});
      setSelectedGroupId(null);
      setHoveredGroupId(null);
      setReviewReady(false);
      setTerritory(emptyTerritory());
      setManualGroupIds([]);
      setCanFinish(false);
      return;
    }

    const nextGroups = controller.endgameGroups();
    const ready = controller.endgameReviewReady();
    setGroups(nextGroups);
    setDecisions(controller.endgameDecisions());
    setHoveredGroupId(null);
    setReviewReady(ready);
    setTerritory(ready ? controller.endgameTerritory() : emptyTerritory());
    setManualGroupIds(ready ? controller.endgameManualGroupIds() : []);
    setCanFinish(controller.canFinishEndgame());
    setSelectedGroupId((current) =>
      current && nextGroups.some((group) => group.id === current) ? current : null,
    );
  }, [controller]);

  useEffect(() => {
    sync(controller.viewModel());
  }, [controller, sync]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const dismissOnOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-floating-endgame-control="true"]')
      ) {
        return;
      }
      setSelectedGroupId(null);
    };

    document.addEventListener('pointerdown', dismissOnOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointerDown, true);
  }, []);

  useEffect(() => controller.subscribeEndgameReviewReady(() => {
    const viewModel = controller.viewModel();
    if (viewModel.phase !== 'endgame') return;
    sync(viewModel);
    options.onReviewReady?.(viewModel);
  }), [controller, options.onReviewReady, sync]);

  const setDecision = useCallback(async (groupId: string, status: GroupStatus): Promise<void> => {
    await controller.setEndgameDecision(groupId, status);
    sync(controller.viewModel());
    setSelectedGroupId(null);
  }, [controller, sync]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const resolvedCount = useMemo(
    () => groups.filter((group) => Boolean(decisions[group.id])).length,
    [decisions, groups],
  );
  const manualReviewed = useMemo(
    () => manualGroupIds.filter((groupId) => Boolean(decisions[groupId])).length,
    [decisions, manualGroupIds],
  );
  const automaticClassified = reviewReady
    ? Math.max(0, groups.length - manualGroupIds.length)
    : 0;

  const presentation: EndgamePresentationModel = useMemo(
    () => buildEndgamePresentation({
      groups,
      decisions,
      topology: controller.topology,
      territory,
      selectedGroupId,
      hoveredGroupId,
    }),
    [controller.topology, decisions, groups, hoveredGroupId, selectedGroupId, territory],
  );

  return {
    groups,
    decisions,
    selectedGroupId,
    setSelectedGroupId,
    selectedGroup,
    hoveredGroupId,
    setHoveredGroupId,
    reviewReady,
    territory,
    canFinish,
    resolvedCount,
    manualReviewed,
    manualTotal: manualGroupIds.length,
    automaticClassified,
    presentation,
    setDecision,
    sync,
  } as const;
}
