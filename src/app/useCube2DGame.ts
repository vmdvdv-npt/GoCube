import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointId } from '../core/topology/Topology';
import type { AnimationMode } from '../presentation/AnimationMode';
import { endgameGroupForPoint } from '../presentation/EndgameGroupPresentation';
import {
  createCube2DLayout,
  type Cube2DLayoutColumn,
} from '../presentation/cube/Cube2DLayout';
import {
  createCube2DViewState,
  navigateCube2DViewState,
  setCube2DVerticalAnchorColumn,
  type Cube2DNavigationDirection,
  type Cube2DViewState,
} from '../presentation/cube/Cube2DNavigation';
import {
  CUBE_2D_CAPTURE_FLIGHT_MS,
  CUBE_2D_CAPTURE_STAGGER_MS,
  buildCube2DCaptureEffects,
  type CapturedStoneEffect,
  type Cube2DCaptureSource,
} from '../presentation/cube/Cube2DVisualEffectsModel';
import {
  CUBE_2D_STAGE_WIDTH,
  CUBE_2D_TRANSITION_MS,
  createCube2DStagePointMap,
  type Cube2DHoverStatus,
  type Cube2DRendererTransition,
} from '../renderer2d/Cube2DRenderer';
import {
  type Cube2DGameActionResult,
  Cube2DGameController,
} from './Cube2DGameController';
import type { GameInteractionBoundary } from './GameInteractionBoundary';
import { useEndgameReview } from './useEndgameReview';

export const CUBE_ZOOM_MIN = 0.78;
export const CUBE_ZOOM_MAX = 4.05;
const clampZoom = (value: number) => Math.min(CUBE_ZOOM_MAX, Math.max(CUBE_ZOOM_MIN, value));

export interface Cube2DExternalAction {
  readonly sequence: number;
  readonly result: Cube2DGameActionResult;
}

export interface Cube2DGameHookOptions {
  readonly gameplayReadOnly?: boolean;
  readonly animationMode?: AnimationMode;
  readonly externalAction?: Cube2DExternalAction | null;
  readonly interaction?: GameInteractionBoundary;
}

