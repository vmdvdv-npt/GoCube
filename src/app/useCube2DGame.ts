import { useEffect, useMemo, useRef, useState } from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { PointId } from '../core/topology/Topology';
import { endgameGroupForPoint } from '../presentation/EndgameGroupPresentation';
import { createCube2DLayout, type Cube2DLayoutColumn } from '../presentation/cube/Cube2DLayout';
import { createCube2DViewState, navigateCube2DViewState, setCube2DVerticalAnchorColumn, type Cube2DNavigationDirection, type Cube2DViewState } from '../presentation/cube/Cube2DNavigation';
import { CUBE_2D_TRANSITION_MS, type Cube2DHoverStatus, type Cube2DRendererTransition } from '../renderer2d/Cube2DRenderer';
import { type Cube2DEndgameDecisions, type Cube2DEndgameGroup, type Cube2DGameActionResult, Cube2DGameController } from './Cube2DGameController';

export const CUBE_ENDGAME_STATUSES: readonly GroupStatus[] = ['alive', 'dead', 'seki'];
export const cubeEndgameStatusLabel = (status: GroupStatus) => status === 'alive' ? 'Alive' : status === 'dead' ? 'Dead' : 'Seki';
export const CUBE_ZOOM_MIN = 0.78;
export const CUBE_ZOOM_MAX = 1.35;
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
  const [decisions, setDecisions] = useState<Cube2DEndgameDecisions>({});
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [resultOpen, setResultOpen] = useState(initial.phase === 'finished');
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [passGuarded, setPassGuarded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [zoom, setZoomState] = useState(1);
  const inFlight = useRef(false);
  const transitionId = useRef(0);
  const transitionTimer = useRef<number | null>(null);
  const passTimer = useRef<number | null>(null);
  const layout = useMemo(() => createCube2DLayout(view.orientation, controller.size, view.verticalAnchorColumn), [controller.size, view]);

  useEffect(() => {
    const next = controller.viewModel();
    setVm(next); setView(createCube2DViewState()); setTransition(null); setHoveredPoint(null); setHoverStatus(null); setHoveredGroup(null);
    setGroups(next.phase === 'endgame' ? controller.endgameGroups() : []); setDecisions({}); setSelectedGroup(null); setResultOpen(next.phase === 'finished');
    setPassGuarded(false); setFeedback(null); setZoomState(1);
  }, [controller]);
  useEffect(() => () => {
    if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    if (passTimer.current !== null) window.clearTimeout(passTimer.current);
  }, []);

  const clearHover = () => { setHoveredPoint(null); setHoverStatus(null); setHoveredGroup(null); };
  const clearPassGuard = () => { setPassGuarded(false); if (passTimer.current !== null) window.clearTimeout(passTimer.current); passTimer.current = null; };
  const startPassGuard = () => { clearPassGuard(); setPassGuarded(true); passTimer.current = window.setTimeout(clearPassGuard, 1000); };
  const apply = (action: Cube2DGameActionResult) => {
    clearHover(); setVm(action.viewModel); setFeedback(action.accepted ? null : action.reason ?? 'Action rejected'); setResultOpen(action.viewModel.phase === 'finished' && Boolean(action.viewModel.finalScore));
    if (action.viewModel.phase === 'endgame') { setGroups(controller.endgameGroups()); setSelectedGroup(null); } else { setGroups([]); setDecisions({}); setSelectedGroup(null); }
    if (action.viewModel.phase !== 'playing' || action.viewModel.consecutivePasses === 0) clearPassGuard();
  };
  const moveView = (next: Cube2DViewState, direction: Cube2DRendererTransition['direction']) => {
    if (transition) return; clearHover(); transitionId.current += 1; setView(next); setTransition({ fromLayout: layout, direction, id: transitionId.current });
    transitionTimer.current = window.setTimeout(() => { setTransition(null); transitionTimer.current = null; }, CUBE_2D_TRANSITION_MS);
  };
  const navigate = (direction: Cube2DNavigationDirection) => moveView(navigateCube2DViewState(view, direction), direction);
  const moveAnchor = (column: Cube2DLayoutColumn) => moveView(setCube2DVerticalAnchorColumn(view, column), 'anchor');
  const hover = (point: PointId | null) => {
    if (!point || transition) { clearHover(); return; }
    if (vm.phase === 'endgame') { setHoveredPoint(null); setHoverStatus(null); setHoveredGroup(endgameGroupForPoint(groups, point)?.id ?? null); return; }
    if (vm.phase !== 'playing') { clearHover(); return; }
    const availability = controller.moveAvailability(point); setHoveredGroup(null); setHoveredPoint(point); setHoverStatus(availability.allowed ? 'allowed' : availability.reason === 'occupied' ? 'occupied' : 'forbidden');
  };
  const activate = async (point: PointId) => {
    if (transition || inFlight.current) return;
    if (vm.phase === 'endgame') { const group = endgameGroupForPoint(groups, point); if (group) setSelectedGroup(group.id); return; }
    if (vm.phase !== 'playing' || !controller.moveAvailability(point).allowed) { hover(point); return; }
    inFlight.current = true; try { apply(await controller.placeStone(point)); } finally { inFlight.current = false; }
  };
  const run = async (action: () => Promise<Cube2DGameActionResult>) => { if (inFlight.current || transition) return; inFlight.current = true; try { apply(await action()); } finally { inFlight.current = false; } };
  const pass = async () => { if (passGuarded || vm.phase !== 'playing') return; await run(async () => { const action = await controller.pass(); if (action.accepted && action.viewModel.phase === 'playing' && action.viewModel.consecutivePasses === 1) startPassGuard(); return action; }); };
  const finish = async () => { if (inFlight.current || vm.phase !== 'endgame') return; inFlight.current = true; try { apply(await controller.finishEndgame(decisions)); } catch (error) { setFeedback(error instanceof Error ? error.message : 'Endgame classification failed.'); } finally { inFlight.current = false; } };
  const setZoom = (next: number) => setZoomState(clampZoom(next));
  const selected = groups.find((group) => group.id === selectedGroup) ?? null;
  return { vm, view, layout, transition, hoveredPoint, hoverStatus, hoveredGroup, groups, decisions, setDecisions, selectedGroup, setSelectedGroup, selected, resultOpen, setResultOpen, showMoveNumbers, setShowMoveNumbers, passGuarded, feedback, zoom, setZoom, navigate, moveAnchor, hover, activate, run, pass, finish, classified: groups.filter((group) => Boolean(decisions[group.id])).length, allClassified: groups.every((group) => Boolean(decisions[group.id])), result: vm.phase === 'finished' ? controller.resultModel() : null, finalClassification: vm.phase === 'finished' ? controller.snapshot().endgameClassification : null } as const;
}
