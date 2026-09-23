import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointId } from '../core/topology/Topology';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';
import { Torus3DScene } from '../renderer3d/Torus3DScene';
import '../renderer3d/torus3d.css';
import { FinalAnalysisProgressProvider } from './FinalAnalysisProgressContext';
import type { GameInteractionBoundary } from './GameInteractionBoundary';
import {
  TorusGame as TorusGameBase,
  type TorusExternalAction,
  type TorusGameProps,
} from './TorusGameBase';

export type { TorusGameProps };

export function TorusGame(props: TorusGameProps) {
  const [show3DFoundation, setShow3DFoundation] = useState(false);
  const [viewModel, setViewModel] = useState(() => props.controller.viewModel());
  const [hoveredPointId, setHoveredPointId] = useState<PointId | null>(null);
  const [showMoveNumbers, setShowMoveNumbers] = useState(false);
  const [localExternalAction, setLocalExternalAction] = useState<TorusExternalAction | null>(null);
  const localActionSequenceRef = useRef(0);
  const actionInFlightRef = useRef(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const sourceInteraction = props.interaction ?? props.controller;
  const foundationEntryEnabled =
    import.meta.env.DEV || new URLSearchParams(window.location.search).has('torus3d');

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

  useEffect(() => {
    setViewModel(props.controller.viewModel());
    setHoveredPointId(null);
    setLocalExternalAction(null);
  }, [props.controller]);

  useEffect(() => {
    if (props.externalAction) setViewModel(props.externalAction.result.viewModel);
  }, [props.externalAction]);

  // The 2D renderer already owns this display option. Mirror only that presentation
  // bit into the development 3D view; game authority remains entirely in GameSession.
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

  const externalAction = localExternalAction ?? props.externalAction ?? null;

  return (
    <FinalAnalysisProgressProvider source={props.controller.finalAnalysisProgressSource()}>
      <div
        ref={hostRef}
        className="torus-3d-foundation-host"
        data-torus3d-foundation={show3DFoundation ? 'open' : 'closed'}
      >
        <TorusGameBase
          {...props}
          interaction={gameplayInteraction}
          externalAction={externalAction}
        />
        {foundationEntryEnabled ? (
          <button
            className="torus-3d-foundation-toggle"
            type="button"
            aria-pressed={show3DFoundation}
            onClick={() => {
              setHoveredPointId(null);
              setShow3DFoundation((current) => !current);
            }}
          >
            {show3DFoundation ? 'Torus 2D' : 'Torus 3D prototype'}
          </button>
        ) : null}
        {foundationEntryEnabled && show3DFoundation ? (
          <div className="torus-3d-foundation-overlay" aria-label="Torus 3D prototype view">
            <Torus3DScene
              animationMode={props.animationMode}
              size={props.controller.size}
              viewModel={viewModel}
              showMoveNumbers={showMoveNumbers}
              hoveredPointId={hoveredPointId}
              hoverStatus={hoverStatus}
              inputDisabled={Boolean(props.gameplayReadOnly) || viewModel.phase !== 'playing'}
              onPointHover={setHoveredPointId}
              onPointActivate={activate3DPoint}
            />
          </div>
        ) : null}
      </div>
    </FinalAnalysisProgressProvider>
  );
}