export function useCube2DGame(
  controller: Cube2DGameController,
  options: Cube2DGameHookOptions = {},
) {
  const gameplayReadOnly = options.gameplayReadOnly ?? false;
  const animationMode = options.animationMode ?? 'normal';
  const interaction = options.interaction ?? controller;
  const initial = controller.viewModel();
  const [vm, setVm] = useState(() => initial);
  const endgame = useEndgameReview(controller, { onReviewReady: setVm });
  const [view, setView] = useState<Cube2DViewState>(() => createCube2DViewState());
  const [transition, setTransition] = useState<Cube2DRendererTransition | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<PointId | null>(null);
  const [hoverStatus, setHoverStatus] = useState<Cube2DHoverStatus>(null);
  const [resultOpen, setResultOpen] = useState(initial.phase === 'finished');
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [passGuarded, setPassGuarded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [zoom, setZoomState] = useState(1);
  const [capturedEffects, setCapturedEffects] = useState<readonly CapturedStoneEffect[]>([]);
  const inFlight = useRef(false);
  const transitionId = useRef(0);
  const captureId = useRef(0);
  const transitionTimer = useRef<number | null>(null);
  const captureTimer = useRef<number | null>(null);
  const passTimer = useRef<number | null>(null);
  const lastExternalActionSequence = useRef<number | null>(null);
  const layout = useMemo(
    () => createCube2DLayout(view.orientation, controller.size, view.verticalAnchorColumn),
    [controller.size, view],
  );
  const captureAnimating = capturedEffects.length > 0;

  useEffect(() => {
    const next = controller.viewModel();
    setVm(next);
    setView(createCube2DViewState());
    setTransition(null);
    setHoveredPoint(null);
    setHoverStatus(null);
    endgame.sync(next);
    setResultOpen(next.phase === 'finished');
    setPassGuarded(false);
    setFeedback(null);
    setZoomState(1);
    setCapturedEffects([]);
    lastExternalActionSequence.current = null;
    if (captureTimer.current !== null) {
      window.clearTimeout(captureTimer.current);
      captureTimer.current = null;
    }
  }, [controller, endgame.sync]);

  useEffect(
    () => () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
      if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
      if (passTimer.current !== null) window.clearTimeout(passTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (animationMode !== 'disabled') return;
    if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setCapturedEffects([]);
  }, [animationMode]);

  const clearHover = () => {
    setHoveredPoint(null);
    setHoverStatus(null);
    endgame.setHoveredGroupId(null);
  };
  const clearPassGuard = () => {
    setPassGuarded(false);
    if (passTimer.current !== null) window.clearTimeout(passTimer.current);
    passTimer.current = null;
  };
  const startPassGuard = () => {
    clearPassGuard();
    setPassGuarded(true);
    passTimer.current = window.setTimeout(clearPassGuard, 1000);
  };
  const apply = (action: Cube2DGameActionResult) => {
    clearHover();
    setVm(action.viewModel);
    setFeedback(action.accepted ? null : action.reason ?? 'Action rejected');
    setResultOpen(action.viewModel.phase === 'finished' && Boolean(action.viewModel.finalScore));
    endgame.sync(action.viewModel);
    if (action.viewModel.phase !== 'playing' || action.viewModel.consecutivePasses === 0) {
      clearPassGuard();
    }
  };
  const startCaptureEffects = (
    captured: readonly PointId[],
    previousSources: ReadonlyMap<PointId, Cube2DCaptureSource>,
  ) => {
    if (animationMode === 'disabled') {
      setCapturedEffects([]);
      return;
    }
    if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
    captureId.current += 1;
    const effects = buildCube2DCaptureEffects({
      generation: captureId.current,
      capturedPointIds: captured,
      previousSources,
      stageWidth: CUBE_2D_STAGE_WIDTH,
    });
    if (effects.length === 0) {
      setCapturedEffects([]);
      return;
    }
    setCapturedEffects(effects);
    captureTimer.current = window.setTimeout(
      () => {
        setCapturedEffects([]);
        captureTimer.current = null;
      },
      CUBE_2D_CAPTURE_FLIGHT_MS +
        CUBE_2D_CAPTURE_STAGGER_MS * (effects.length - 1) +
        80,
    );
  };

  useEffect(() => {
    const externalAction = options.externalAction;
    if (!externalAction || lastExternalActionSequence.current === externalAction.sequence) return;
    lastExternalActionSequence.current = externalAction.sequence;

    const renderedGeometry = createCube2DStagePointMap(layout);
    const previousSources = new Map<PointId, Cube2DCaptureSource>();
    for (const viewPoint of vm.points) {
      if (viewPoint.occupancy !== 'black' && viewPoint.occupancy !== 'white') continue;
      const geometry = renderedGeometry.get(viewPoint.logicalPointId);
      if (!geometry) continue;
      previousSources.set(
        viewPoint.logicalPointId,
        Object.freeze({ ...geometry, color: viewPoint.occupancy }),
      );
    }

    apply(externalAction.result);
    if (externalAction.result.accepted && externalAction.result.captured.length > 0) {
      startCaptureEffects(externalAction.result.captured, previousSources);
    }
  }, [animationMode, layout, options.externalAction, vm.points]);

  const moveView = (
    next: Cube2DViewState,
    direction: Cube2DRendererTransition['direction'],
  ) => {
    if (transition || captureAnimating) return;
    clearHover();
    transitionId.current += 1;
    setView(next);
    setTransition({ fromLayout: layout, direction, id: transitionId.current });
    transitionTimer.current = window.setTimeout(() => {
      setTransition(null);
      transitionTimer.current = null;
    }, animationMode === 'disabled' ? 0 : CUBE_2D_TRANSITION_MS);
  };
  const navigate = (direction: Cube2DNavigationDirection) =>
    moveView(navigateCube2DViewState(view, direction), direction);
  const moveAnchor = (column: Cube2DLayoutColumn) =>
    moveView(setCube2DVerticalAnchorColumn(view, column), 'anchor');
  const hover = (point: PointId | null) => {
    if (!point || transition || captureAnimating) {
      clearHover();
      return;
    }
    if (vm.phase === 'endgame') {
      setHoveredPoint(null);
      setHoverStatus(null);
      endgame.setHoveredGroupId(endgameGroupForPoint(endgame.groups, point)?.id ?? null);
      return;
    }
    if (vm.phase !== 'playing' || gameplayReadOnly) {
      clearHover();
      return;
    }
    const availability = controller.moveAvailability(point);
    endgame.setHoveredGroupId(null);
    setHoveredPoint(point);
    setHoverStatus(
      availability.allowed
        ? 'allowed'
        : availability.reason === 'occupied'
          ? 'occupied'
          : 'forbidden',
    );
  };
  const activate = async (point: PointId) => {
    if (transition || captureAnimating || inFlight.current) return;
    if (vm.phase === 'endgame') {
      const group = endgameGroupForPoint(endgame.groups, point);
      if (group) endgame.setSelectedGroupId(group.id);
      return;
    }
    if (gameplayReadOnly) return;
    if (vm.phase !== 'playing' || !controller.moveAvailability(point).allowed) {
      hover(point);
      return;
    }

    const renderedGeometry = createCube2DStagePointMap(layout);
    const previousSources = new Map<PointId, Cube2DCaptureSource>();
    for (const viewPoint of vm.points) {
      if (viewPoint.occupancy !== 'black' && viewPoint.occupancy !== 'white') continue;
      const geometry = renderedGeometry.get(viewPoint.logicalPointId);
      if (!geometry) continue;
      previousSources.set(
        viewPoint.logicalPointId,
        Object.freeze({ ...geometry, color: viewPoint.occupancy }),
      );
    }

    inFlight.current = true;
    try {
      const action = await interaction.placeStone(point);
      apply(action);
      if (action.accepted) startCaptureEffects(action.captured, previousSources);
    } finally {
      inFlight.current = false;
    }
  };
  const run = async (action: () => Promise<Cube2DGameActionResult>) => {
    if (inFlight.current || transition || captureAnimating) return;
    inFlight.current = true;
    try {
      apply(await action());
    } finally {
      inFlight.current = false;
    }
  };
  const pass = async () => {
    if (gameplayReadOnly || passGuarded || vm.phase !== 'playing' || captureAnimating) return;
    await run(async () => {
      const action = await interaction.pass();
      if (
        action.accepted &&
        action.viewModel.phase === 'playing' &&
        action.viewModel.consecutivePasses === 1
      ) {
        startPassGuard();
      }
      return action;
    });
  };
  const setDecision = async (groupId: string, status: 'alive' | 'dead' | 'seki') => {
    if (inFlight.current || vm.phase !== 'endgame') return;

    inFlight.current = true;
    try {
      await endgame.setDecision(groupId, status);
      setVm(controller.viewModel());
      setFeedback(null);
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : 'Endgame decision could not be saved.',
      );
      endgame.sync(controller.viewModel());
    } finally {
      inFlight.current = false;
    }
  };
  const finishEndgame = async () => {
    if (vm.phase !== 'endgame' || !endgame.canFinish) return;
    await run(() => controller.finishEndgame());
  };
  const setZoom = (next: number) => {
    const clamped = clampZoom(next);
    setZoomState(clamped);
    return clamped;
  };

  return {
    vm,
    view,
    layout,
    transition,
    hoveredPoint,
    hoverStatus,
    hoveredGroup: endgame.hoveredGroupId,
    groups: endgame.groups,
    decisions: endgame.decisions,
    setDecision,
    selectedGroup: endgame.selectedGroupId,
    selected: endgame.selectedGroup,
    resultOpen,
    setResultOpen,
    showMoveNumbers,
    setShowMoveNumbers,
    passGuarded,
    feedback,
    zoom,
    setZoom,
    capturedEffects,
    captureAnimating,
    navigate,
    moveAnchor,
    hover,
    activate,
    run,
    pass,
    finishEndgame,
    endgameReviewReady: endgame.reviewReady,
    canFinishEndgame: endgame.canFinish,
    endgameTerritory: endgame.territory,
    endgamePresentation: endgame.presentation,
    resolvedCount: endgame.resolvedCount,
    manualReviewed: endgame.manualReviewed,
    manualTotal: endgame.manualTotal,
    automaticClassified: endgame.automaticClassified,
    result: vm.phase === 'finished' ? controller.resultModel() : null,
    finalClassification:
      vm.phase === 'finished' ? controller.snapshot().endgameClassification : null,
  } as const;
}
