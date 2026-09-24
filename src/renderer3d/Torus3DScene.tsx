import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  createTorus3DViewState,
  TORUS_3D_ZOOM_MAX,
  TORUS_3D_ZOOM_MIN,
  type Torus3DViewState,
} from '../presentation/Torus3DViewState';
import {
  createShared3DHoverMarker,
  createShared3DStoneGeometry,
  createShared3DStoneMaterials,
  updateShared3DHoverMarker,
  type Shared3DHoverMarker,
} from './Shared3DGameplayVisuals';
import {
  applyShared3DViewTransform,
  attachShared3DPointerInput,
  createShared3DSceneCore,
  SHARED_3D_BASE_CAMERA_DISTANCE,
  type Shared3DSceneCore,
  type Shared3DViewTransform,
} from './Shared3DSceneCore';
import { animateShared3DStonePlacement } from './Shared3DStonePlacementAnimation';
import { createShared3DWoodMaterial } from './Shared3DWoodMaterial';
import { createTorus3DFeatureLayer, type Torus3DFeatureLayer } from './Torus3DFeatureLayer';
import {
  torus3DGridPitch,
  torus3DMarkerMatrix,
  torus3DStoneMatrix,
} from './Torus3DGameplayGeometry';
import { createTorus3DGridGeometry } from './Torus3DGridGeometry';
import {
  torus3DFrontFacingAnchor,
  torus3DNavigationTarget,
  torus3DResetTarget,
  type Torus3DNavigationDirection,
} from './Torus3DNavigation';
import {
  createTorus3DPickTargets,
  disposeTorus3DPickTargets,
  pointFromTorus3DClientPosition,
  type Torus3DPickTargets,
} from './Torus3DPicking';
import { createTorus3DSurfaceGeometry } from './Torus3DSurfaceGeometry';
import './torus3d.css';

const VIEW_TRANSITION_MS = 240;
const STARTUP_APPEARANCE_MS = 420;

interface Torus3DSceneRuntime {
  readonly core: Shared3DSceneCore;
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly blackStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly whiteStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly hoverMarker: Shared3DHoverMarker;
  readonly featureLayer: Torus3DFeatureLayer;
  readonly pickTargets: Torus3DPickTargets;
}

export interface Torus3DSceneProps {
  readonly animationMode?: 'normal' | 'disabled';
  readonly startupAppearance?: boolean;
  readonly size: TorusSize;
  readonly viewModel: GameViewModel;
  readonly showMoveNumbers: boolean;
  readonly viewState: Torus3DViewState;
  readonly hoveredPointId: PointId | null;
  readonly hoverStatus: GamePointHoverStatus;
  readonly inputDisabled: boolean;
  readonly viewInputDisabled: boolean;
  readonly onViewStateChange: (state: Torus3DViewState) => void;
  readonly onViewTransitioningChange: (transitioning: boolean) => void;
  readonly onReady?: () => void;
  readonly onPointHover: (pointId: PointId | null) => void;
  readonly onPointActivate: (pointId: PointId) => void;
}

const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

const updateStoneInstances = (
  size: TorusSize,
  viewModel: GameViewModel,
  blackStones: THREE.InstancedMesh,
  whiteStones: THREE.InstancedMesh,
): Readonly<{ black: number; white: number }> => {
  let blackIndex = 0;
  let whiteIndex = 0;
  for (const point of viewModel.points) {
    if (point.occupancy === 'black') {
      blackStones.setMatrixAt(blackIndex, torus3DStoneMatrix(size, point.logicalPointId));
      blackIndex += 1;
    } else if (point.occupancy === 'white') {
      whiteStones.setMatrixAt(whiteIndex, torus3DStoneMatrix(size, point.logicalPointId));
      whiteIndex += 1;
    }
  }
  blackStones.count = blackIndex;
  whiteStones.count = whiteIndex;
  blackStones.instanceMatrix.needsUpdate = true;
  whiteStones.instanceMatrix.needsUpdate = true;
  return Object.freeze({ black: blackIndex, white: whiteIndex });
};

