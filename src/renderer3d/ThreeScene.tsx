import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type { EndgamePresentationModel } from '../presentation/EndgamePresentation';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';
import type { GameViewModel } from '../presentation/PresentationModel';
import {
  cube3DNavigationTarget,
  cube3DResetTarget,
  type Cube3DNavigationDirection,
} from '../presentation/cube/Cube3DNavigation';
import {
  CUBE_3D_ZOOM_MAX,
  CUBE_3D_ZOOM_MIN,
  createCube3DViewState,
  type Cube3DViewState,
} from '../presentation/cube/Cube3DViewState';
import { cube3DArcballDragRotation } from './Cube3DArcballRotation';
import { createCube3DFeatureLayer, type Cube3DFeatureLayer } from './Cube3DFeatureLayer';
import {
  CUBE_3D_MARKER_DIAMETER_PITCH_RATIO,
  createCube3DStoneGeometry,
  cube3DGridPitch,
  cube3DMarkerMatrix,
  cube3DStoneMatrix,
} from './Cube3DGameplayGeometry';
import {
  createCube3DPickTargets,
  disposeCube3DPickTargets,
  pointFromCube3DClientPosition,
  type Cube3DPickTargets,
} from './Cube3DPicking';
import {
  createShared3DHoverMarker,
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
import { shared3DScreenSpaceDragRotation } from './Shared3DInput';
import { animateShared3DStonePlacement } from './Shared3DStonePlacementAnimation';
import { createShared3DWoodMaterial } from './Shared3DWoodMaterial';
import {
  createCube3DDebugGridGeometry,
  createCube3DRoundedSurfaceGeometry,
} from './Cube3DSurfaceGeometry';
import type { CubeViewTransitionBridge } from './CubeViewTransition';
import './cube3d.css';

const VIEW_TRANSITION_MS = 240;

type Cube3DRotationMode = 'screen' | 'arcball';

interface SceneRuntime {
  readonly core: Shared3DSceneCore;
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly blackStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly whiteStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly hoverMarker: Shared3DHoverMarker;
  readonly featureLayer: Cube3DFeatureLayer;
  readonly pickTargets: Cube3DPickTargets;
  readonly pointFromClientPosition: (x: number, y: number) => PointId | null;
}

export interface ThreeSceneProps {
  readonly transitionBridgeRef?: RefObject<CubeViewTransitionBridge | null>;
  readonly animationMode?: 'normal' | 'disabled';
  readonly size: CubeSize;
  readonly viewModel: GameViewModel;
  readonly endgamePresentation: EndgamePresentationModel | null;
  readonly showMoveNumbers: boolean;
  readonly viewState: Cube3DViewState;
  readonly hoveredPointId: PointId | null;
  readonly hoverStatus: GamePointHoverStatus;
  readonly inputDisabled: boolean;
  readonly onViewStateChange: (state: Cube3DViewState) => void;
  readonly onViewTransitioningChange: (transitioning: boolean) => void;
  readonly onPointHover: (pointId: PointId | null) => void;
  readonly onPointActivate: (pointId: PointId) => void;
}

const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

const updateStoneInstances = (
  size: CubeSize,
  viewModel: GameViewModel,
  blackStones: THREE.InstancedMesh,
  whiteStones: THREE.InstancedMesh,
): Readonly<{ black: number; white: number }> => {
  let blackIndex = 0;
  let whiteIndex = 0;
  for (const point of viewModel.points) {
    if (point.occupancy === 'black') {
      blackStones.setMatrixAt(blackIndex, cube3DStoneMatrix(size, point.logicalPointId));
      blackIndex += 1;
    } else if (point.occupancy === 'white') {
      whiteStones.setMatrixAt(whiteIndex, cube3DStoneMatrix(size, point.logicalPointId));
      whiteIndex += 1;
    }
  }
  blackStones.count = blackIndex;
  whiteStones.count = whiteIndex;
  blackStones.instanceMatrix.needsUpdate = true;
  whiteStones.instanceMatrix.needsUpdate = true;
  return Object.freeze({ black: blackIndex, white: whiteIndex });
};

/** Gameplay Cube adapter over the shared 3D renderer core. */
export function ThreeScene({
  transitionBridgeRef,
  animationMode = 'normal',
  size,
  viewModel,
  endgamePresentation,
  showMoveNumbers,
  viewState,
  hoveredPointId,
  hoverStatus,
  inputDisabled,
  onViewStateChange,
  onViewTransitioningChange,
  onPointHover,
  onPointActivate,
}: ThreeSceneProps) {
  const previousModelRef = useRef<GameViewModel | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const viewStateRef = useRef(viewState);
  const inputDisabledRef = useRef(inputDisabled);
  const viewTransitioningRef = useRef(false);
  const rotationModeRef = useRef<Cube3DRotationMode>('screen');
  const startViewTransitionRef = useRef<(target: Cube3DViewState) => void>(() => undefined);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const onViewTransitioningChangeRef = useRef(onViewTransitioningChange);
  const onPointHoverRef = useRef(onPointHover);
  const onPointActivateRef = useRef(onPointActivate);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const [rotationMode, setRotationMode] = useState<Cube3DRotationMode>('screen');
  viewStateRef.current = viewState;
  inputDisabledRef.current = inputDisabled;
  rotationModeRef.current = rotationMode;
  onViewStateChangeRef.current = onViewStateChange;
  onViewTransitioningChangeRef.current = onViewTransitioningChange;
  onPointHoverRef.current = onPointHover;
  onPointActivateRef.current = onPointActivate;

  const syncHostViewData = (state: Cube3DViewState): void => {
    const host = hostRef.current;
    if (!host) return;
    host.dataset.cube3dZoom = state.zoom.toFixed(4);
    host.dataset.cube3dRotation = [
      state.rotation.x,
      state.rotation.y,
      state.rotation.z,
      state.rotation.w,
    ].map((value) => value.toFixed(6)).join(',');
    host.dataset.cube3dAnchor = `${state.orientationAnchor.centerFace}:${state.orientationAnchor.upFace}`;
  };

  const applyViewState = (runtime: SceneRuntime, state: Cube3DViewState): void => {
    syncHostViewData(state);
    applyShared3DViewTransform(runtime.core, state);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.dataset.cube3dReady = 'false';
    let textureReady = false;
    const core = createShared3DSceneCore(host, {
      canvasTestId: 'cube-3d-canvas',
      onAfterRender: () => {
        host.dataset.cube3dReady = String(textureReady);
      },
    });

    const surfaceGeometry = createCube3DRoundedSurfaceGeometry();
    const surfaceMaterial = createShared3DWoodMaterial(
      () => {
        textureReady = true;
        core.render();
      },
      core.renderer.capabilities.getMaxAnisotropy(),
    );
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surface.receiveShadow = true;
    surface.castShadow = true;
    surfaceMaterial.shadowSide = THREE.BackSide;

    const gridPathGeometry = createCube3DDebugGridGeometry(size);
    const gridGeometry = new LineSegmentsGeometry().setPositions(
      gridPathGeometry.getAttribute('position').array as Float32Array,
    );
    gridPathGeometry.dispose();
    const gridMaterial = new LineMaterial({
      color: 0x21170f,
      linewidth: 2.0,
      alphaToCoverage: true,
      depthTest: true,
      depthWrite: true,
    });
    const grid = new LineSegments2(gridGeometry, gridMaterial);
    grid.renderOrder = 1;

    const stoneGeometry = createCube3DStoneGeometry();
    const stoneMaterials = createShared3DStoneMaterials();
    const capacity = 6 * size * size;
    const blackStones = new THREE.InstancedMesh(stoneGeometry, stoneMaterials.black, capacity);
    const whiteStones = new THREE.InstancedMesh(stoneGeometry, stoneMaterials.white, capacity);
    blackStones.castShadow = whiteStones.castShadow = true;
    blackStones.count = 0;
    whiteStones.count = 0;
    blackStones.renderOrder = 2;
    whiteStones.renderOrder = 2;

    const hoverMarker = createShared3DHoverMarker();

    const featureLayer = createCube3DFeatureLayer(size, () => runtimeRef.current?.core.render());
    const pickTargets = createCube3DPickTargets(size);
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

    const pointFromClientPosition = (x: number, y: number): PointId | null => {
      const bounds = core.renderer.domElement.getBoundingClientRect();
      return pointFromCube3DClientPosition({
        camera: core.camera,
        surface,
        targets: pickTargets,
        viewport: bounds,
      }, x, y);
    };

    const runtime: SceneRuntime = {
      core,
      surface,
      blackStones,
      whiteStones,
      hoverMarker,
      featureLayer,
      pickTargets,
      pointFromClientPosition,
    };
    runtimeRef.current = runtime;

    if (transitionBridgeRef) {
      transitionBridgeRef.current = {
        render: (frame) => {
          core.root.quaternion.set(frame.rotation.x, frame.rotation.y, frame.rotation.z, frame.rotation.w);
          core.root.scale.setScalar(frame.scale);
          core.camera.setViewOffset(
            host.clientWidth,
            host.clientHeight,
            -frame.offsetX,
            -frame.offsetY,
            host.clientWidth,
            host.clientHeight,
          );
          core.root.position.set(0, 0, 0);
          host.dataset.cube3dTransitionScale = String(frame.scale);
          host.dataset.cube3dTransitionRotation = [
            frame.rotation.x,
            frame.rotation.y,
            frame.rotation.z,
            frame.rotation.w,
          ].join(',');
          core.renderer.domElement.style.opacity = String(frame.opacity);
          core.root.updateMatrixWorld(true);
          if (frame.opacity > 0) {
            core.beginMotion();
            core.renderNow();
          }
        },
        reset: () => {
          core.restoreResolution();
          core.root.scale.setScalar(1);
          core.root.position.set(0, 0, 0);
          core.camera.clearViewOffset();
          core.renderer.domElement.style.opacity = '1';
          applyViewState(runtime, viewStateRef.current);
          core.renderNow();
        },
      };
    }

    host.dataset.cube3dSize = String(size);
    host.dataset.cube3dGridPitch = cube3DGridPitch(size).toFixed(6);
    host.dataset.cube3dMarkerRatio = String(CUBE_3D_MARKER_DIAMETER_PITCH_RATIO);
    host.dataset.cube3dTransitioning = 'false';
    host.dataset.cube3dRotationMode = rotationModeRef.current;

    let transitionFrameId: number | null = null;
    const finishViewTransition = (target: Cube3DViewState): void => {
      transitionFrameId = null;
      core.restoreResolution();
      viewStateRef.current = target;
      applyViewState(runtime, target);
      core.renderNow();
      host.dataset.cube3dTransitioning = 'false';
      viewTransitioningRef.current = false;
      onViewStateChangeRef.current(target);
      onViewTransitioningChangeRef.current(false);
      setViewTransitioning(false);
    };

    startViewTransitionRef.current = (target: Cube3DViewState): void => {
      if (viewTransitioningRef.current) return;
      viewTransitioningRef.current = true;
      host.dataset.cube3dTransitioning = 'true';
      onPointHoverRef.current(null);
      onViewTransitioningChangeRef.current(true);
      setViewTransitioning(true);

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
        const progress = Math.min(1, Math.max(0, (now - startedAt) / VIEW_TRANSITION_MS));
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
      const next = createCube3DViewState({
        rotation: candidate.rotation,
        zoom: candidate.zoom,
      });
      viewStateRef.current = next;
      syncHostViewData(next);
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
      interactionBlocked: () => viewTransitioningRef.current,
      dragRotation: (context) =>
        rotationModeRef.current === 'arcball'
          ? cube3DArcballDragRotation(
              context.startRotation,
              context.cameraRotation,
              context.startPointer,
              context.currentPointer,
              context.viewport,
            )
          : shared3DScreenSpaceDragRotation(
              context.startRotation,
              context.cameraRotation,
              context.deltaX,
              context.deltaY,
              context.sensitivity,
            ),
      zoomMin: CUBE_3D_ZOOM_MIN,
      zoomMax: CUBE_3D_ZOOM_MAX,
    });

    applyViewState(runtime, viewStateRef.current);
    core.renderNow();

    return () => {
      if (transitionBridgeRef) transitionBridgeRef.current = null;
      detachInput();
      startViewTransitionRef.current = () => undefined;
      viewTransitioningRef.current = false;
      if (transitionFrameId !== null) window.cancelAnimationFrame(transitionFrameId);
      featureLayer.dispose();
      surfaceGeometry.dispose();
      surfaceMaterial.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      stoneGeometry.dispose();
      stoneMaterials.dispose();
      hoverMarker.dispose();
      disposeCube3DPickTargets(pickTargets);
      core.dispose();
      runtimeRef.current = null;
    };
  }, [size, transitionBridgeRef]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && !viewTransitioningRef.current) applyViewState(runtime, viewState);
  }, [viewState]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const stoneCounts = updateStoneInstances(size, viewModel, runtime.blackStones, runtime.whiteStones);
    updateShared3DHoverMarker(
      runtime.hoverMarker,
      hoveredPointId ? cube3DMarkerMatrix(size, hoveredPointId) : null,
      viewModel.currentPlayer,
      hoverStatus,
    );
    const features = runtime.featureLayer.update(viewModel, endgamePresentation, showMoveNumbers);
    const host = hostRef.current;
    if (host) {
      host.dataset.cube3dHoveredPoint = hoveredPointId ?? '';
      host.dataset.cube3dHoverStatus = hoverStatus ?? '';
      host.dataset.cube3dBlackStoneCount = String(stoneCounts.black);
      host.dataset.cube3dWhiteStoneCount = String(stoneCounts.white);
      host.dataset.cube3dBlackTerritoryCount = String(features.blackTerritoryCount);
      host.dataset.cube3dWhiteTerritoryCount = String(features.whiteTerritoryCount);
      host.dataset.cube3dDeadReviewCount = String(features.deadReviewCount);
      host.dataset.cube3dUnresolvedReviewCount = String(features.unresolvedReviewCount);
      host.dataset.cube3dSekiReviewCount = String(features.sekiReviewCount);
      host.dataset.cube3dMoveNumberCount = String(features.moveNumberCount);
      host.dataset.cube3dLastMovePoint = features.lastMovePointId ?? '';
      host.dataset.cube3dPhase = viewModel.phase;
    }
    runtime.core.render();
  }, [endgamePresentation, hoverStatus, hoveredPointId, showMoveNumbers, size, viewModel]);

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
      finalMatrix: cube3DStoneMatrix(size, point.logicalPointId),
      pitch: cube3DGridPitch(size),
      requestRender: runtime.core.render,
    });
  }, [animationMode, size, viewModel]);

  useEffect(() => {
    if (inputDisabled) onPointHoverRef.current(null);
  }, [inputDisabled]);

  const navigate = (direction: Cube3DNavigationDirection): void => {
    if (viewTransitioningRef.current) return;
    startViewTransitionRef.current(cube3DNavigationTarget(viewStateRef.current, direction));
  };

  const resetView = (): void => {
    if (viewTransitioningRef.current) return;
    startViewTransitionRef.current(cube3DResetTarget());
  };

  const changeRotationMode = (mode: Cube3DRotationMode): void => {
    if (viewTransitioningRef.current || mode === rotationModeRef.current) return;
    rotationModeRef.current = mode;
    setRotationMode(mode);
    onPointHoverRef.current(null);
    const host = hostRef.current;
    if (host) host.dataset.cube3dRotationMode = mode;
  };

  return (
    <div className="cube-3d-interaction-surface">
      <div ref={hostRef} className="cube-3d-scene" aria-label="Cube 3D scene" />
      <div
        className="cube-3d-rotation-mode"
        role="group"
        aria-label="Cube 3D rotation mode"
        data-testid="cube-3d-rotation-mode"
      >
        <button
          type="button"
          aria-pressed={rotationMode === 'screen'}
          disabled={viewTransitioning}
          onClick={() => changeRotationMode('screen')}
        >
          Screen
        </button>
        <button
          type="button"
          aria-pressed={rotationMode === 'arcball'}
          disabled={viewTransitioning}
          onClick={() => changeRotationMode('arcball')}
        >
          Arcball
        </button>
      </div>
      <div className="cube-3d-navigation" role="group" aria-label="Cube 3D navigation">
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--up"
          type="button"
          aria-label="Move Cube 3D up"
          disabled={viewTransitioning}
          onClick={() => navigate('up')}
        >
          ↑
        </button>
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--left"
          type="button"
          aria-label="Move Cube 3D left"
          disabled={viewTransitioning}
          onClick={() => navigate('left')}
        >
          ←
        </button>
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--reset"
          type="button"
          aria-label="Reset Cube 3D view"
          disabled={viewTransitioning}
          onClick={resetView}
        >
          ●
        </button>
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--right"
          type="button"
          aria-label="Move Cube 3D right"
          disabled={viewTransitioning}
          onClick={() => navigate('right')}
        >
          →
        </button>
        <button
          className="torus-pan cube-3d-navigation__button cube-3d-navigation__button--down"
          type="button"
          aria-label="Move Cube 3D down"
          disabled={viewTransitioning}
          onClick={() => navigate('down')}
        >
          ↓
        </button>
      </div>
    </div>
  );
}
