import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointId } from '../core/topology/Topology';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';
import type { Torus3DViewState } from '../presentation/Torus3DViewState';
import {
  torus3DFrontFacingAnchor,
  torus3DResetTarget,
  torus3DViewTargetForAnchor,
} from '../renderer3d/Torus3DNavigation';
import '../renderer3d/torus3d.css';
import { FinalAnalysisProgressProvider } from './FinalAnalysisProgressContext';
import type { GameInteractionBoundary } from './GameInteractionBoundary';
import {
  TorusGame as TorusGameBase,
  type Torus2DSpatialBridge,
  type TorusExternalAction,
  type TorusGameProps as TorusGameBaseProps,
} from './TorusGameBase';

const Torus3DScene = lazy(async () => {
  const module = await import('../renderer3d/Torus3DScene');
  return { default: module.Torus3DScene };
});

const TORUS_VIEW_TRANSITION_MS = 180;

type TorusViewMode = '2d' | '3d';
type TorusSwitchPhase = 'idle' | 'preparing-3d' | 'to-3d' | 'to-2d';

export interface TorusGameProps extends TorusGameBaseProps {
  /** Development replay remains a deliberate 2D entry; production games default to 3D. */
  readonly initialViewMode?: TorusViewMode;
}

export function TorusGame(props: TorusGameProps) {
  const initialViewMode = props.initialViewMode ?? '3d';
  const startsIn3D = initialViewMode === '3d';
  const [viewMode, setViewMode] = useState<TorusViewMode>(initialViewMode);
  const [requestedMode, setRequestedMode] = useState<TorusViewMode>(initialViewMode);
  const [switchPhase, setSwitchPhase] = useState<TorusSwitchPhase>('idle');
  const [mount3D, setMount3D] = useState(startsIn3D);
  const [overlayVisible, setOverlayVisible] = useState(startsIn3D);
  const [startupPending, setStartupPending] = useState(startsIn3D);
  const [sceneTransitioning, setSceneTransitioning] = useState(false);
  const [torus3DViewState, setTorus3DViewState] = useState<Torus3DViewState>(() =>
    torus3DResetTarget(),
  );
  const [viewModel, setViewModel] = useState(() => props.controller.viewModel());
  const [hoveredPointId, setHoveredPointId] = useState<PointId | null>(null);
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [localExternalAction, setLocalExternalAction] = useState<TorusExternalAction | null>(null);
  const localActionSequenceRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const spatialBridgeRef = useRef<Torus2DSpatialBridge | null>(null);
  const switchGenerationRef = useRef(0);
  const switchTimerRef = useRef<number | null>(null);
  const switchFrameRef = useRef<number | null>(null);
  const sceneReadyRef = useRef(false);
  const requestedModeRef = useRef<TorusViewMode>(initialViewMode);
  const switchPhaseRef = useRef<TorusSwitchPhase>('idle');
  const startupPendingRef = useRef(startsIn3D);
  const sourceInteraction = props.interaction ?? props.controller;

  const clearScheduledSwitch = (): void => {
    if (switchTimerRef.current !== null) {
      window.clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
    if (switchFrameRef.current !== null) {
      window.cancelAnimationFrame(switchFrameRef.current);
      switchFrameRef.current = null;
    }
  };

  const setPhase = (phase: TorusSwitchPhase): void => {
    switchPhaseRef.current = phase;
    setSwitchPhase(phase);
  };

  const setRequested = (mode: TorusViewMode): void => {
    requestedModeRef.current = mode;
    setRequestedMode(mode);
  };

  const animateSwitch = (): boolean =>
    props.animationMode !== 'disabled' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const finishTo3D = (generation: number): void => {
    if (
      generation !== switchGenerationRef.current ||
      requestedModeRef.current !== '3d'
    ) return;
    setViewMode('3d');
    setOverlayVisible(true);
    setPhase('idle');
  };

  const beginTo3D = (generation: number): void => {
    if (
      generation !== switchGenerationRef.current ||
      requestedModeRef.current !== '3d'
    ) return;
    setPhase('to-3d');
    if (!animateSwitch()) {
      finishTo3D(generation);
      return;
    }
    switchFrameRef.current = window.requestAnimationFrame(() => {
      switchFrameRef.current = null;
      if (
        generation !== switchGenerationRef.current ||
        requestedModeRef.current !== '3d'
      ) return;
      setOverlayVisible(true);
      switchTimerRef.current = window.setTimeout(() => {
        switchTimerRef.current = null;
        finishTo3D(generation);
      }, TORUS_VIEW_TRANSITION_MS);
    });
  };

  const finishTo2D = (generation: number): void => {
    if (
      generation !== switchGenerationRef.current ||
      requestedModeRef.current !== '2d'
    ) return;
    setViewMode('2d');
    setOverlayVisible(false);
    setMount3D(false);
    sceneReadyRef.current = false;
    setPhase('idle');
  };

  const beginTo2D = (generation: number): void => {
    if (
      generation !== switchGenerationRef.current ||
      requestedModeRef.current !== '2d'
    ) return;
    setPhase('to-2d');
    if (!animateSwitch()) {
      finishTo2D(generation);
      return;
    }
    switchFrameRef.current = window.requestAnimationFrame(() => {
      switchFrameRef.current = null;
      if (
        generation !== switchGenerationRef.current ||
        requestedModeRef.current !== '2d'
      ) return;
      setOverlayVisible(false);
      switchTimerRef.current = window.setTimeout(() => {
        switchTimerRef.current = null;
        finishTo2D(generation);
      }, TORUS_VIEW_TRANSITION_MS);
    });
  };

  const requestViewMode = (mode: TorusViewMode): void => {
    if (startupPendingRef.current) return;
    if (mode === requestedModeRef.current && switchPhaseRef.current === 'idle') return;

    const generation = switchGenerationRef.current + 1;
    switchGenerationRef.current = generation;
    clearScheduledSwitch();
    setRequested(mode);
    setHoveredPointId(null);

    if (mode === '2d') {
      const anchor = torus3DFrontFacingAnchor(
        props.controller.size,
        torus3DViewState.rotation,
      );
      spatialBridgeRef.current?.centerOn(anchor);
      beginTo2D(generation);
      return;
    }

    const anchor = spatialBridgeRef.current?.currentAnchor();
    if (anchor) {
      setTorus3DViewState((current) =>
        torus3DViewTargetForAnchor(props.controller.size, current, anchor),
      );
    }
    setMount3D(true);
    setOverlayVisible(false);
    setPhase('preparing-3d');
    if (sceneReadyRef.current) beginTo3D(generation);
  };

  const gameplayInteraction = useMemo<GameInteractionBoundary>(() => {
    const sync = async <T extends { readonly viewModel: typeof viewModel }>(promise: Promise<T>): Promise<T> => {
      const result = await promise;
      setViewModel(result.viewModel);
      return result;
    };
    return Object.freeze({
      placeStone: (point: PointId) => sync(sourceInteraction.placeStone(point)),
      pass: () => sync(sourceInteraction.pass()),
      undo: () => sync(sourceInteraction.undo()),
      redo: () => sync(sourceInteraction.redo()),
      canUndo: () => sourceInteraction.canUndo(),
      canRedo: () => sourceInteraction.canRedo(),
    });
  }, [sourceInteraction]);

  useLayoutEffect(() => {
    clearScheduledSwitch();
    switchGenerationRef.current += 1;
    setViewModel(props.controller.viewModel());
    setHoveredPointId(null);
    setLocalExternalAction(null);
    setViewMode(initialViewMode);
    setRequested(initialViewMode);
    setPhase('idle');
    setMount3D(startsIn3D);
    setOverlayVisible(startsIn3D);
    setStartupPending(startsIn3D);
    startupPendingRef.current = startsIn3D;
    sceneReadyRef.current = false;
    setSceneTransitioning(false);
    setTorus3DViewState(torus3DResetTarget());
    // initialViewMode is a mount-time presentation policy for this controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.controller]);

  useEffect(() => () => clearScheduledSwitch(), []);

  // Observe the authoritative controller projection directly as well as action
  // results dispatched through the 3D interaction wrapper. TorusGameBase owns
  // endgame completion and calls controller.finishEndgame() directly, so this
  // subscription keeps both renderers on the same GameSession phase.
  useEffect(
    () => props.controller.subscribeViewModel(setViewModel),
    [props.controller],
  );

  useEffect(() => {
    if (!props.externalAction) return;
    setViewModel(props.externalAction.result.viewModel);
    setLocalExternalAction(null);
  }, [props.externalAction]);

  // The 2D renderer owns this presentation option. Mirror only the display bit
  // into 3D; board/history authority remains entirely in GameSession.
  useEffect(() => {
    const host = hostRef.current;
    const Observer = host?.ownerDocument.defaultView?.MutationObserver;
    if (!host || !Observer) return;
    const syncDisplayOptions = (): void => {
      const board = host.querySelector<SVGSVGElement>('.torus-board');
      setShowMoveNumbers(board?.dataset.moveNumbersVisible === 'true');
    };
    syncDisplayOptions();
    const observer = new Observer(syncDisplayOptions);
    observer.observe(host, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-move-numbers-visible'],
    });
    return () => observer.disconnect();
  }, []);

  let hoverStatus: GamePointHoverStatus = null;
  if (
    hoveredPointId &&
    !props.gameplayReadOnly &&
    viewModel.phase === 'playing'
  ) {
    const availability = props.controller.moveAvailability(hoveredPointId);
    hoverStatus = availability.allowed
      ? 'allowed'
      : availability.reason === 'occupied'
        ? 'occupied'
        : 'forbidden';
  }

  const activate3DPoint = (pointId: PointId): void => {
    if (
      actionInFlightRef.current ||
      props.gameplayReadOnly ||
      switchPhaseRef.current !== 'idle' ||
      startupPendingRef.current ||
      viewModel.phase !== 'playing'
    ) return;
    const availability = props.controller.moveAvailability(pointId);
    if (!availability.allowed) return;

    actionInFlightRef.current = true;
    void gameplayInteraction.placeStone(pointId).then((result) => {
      localActionSequenceRef.current -= 1;
      setLocalExternalAction({
        sequence: localActionSequenceRef.current,
        result,
      });
    }).finally(() => {
      actionInFlightRef.current = false;
    });
  };

  const handleSceneReady = (): void => {
    sceneReadyRef.current = true;
    if (startupPendingRef.current) {
      startupPendingRef.current = false;
      setStartupPending(false);
    }
    if (
      requestedModeRef.current === '3d' &&
      switchPhaseRef.current === 'preparing-3d'
    ) {
      beginTo3D(switchGenerationRef.current);
    }
  };

  const handleSceneTransitioningChange = (transitioning: boolean): void => {
    setSceneTransitioning(transitioning);
  };

  const externalAction = localExternalAction ?? props.externalAction ?? null;
  const viewSwitching = switchPhase !== 'idle';
  const boardVisible = viewMode === '2d' || viewSwitching;
  const boardActive = viewMode === '2d' && !viewSwitching && !startupPending;
  const sceneGameplayInputDisabled =
    Boolean(props.gameplayReadOnly) || viewModel.phase !== 'playing';
  const sceneViewInputDisabled = viewSwitching || startupPending;
  const switchButtonDisabled = startupPending;
  const baseProps: TorusGameBaseProps = props;

  return (
    <FinalAnalysisProgressProvider source={props.controller.finalAnalysisProgressSource()}>
      <div
        ref={hostRef}
        className="torus-3d-host"
        data-torus-view={viewMode}
        data-torus-view-requested={requestedMode}
        data-torus-view-transition={switchPhase}
      >
        <TorusGameBase
          {...baseProps}
          interaction={gameplayInteraction}
          externalAction={externalAction}
          spatialBridgeRef={spatialBridgeRef}
          viewActive={boardActive}
          transitioning={viewSwitching || startupPending}
          boardVisible={boardVisible}
        />

        <div className="cube-view-switch torus-view-switch" role="group" aria-label="Torus view">
          <button
            type="button"
            aria-pressed={viewMode === '2d'}
            disabled={switchButtonDisabled}
            onClick={() => requestViewMode('2d')}
          >
            2D
          </button>
          <button
            type="button"
            aria-pressed={viewMode === '3d'}
            disabled={switchButtonDisabled}
            onClick={() => requestViewMode('3d')}
          >
            3D
          </button>
        </div>

        {mount3D ? (
          <div
            className="torus-3d-overlay"
            data-visible={overlayVisible ? 'true' : 'false'}
            aria-label="Torus 3D view"
            aria-hidden={!overlayVisible && switchPhase === 'idle' ? true : undefined}
          >
            <Suspense fallback={null}>
              <Torus3DScene
                animationMode={props.animationMode}
                startupAppearance={startupPending}
                size={props.controller.size}
                viewModel={viewModel}
                showMoveNumbers={showMoveNumbers}
                viewState={torus3DViewState}
                hoveredPointId={hoveredPointId}
                hoverStatus={hoverStatus}
                inputDisabled={sceneGameplayInputDisabled}
                viewInputDisabled={sceneViewInputDisabled}
                onViewStateChange={setTorus3DViewState}
                onViewTransitioningChange={handleSceneTransitioningChange}
                onReady={handleSceneReady}
                onPointHover={setHoveredPointId}
                onPointActivate={activate3DPoint}
              />
            </Suspense>
          </div>
        ) : null}
      </div>
    </FinalAnalysisProgressProvider>
  );
}