/** Gameplay Torus adapter over the same shared 3D core used by Cube. */
export function Torus3DScene({
  animationMode = 'normal',
  startupAppearance = false,
  size,
  viewModel,
  showMoveNumbers,
  viewState,
  hoveredPointId,
  hoverStatus,
  inputDisabled,
  viewInputDisabled,
  onViewStateChange,
  onViewTransitioningChange,
  onReady,
  onPointHover,
  onPointActivate,
}: Torus3DSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Torus3DSceneRuntime | null>(null);
  const previousModelRef = useRef<GameViewModel | null>(null);
  const viewStateRef = useRef(viewState);
  const inputDisabledRef = useRef(inputDisabled);
  const viewInputDisabledRef = useRef(viewInputDisabled);
  const animationModeRef = useRef(animationMode);
  const startupAppearanceRef = useRef(startupAppearance);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const onViewTransitioningChangeRef = useRef(onViewTransitioningChange);
  const onReadyRef = useRef(onReady);
  const onPointHoverRef = useRef(onPointHover);
  const onPointActivateRef = useRef(onPointActivate);
  const viewTransitioningRef = useRef(false);
  const startViewTransitionRef = useRef<(
    target: Torus3DViewState,
    duration?: number,
  ) => void>(() => undefined);
  const [viewTransitioning, setViewTransitioning] = useState(false);

  viewStateRef.current = viewState;
  inputDisabledRef.current = inputDisabled;
  viewInputDisabledRef.current = viewInputDisabled;
  animationModeRef.current = animationMode;
  startupAppearanceRef.current = startupAppearance;
  onViewStateChangeRef.current = onViewStateChange;
  onViewTransitioningChangeRef.current = onViewTransitioningChange;
  onReadyRef.current = onReady;
  onPointHoverRef.current = onPointHover;
  onPointActivateRef.current = onPointActivate;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.dataset.torus3dReady = 'false';
    host.dataset.torus3dTransitioning = 'false';
    let textureReady = false;
    let readyReported = false;
    let onFirstReadyFrame: (() => void) | null = null;

    const core = createShared3DSceneCore(host, {
      canvasTestId: 'torus-3d-canvas',
      onAfterRender: () => {
        const ready = textureReady;
        host.dataset.torus3dReady = String(ready);
        if (ready && !readyReported && onFirstReadyFrame) {
          readyReported = true;
          onFirstReadyFrame();
        }
      },
    });

    const surfaceGeometry = createTorus3DSurfaceGeometry();
    const surfaceMaterial = createShared3DWoodMaterial(
      () => {
        textureReady = true;
        core.renderNow();
      },
      core.renderer.capabilities.getMaxAnisotropy(),
    );
    surfaceMaterial.shadowSide = THREE.BackSide;
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surface.castShadow = true;
    surface.receiveShadow = true;

    const pitch = torus3DGridPitch(size);
    const gridPathGeometry = createTorus3DGridGeometry(size, pitch * 0.01);
    const gridGeometry = new LineSegmentsGeometry().setPositions(
      gridPathGeometry.getAttribute('position').array as Float32Array,
    );
    gridPathGeometry.dispose();
    const gridMaterial = new LineMaterial({
      color: 0x21170f,
      linewidth: 2,
      alphaToCoverage: true,
      depthTest: true,
      depthWrite: true,
    });
    const grid = new LineSegments2(gridGeometry, gridMaterial);
    grid.renderOrder = 1;

    const stoneGeometry = createShared3DStoneGeometry();
    const stoneMaterials = createShared3DStoneMaterials();
    const capacity = size * size;
    const blackStones = new THREE.InstancedMesh(stoneGeometry, stoneMaterials.black, capacity);
    const whiteStones = new THREE.InstancedMesh(stoneGeometry, stoneMaterials.white, capacity);
    blackStones.castShadow = whiteStones.castShadow = true;
    blackStones.count = whiteStones.count = 0;
    blackStones.renderOrder = whiteStones.renderOrder = 2;

    const hoverMarker = createShared3DHoverMarker();
    const featureLayer = createTorus3DFeatureLayer(size);
    const pickTargets = createTorus3DPickTargets(size);
    pickTargets.mesh.renderOrder = 7;
    core.root.add(
      surface,
      grid,
      blackStones,
      whiteStones,
      hoverMarker.mesh,
      featureLayer.group,
      pickTargets.mesh,
    );

    const runtime: Torus3DSceneRuntime = {
      core,
      surface,
      blackStones,
      whiteStones,
      hoverMarker,
      featureLayer,
      pickTargets,
    };
    runtimeRef.current = runtime;

    const pointFromClientPosition = (x: number, y: number): PointId | null =>
      pointFromTorus3DClientPosition({
        camera: core.camera,
        surface,
        targets: pickTargets,
        viewport: core.renderer.domElement.getBoundingClientRect(),
      }, x, y);

    const syncViewData = (state: Torus3DViewState): void => {
      host.dataset.torus3dZoom = state.zoom.toFixed(4);
      host.dataset.torus3dRotation = [
        state.rotation.x,
        state.rotation.y,
        state.rotation.z,
        state.rotation.w,
      ].map((value) => value.toFixed(6)).join(',');
      const anchor = torus3DFrontFacingAnchor(size, state.rotation);
      host.dataset.torus3dAnchor = `${anchor.column},${anchor.row}`;
    };

    const applyViewState = (state: Torus3DViewState): void => {
      syncViewData(state);
      applyShared3DViewTransform(core, state);
    };

    let transitionFrameId: number | null = null;

    const finishViewTransition = (target: Torus3DViewState): void => {
      transitionFrameId = null;
      core.restoreResolution();
      viewStateRef.current = target;
      applyViewState(target);
      core.renderNow();
      host.dataset.torus3dTransitioning = 'false';
      viewTransitioningRef.current = false;
      setViewTransitioning(false);
      onViewStateChangeRef.current(target);
      onViewTransitioningChangeRef.current(false);
    };

    startViewTransitionRef.current = (
      target: Torus3DViewState,
      duration = VIEW_TRANSITION_MS,
    ): void => {
      if (viewTransitioningRef.current) return;
      const reducedMotion =
        animationModeRef.current === 'disabled' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion || duration <= 0) {
        finishViewTransition(target);
        return;
      }

      viewTransitioningRef.current = true;
      setViewTransitioning(true);
      host.dataset.torus3dTransitioning = 'true';
      onPointHoverRef.current(null);
      onViewTransitioningChangeRef.current(true);
      core.beginMotion();

      const startRotation = core.root.quaternion.clone().normalize();
      const targetRotation = new THREE.Quaternion(
        target.rotation.x,
        target.rotation.y,
        target.rotation.z,
        target.rotation.w,
      ).normalize();
      const startZoom = SHARED_3D_BASE_CAMERA_DISTANCE / core.camera.position.z;
      const startedAt = performance.now();

      const frame = (now: number): void => {
        const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
        const eased = easeOutCubic(progress);
        core.root.quaternion.copy(startRotation).slerp(targetRotation, eased).normalize();
        const zoom = startZoom + (target.zoom - startZoom) * eased;
        core.camera.position.set(0, 0, SHARED_3D_BASE_CAMERA_DISTANCE / zoom);
        core.camera.lookAt(0, 0, 0);
        core.camera.updateMatrixWorld(true);
        core.root.updateMatrixWorld(true);
        core.renderNow();
        if (progress < 1) {
          transitionFrameId = window.requestAnimationFrame(frame);
          return;
        }
        finishViewTransition(target);
      };
      transitionFrameId = window.requestAnimationFrame(frame);
    };

    const commitViewTransform = (candidate: Shared3DViewTransform): Shared3DViewTransform => {
      const next = createTorus3DViewState(candidate);
      viewStateRef.current = next;
      syncViewData(next);
      onViewStateChangeRef.current(next);
      return next;
    };

    const detachInput = attachShared3DPointerInput({
      core,
      getViewTransform: () => viewStateRef.current,
      commitViewTransform,
      pointFromClientPosition,
      onPointHover: (pointId) => onPointHoverRef.current(pointId),
      onPointActivate: (pointId) => onPointActivateRef.current(pointId),
      inputDisabled: () => inputDisabledRef.current,
      interactionBlocked: () =>
        viewTransitioningRef.current || viewInputDisabledRef.current,
      zoomMin: TORUS_3D_ZOOM_MIN,
      zoomMax: TORUS_3D_ZOOM_MAX,
    });

    host.dataset.torus3dSize = String(size);
    host.dataset.torus3dMappingCount = String(size * size);
    host.dataset.torus3dGridLinesFirst = String(size);
    host.dataset.torus3dGridLinesSecond = String(size);
    host.dataset.torus3dGridPitch = pitch.toFixed(6);
    applyViewState(viewStateRef.current);
    core.renderNow();

    onFirstReadyFrame = (): void => {
      onReadyRef.current?.();
      if (!startupAppearanceRef.current) return;

      const target = torus3DResetTarget();
      viewStateRef.current = target;
      const reducedMotion =
        animationModeRef.current === 'disabled' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        finishViewTransition(target);
        return;
      }

      const targetRotation = new THREE.Quaternion(
        target.rotation.x,
        target.rotation.y,
        target.rotation.z,
        target.rotation.w,
      ).normalize();
      const calmOffset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-0.07, 0.11, 0.025, 'XYZ'),
      );
      core.root.quaternion.copy(calmOffset.multiply(targetRotation)).normalize();
      const startZoom = target.zoom * 0.84;
      core.camera.position.set(0, 0, SHARED_3D_BASE_CAMERA_DISTANCE / startZoom);
      core.camera.lookAt(0, 0, 0);
      core.camera.updateMatrixWorld(true);
      core.root.updateMatrixWorld(true);
      core.renderNow();
      startViewTransitionRef.current(target, STARTUP_APPEARANCE_MS);
    };

    // Texture callbacks can complete synchronously in tests/cached environments.
    if (textureReady && !readyReported) {
      readyReported = true;
      host.dataset.torus3dReady = 'true';
      onFirstReadyFrame();
    }

    return () => {
      detachInput();
      startViewTransitionRef.current = () => undefined;
      viewTransitioningRef.current = false;
      if (transitionFrameId !== null) window.cancelAnimationFrame(transitionFrameId);
      featureLayer.dispose();
      disposeTorus3DPickTargets(pickTargets);
      hoverMarker.dispose();
      stoneGeometry.dispose();
      stoneMaterials.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      surfaceGeometry.dispose();
      surfaceMaterial.dispose();
      core.dispose();
      runtimeRef.current = null;
    };
  }, [size]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && !viewTransitioningRef.current) {
      const next = createTorus3DViewState(viewState);
      viewStateRef.current = next;
      const host = hostRef.current;
      if (host) {
        host.dataset.torus3dZoom = next.zoom.toFixed(4);
        host.dataset.torus3dRotation = [
          next.rotation.x,
          next.rotation.y,
          next.rotation.z,
          next.rotation.w,
        ].map((value) => value.toFixed(6)).join(',');
        const anchor = torus3DFrontFacingAnchor(size, next.rotation);
        host.dataset.torus3dAnchor = `${anchor.column},${anchor.row}`;
      }
      applyShared3DViewTransform(runtime.core, next);
    }
  }, [size, viewState]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const counts = updateStoneInstances(size, viewModel, runtime.blackStones, runtime.whiteStones);
    updateShared3DHoverMarker(
      runtime.hoverMarker,
      hoveredPointId ? torus3DMarkerMatrix(size, hoveredPointId) : null,
      viewModel.currentPlayer,
      hoverStatus,
    );
    const features = runtime.featureLayer.update(viewModel, showMoveNumbers);
    const host = hostRef.current;
    if (host) {
      host.dataset.torus3dHoveredPoint = hoveredPointId ?? '';
      host.dataset.torus3dHoverStatus = hoverStatus ?? '';
      host.dataset.torus3dBlackStoneCount = String(counts.black);
      host.dataset.torus3dWhiteStoneCount = String(counts.white);
      host.dataset.torus3dMoveNumberCount = String(features.moveNumberCount);
      host.dataset.torus3dLastMovePoint = features.lastMovePointId ?? '';
      host.dataset.torus3dPhase = viewModel.phase;
    }
    runtime.core.render();
  }, [hoverStatus, hoveredPointId, showMoveNumbers, size, viewModel]);

  useEffect(() => {
    const previous = previousModelRef.current;
    previousModelRef.current = viewModel;
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !previous ||
      animationMode === 'disabled' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      viewModel.moveNumber !== previous.moveNumber + 1
    ) return;
    const point = viewModel.points.find(
      (candidate) => candidate.logicalPointId === viewModel.lastMovePointId,
    );
    if (
      !point ||
      point.occupancy === 'empty' ||
      previous.points.find((candidate) => candidate.logicalPointId === point.logicalPointId)
        ?.occupancy !== 'empty'
    ) return;
    const stones = point.occupancy === 'black' ? runtime.blackStones : runtime.whiteStones;
    const index = viewModel.points
      .filter((candidate) => candidate.occupancy === point.occupancy)
      .findIndex((candidate) => candidate.logicalPointId === point.logicalPointId);
    if (index < 0) return;
    return animateShared3DStonePlacement({
      stones,
      instanceIndex: index,
      finalMatrix: torus3DStoneMatrix(size, point.logicalPointId),
      pitch: torus3DGridPitch(size),
      requestRender: runtime.core.render,
    });
  }, [animationMode, size, viewModel]);

  useEffect(() => {
    if (inputDisabled) onPointHoverRef.current(null);
  }, [inputDisabled]);

  const navigate = (direction: Torus3DNavigationDirection): void => {
    if (viewTransitioningRef.current || viewInputDisabledRef.current) return;
    startViewTransitionRef.current(torus3DNavigationTarget(size, viewStateRef.current, direction));
  };

  const resetView = (): void => {
    if (viewTransitioningRef.current || viewInputDisabledRef.current) return;
    startViewTransitionRef.current(torus3DResetTarget());
  };

  return (
    <div className="torus-3d-interaction-surface">
      <div
        ref={hostRef}
        className="torus-3d-scene"
        aria-label="Torus 3D scene"
      />
      <div className="cube-3d-navigation" role="group" aria-label="Torus 3D navigation">
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--up"
          type="button"
          aria-label="Move Torus 3D up"
          disabled={viewTransitioning || viewInputDisabled}
          onClick={() => navigate('up')}
        >
          ↑
        </button>
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--left"
          type="button"
          aria-label="Move Torus 3D left"
          disabled={viewTransitioning || viewInputDisabled}
          onClick={() => navigate('left')}
        >
          ←
        </button>
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--reset"
          type="button"
          aria-label="Reset Torus 3D view"
          disabled={viewTransitioning || viewInputDisabled}
          onClick={resetView}
        >
          ●
        </button>
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--right"
          type="button"
          aria-label="Move Torus 3D right"
          disabled={viewTransitioning || viewInputDisabled}
          onClick={() => navigate('right')}
        >
          →
        </button>
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--down"
          type="button"
          aria-label="Move Torus 3D down"
          disabled={viewTransitioning || viewInputDisabled}
          onClick={() => navigate('down')}
        >
          ↓
        </button>
      </div>
    </div>
  );
}