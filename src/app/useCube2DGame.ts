import { useEffect, useMemo, useRef, useState } from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { PointId } from '../core/topology/Topology';
import { endgameGroupForPoint } from '../presentation/EndgameGroupPresentation';
import { createCube2DLayout, type Cube2DLayoutColumn } from '../presentation/cube/Cube2DLayout';
import { createCube2DViewState, navigateCube2DViewState, setCube2DVerticalAnchorColumn, type Cube2DNavigationDirection, type Cube2DViewState } from '../presentation/cube/Cube2DNavigation';
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
import { type Cube2DEndgameDecisions, type Cube2DEndgameGroup, type Cube2DGameActionResult, Cube2DGameController } from './Cube2DGameController';

export const CUBE_ENDGAME_STATUSES: readonly GroupStatus[] = ['alive', 'dead', 'seki'];
export const cubeEndgameStatusLabel = (status: GroupStatus) => status === 'alive' ? 'Alive' : status === 'dead' ? 'Dead' : 'Seki';
export const CUBE_ZOOM_MIN = 0.78;
export const CUBE_ZOOM_MAX = 4.05;
const clampZoom = (value: number) => Math.min(CUBE_ZOOM_MAX, Math.max(CUBE_ZOOM_MIN, value));

export function useCube2DGame(controller: Cube2DGameController) {
  const initial = controller.viewModel();
  const [vm, setVm] = useState(() => initial);
  const [view, setView] = useState<Cube2DViewState>(() => createCube2DViewState());
  const [transition, setTransition] = useState<Cube2DRendererTransition | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<PointId | null>(null);
  const [hoverStatus, setHoverStatus] = useState<Cube2DHoverStatus>(null);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [groups, setGroups] = useState<readonly Cube2DEndgameGroup[]>(() => initial.phase === 'endgame' ? controller.endgameGroups() : []);
  const [decisions, setDecisionsState] = useState<Cube2DEndgameDecisions>(() => initial.phase === 'endgame' ? controller.endgameDecisions() : {});
  const [selectedGroup, setSelectedGroup] = useState<string | null>(() => initial.phase === 'endgame' ? controller.nextUnresolvedEndgameGroupId() : null);
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
  const layout = useMemo(() => createCube2DLayout(view.orientation, controller.size, view.verticalAnchorColumn), [controller.size, view]);
  const captureAnimating = capturedEffects.length > 0;

  useEffect(() => {
    const next = controller.viewModel();
    setVm(next); setView(createCube2DViewState()); setTransition(null); setHoveredPoint(null); setHoverStatus(null); setHoveredGroup(null);
    setGroups(next.phase === 'endgame' ? controller.endgameGroups() : []); setDecisionsState(next.phase === 'endgame' ? controller.endgameDecisions() : {}); setSelectedGroup(next.phase === 'endgame' ? controller.nextUnresolvedEndgameGroupId() : null); setResultOpen(next.phase === 'finished');
    setPassGuarded(false); setFeedback(null); setZoomState(1); setCapturedEffects([]);
    if (captureTimer.current !== null) {
      window.clearTimeout(captureTimer.current);
      captureTimer.current = null;
    }
  }, [controller]);
  useEffect(() => () => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    if (captureTimer.current !== null) window.clearTimeout(captureTimer.current);
    if (passTimer.current !== null) window.clearTimeout(passTimer.current);
  }, []);

  const clearHover = () => { setHoveredPoint(null); setHoverStatus(null); setHoveredGroup(null); };
  const clearPassGuard = () => { setPassGuarded(false); if (passTimer.current !== null) window.clearTimeout(passTimer.current); passTimer.current = null; };
  const startPassGuard = () => { clearPassGuard(); setPassGuarded(true); passTimer.current = window.setTimeout(clearPassGuard, 1000); };
  const apply = (action: Cube2DGameActionResult) => {
    clearHover(); setVm(action.viewModel); setFeedback(action.accepted ? null : action.reason ?? 'Action rejected'); setResultOpen(action.viewModel.phase === 'finished' && Boolean(action.viewModel.finalScore));
    if (action.viewModel.phase === 'endgame') { setGroups(controller.endgameGroups()); setDecisionsState(controller.endgameDecisions()); setSelectedGroup(controller.nextUnresolvedEndgameGroupId()); } else { setGroups([]); setDecisionsState({}); setSelectedGroup(null); }
    if (action.viewModel.phase !== 'playing' || action.viewModel.consecutivePasses === 0) clearPassGuard();
  };
  const startCaptureEffects = (
    captured: readonly PointId[],
    previousSources: ReadonlyMap<PointId, Cube2DCaptureSource>,
  ) => {
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
      CUBE_2D_CAPTURE_FLIGHT_MS + CUBE_2D_CAPTURE_STAGGER_MS * (effects.length - 1) + 80,
    );
  };
  const moveView = (next: Cube2DViewState, direction: Cube2DRendererTransition['direction']) => {
    if (transition || captureAnimating) return; clearHover(); transitionId.current += 1; setView(next); setTransition({ fromLayout: layout, direction, id: transitionId.current });
    transitionTimer.current = window.setTimeout(() => { setTransition(null); transitionTimer.current = null; }, CUBE_2D_TRANSITION_MS);
  };
  const navigate = (direction: Cube2DNavigationDirection) => moveView(navigateCube2DViewState(view, direction), direction);
  const moveAnchor = (column: Cube2DLayoutColumn) => moveView(setCube2DVerticalAnchorColumn(view, column), 'anchor');
  const hover = (point: PointId | null) => {
    if (!point || transition || captureAnimating) { clearHover(); return; }
    if (vm.phase === 'endgame') { setHoveredPoint(null); setHoverStatus(null); setHoveredGroup(endgameGroupForPoint(groups, point)?.id ?? null); return; }
    if (vm.phase !== 'playing') { clearHover(); return; }
    const availability = controller.moveAvailability(point); setHoveredGroup(null); setHoveredPoint(point); setHoverStatus(availability.allowed ? 'allowed' : availability.reason === 'occupied' ? 'occupied' : 'forbidden');
  };
  const activate = async (point: PointId) => {
    if (transition || captureAnimating || inFlight.current) return;
    if (vm.phase === 'endgame') {
      const group = endgameGroupForPoint(groups, point);
      if (group?.id === controller.nextUnresolvedEndgameGroupId()) setSelectedGroup(group.id);
      return;
    }
    if (vm.phase !== 'playing' || !controller.moveAvailability(point).allowed) { hover(point); return; }

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
      const action = await controller.placeStone(point);
      apply(action);
      if (action.accepted) startCaptureEffects(action.captured, previousSources);
    } finally {
      inFlight.current = false;
    }
  };
  const run = async (action: () => Promise<Cube2DGameActionResult>) => { if (inFlight.current || transition || captureAnimating) return; inFlight.current = true; try { apply(await action()); } finally { inFlight.current = false; } };
  const pass = async () => { if (passGuarded || vm.phase !== 'playing' || captureAnimating) return; await run(async () => { const action = await controller.pass(); if (action.accepted && action.viewModel.phase === 'playing' && action.viewModel.consecutivePasses === 1) startPassGuard(); return action; }); };
  const setDecision = async (groupId: string, status: GroupStatus) => {
    if (
      inFlight.current ||
      vm.phase !== 'endgame' ||
      controller.nextUnresolvedEndgameGroupId() !== groupId
    ) {
      return;
    }

    inFlight.current = true;
    try {
      await controller.setEndgameDecision(groupId, status);
      apply(Object.freeze({
        accepted: true,
        reason: null,
        captured: Object.freeze([]),
        viewModel: controller.viewModel(),
      }));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Endgame decision could not be saved.');
      setDecisionsState(controller.endgameDecisions());
      setSelectedGroup(controller.nextUnresolvedEndgameGroupId());
    } finally {
      inFlight.current = false;
    }
  };
  const setZoom = (next: number) => {
    const clamped = clampZoom(next);
    setZoomState(clamped);
    return clamped;
  };

  useEffect(() => {
    if (
      vm.phase !== 'endgame' ||
      controller.nextUnresolvedEndgameGroupId() !== null ||
      inFlight.current
    ) {
      return;
    }

    void run(() => controller.finishEndgame());
  }, [controller, vm.phase]);

  const selected = groups.find((group) => group.id === selectedGroup) ?? null;
  const manualGroupIds = vm.phase === 'endgame' ? controller.endgameManualGroupIds() : [];
  const manualReviewed = manualGroupIds.filter((groupId) => Boolean(decisions[groupId])).length;
  return { vm, view, layout, transition, hoveredPoint, hoverStatus, hoveredGroup, groups, decisions, setDecision, selectedGroup, selected, resultOpen, setResultOpen, showMoveNumbers, setShowMoveNumbers, passGuarded, feedback, zoom, setZoom, capturedEffects, captureAnimating, navigate, moveAnchor, hover, activate, run, pass, manualReviewed, manualTotal: manualGroupIds.length, automaticClassified: Math.max(0, groups.length - manualGroupIds.length), result: vm.phase === 'finished' ? controller.resultModel() : null, finalClassification: vm.phase === 'finished' ? controller.snapshot().endgameClassification : null } as const;
}
