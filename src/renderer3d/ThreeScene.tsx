import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';
import type { GameViewModel } from '../presentation/PresentationModel';
import { pointerMovementExceedsDragThreshold } from '../presentation/PointerGesture';
import {
  cube3DNavigationTarget,
  cube3DResetTarget,
  type Cube3DNavigationDirection,
} from '../presentation/cube/Cube3DNavigation';
import {
  withCube3DRotation,
  withCube3DZoom,
  type Cube3DViewState,
} from '../presentation/cube/Cube3DViewState';
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
import { CUBE_3D_PERFORMANCE_BUDGET } from './Cube3DPerformance';
import { cube3DScreenSpaceDragRotation } from './Cube3DScreenRotation';
import {
  createCube3DDebugGridGeometry,
  createCube3DRoundedSurfaceGeometry,
} from './Cube3DSurfaceGeometry';
import './cube3d.css';

const BASE_CAMERA_DISTANCE = 5;
const ROTATION_SENSITIVITY = 0.008;
const ZOOM_SENSITIVITY = 0.001;
const MARKER_THICKNESS = 0.08;
const INITIAL_RENDER_DEFER_FALLBACK_MS = 500;
const VIEW_TRANSITION_MS = 240;

interface SceneRuntime {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cubeRoot: THREE.Group;
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly blackStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly whiteStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly hoverMarker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly pickTargets: Cube3DPickTargets;
  readonly render: () => void;
  readonly pointFromClientPosition: (x: number, y: number) => PointId | null;
}

interface DragSession {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: THREE.Quaternion;
  dragging: boolean;
}

export interface ThreeSceneProps {
  readonly size: CubeSize;
  readonly viewModel: GameViewModel;
  readonly viewState: Cube3DViewState;
  readonly hoveredPointId: PointId | null;
  readonly hoverStatus: GamePointHoverStatus;
  readonly inputDisabled: boolean;
  readonly onViewStateChange: (state: Cube3DViewState) => void;
  readonly onViewTransitioningChange: (transitioning: boolean) => void;
  readonly onPointHover: (pointId: PointId | null) => void;
  readonly onPointActivate: (pointId: PointId) => void;
}

const toQuaternionState = (quaternion: THREE.Quaternion) =>
  Object.freeze({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });

const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

const updateStoneInstances = (
  size: CubeSize,
  viewModel: GameViewModel,
  blackStones: THREE.InstancedMesh,
  whiteStones: THREE.InstancedMesh,
): void => {
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
};

const updateHoverMarker = (
  size: CubeSize,
  viewModel: GameViewModel,
  hoveredPointId: PointId | null,
  hoverStatus: GamePointHoverStatus,
  marker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
): void => {
  const visible = Boolean(
    hoveredPointId && (hoverStatus === 'allowed' || hoverStatus === 'forbidden'),
  );
  marker.visible = visible;
  if (!visible || !hoveredPointId) return;

  marker.matrixAutoUpdate = false;
  marker.matrix.copy(cube3DMarkerMatrix(size, hoveredPointId));
  marker.matrixWorldNeedsUpdate = true;
  if (hoverStatus === 'forbidden') {
    marker.material.color.setHex(0xe04c4c);
  } else {
    marker.material.color.setHex(viewModel.currentPlayer === 'black' ? 0x101214 : 0xf2f0e9);
  }
};

/** Gameplay Cube 3D scene. Rules and authoritative state stay outside this renderer. */
export function ThreeScene({
  size,
  viewModel,
  viewState,
  hoveredPointId,
  hoverStatus,
  inputDisabled,
  onViewStateChange,
  onViewTransitioningChange,
  onPointHover,
  onPointActivate,
}: ThreeSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const viewStateRef = useRef(viewState);
  const inputDisabledRef = useRef(inputDisabled);
  const initialRenderDeferredRef = useRef(inputDisabled);
  const viewTransitioningRef = useRef(false);
  const startViewTransitionRef = useRef<(target: Cube3DViewState) => void>(() => undefined);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const onViewTransitioningChangeRef = useRef(onViewTransitioningChange);
  const onPointHoverRef = useRef(onPointHover);
  const onPointActivateRef = useRef(onPointActivate);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  viewStateRef.current = viewState;
  inputDisabledRef.current = inputDisabled;
  onViewStateChangeRef.current = onViewStateChange;
  onViewTransitioningChangeRef.current = onViewTransitioningChange;
  onPointHoverRef.current = onPointHover;
  onPointActivateRef.current = onPointActivate;

  const applyViewState = (runtime: SceneRuntime, state: Cube3DViewState): void => {
    const { rotation } = state;
    runtime.cubeRoot.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
    runtime.camera.position.set(0, 0, BASE_CAMERA_DISTANCE / state.zoom);
    runtime.camera.lookAt(0, 0, 0);
    runtime.camera.updateMatrixWorld(true);
    runtime.cubeRoot.updateMatrixWorld(true);
    const host = hostRef.current;
    if (host) {
      host.dataset.cube3dZoom = state.zoom.toFixed(4);
      host.dataset.cube3dRotation = [rotation.x, rotation.y, rotation.z, rotation.w]
        .map((value) => value.toFixed(6))
        .join(',');
      host.dataset.cube3dAnchor = `${state.orientationAnchor.centerFace}:${state.orientationAnchor.upFace}`;
    }
    runtime.render();
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04090f);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, CUBE_3D_PERFORMANCE_BUDGET.maxDevicePixelRatio),
    );
    renderer.domElement.dataset.testid = 'cube-3d-canvas';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const surfaceGeometry = createCube3DRoundedSurfaceGeometry();
    const surfaceMaterial = new THREE.MeshLambertMaterial({
      color: 0x747a80,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);

    // Stage 1's continuous adjacency geometry is now the production gameplay grid.
    const gridGeometry = createCube3DDebugGridGeometry(size);
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0xd8dde2 });
    const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
    grid.renderOrder = 1;

    const stoneGeometry = createCube3DStoneGeometry();
    const blackMaterial = new THREE.MeshLambertMaterial({ color: 0x111315 });
    const whiteMaterial = new THREE.MeshLambertMaterial({ color: 0xeee9df });
    const capacity = 6 * size * size;
    const blackStones = new THREE.InstancedMesh(stoneGeometry, blackMaterial, capacity);
    const whiteStones = new THREE.InstancedMesh(stoneGeometry, whiteMaterial, capacity);
    blackStones.count = 0;
    whiteStones.count = 0;
    blackStones.renderOrder = 2;
    whiteStones.renderOrder = 2;

    const markerGeometry = new THREE.CylinderGeometry(1, 1, MARKER_THICKNESS, 20);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xe04c4c });
    const hoverMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    hoverMarker.visible = false;
    hoverMarker.renderOrder = 3;

    const pickTargets = createCube3DPickTargets(size);
    pickTargets.mesh.renderOrder = 4;

    const cubeRoot = new THREE.Group();
    cubeRoot.add(surface, grid, blackStones, whiteStones, hoverMarker, pickTargets.mesh);
    scene.add(cubeRoot);

    const ambient = new THREE.AmbientLight(0xffffff, 1.15);
    const key = new THREE.DirectionalLight(0xffffff, 1.75);
    key.position.set(3, 4, 5);
    scene.add(ambient, key);

    let renderFrameId: number | null = null;
    let transitionFrameId: number | null = null;
    let renderRequestedWhileDeferred = false;
    const render = (): void => {
      if (initialRenderDeferredRef.current) {
        renderRequestedWhileDeferred = true;
        return;
      }
      if (renderFrameId !== null) return;
      renderFrameId = window.requestAnimationFrame(() => {
        renderFrameId = null;
        renderer.render(scene, camera);
      });
    };
    let runtime!: SceneRuntime;
    const pointFromClientPosition = (x: number, y: number): PointId | null => {
      const bounds = renderer.domElement.getBoundingClientRect();
      return pointFromCube3DClientPosition({
        camera,
        surface,
        targets: pickTargets,
        viewport: bounds,
      }, x, y);
    };
    runtime = {
      scene,
      camera,
      renderer,
      cubeRoot,
      surface,
      blackStones,
      whiteStones,
      hoverMarker,
      pickTargets,
      render,
      pointFromClientPosition,
    };
    runtimeRef.current = runtime;
    host.dataset.cube3dSize = String(size);
    host.dataset.cube3dGridPitch = cube3DGridPitch(size).toFixed(6);
    host.dataset.cube3dMarkerRatio = String(CUBE_3D_MARKER_DIAMETER_PITCH_RATIO);
    host.dataset.cube3dTransitioning = 'false';

    const finishViewTransition = (target: Cube3DViewState): void => {
      transitionFrameId = null;
      viewStateRef.current = target;
      applyViewState(runtime, target);
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

      const startRotation = runtime.cubeRoot.quaternion.clone().normalize();
      const targetRotation = new THREE.Quaternion(
        target.rotation.x,
        target.rotation.y,
        target.rotation.z,
        target.rotation.w,
      ).normalize();
      const startZoom = BASE_CAMERA_DISTANCE / runtime.camera.position.z;
      const startedAt = performance.now();

      const frame = (now: number): void => {
        const progress = Math.min(1, Math.max(0, (now - startedAt) / VIEW_TRANSITION_MS));
        const eased = easeOutCubic(progress);
        runtime.cubeRoot.quaternion.copy(startRotation).slerp(targetRotation, eased).normalize();
        const zoom = startZoom + (target.zoom - startZoom) * eased;
        runtime.camera.position.set(0, 0, BASE_CAMERA_DISTANCE / zoom);
        runtime.camera.lookAt(0, 0, 0);
        runtime.camera.updateMatrixWorld(true);
        runtime.cubeRoot.updateMatrixWorld(true);
        runtime.renderer.render(runtime.scene, runtime.camera);

        if (progress < 1) {
          transitionFrameId = window.requestAnimationFrame(frame);
          return;
        }
        finishViewTransition(target);
      };

      transitionFrameId = window.requestAnimationFrame(frame);
    };

    const resize = (): void => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render();
    };

    let drag: DragSession | null = null;

    const pointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || viewTransitioningRef.current) return;
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rotation: new THREE.Quaternion(
          viewStateRef.current.rotation.x,
          viewStateRef.current.rotation.y,
          viewStateRef.current.rotation.z,
          viewStateRef.current.rotation.w,
        ),
        dragging: false,
      };
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event: PointerEvent): void => {
      if (!drag || drag.pointerId !== event.pointerId) {
        if (event.buttons === 0 && !viewTransitioningRef.current) {
          onPointHoverRef.current(
            inputDisabledRef.current ? null : runtime.pointFromClientPosition(event.clientX, event.clientY),
          );
        }
        return;
      }

      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      if (!drag.dragging) {
        if (!pointerMovementExceedsDragThreshold(deltaX, deltaY)) return;
        drag.dragging = true;
        onPointHoverRef.current(null);
      }

      event.preventDefault();
      const nextQuaternion = cube3DScreenSpaceDragRotation(
        drag.rotation,
        camera.quaternion,
        deltaX,
        deltaY,
        ROTATION_SENSITIVITY,
      );
      const nextState = withCube3DRotation(viewStateRef.current, toQuaternionState(nextQuaternion));
      viewStateRef.current = nextState;
      cubeRoot.quaternion.copy(nextQuaternion);
      cubeRoot.updateMatrixWorld(true);
      render();
      onViewStateChangeRef.current(nextState);
    };

    const finishPointer = (event: PointerEvent, activate: boolean): void => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const wasDragging = drag.dragging;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      drag = null;
      if (wasDragging || !activate || inputDisabledRef.current || viewTransitioningRef.current) return;

      const pointId = runtime.pointFromClientPosition(event.clientX, event.clientY);
      onPointHoverRef.current(pointId);
      if (pointId) onPointActivateRef.current(pointId);
    };

    const pointerUp = (event: PointerEvent): void => finishPointer(event, true);
    const pointerCancel = (event: PointerEvent): void => finishPointer(event, false);
    const pointerLeave = (): void => {
      if (!drag) onPointHoverRef.current(null);
    };

    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (viewTransitioningRef.current) return;
      const nextState = withCube3DZoom(
        viewStateRef.current,
        viewStateRef.current.zoom * Math.exp(-event.deltaY * ZOOM_SENSITIVITY),
      );
      viewStateRef.current = nextState;
      applyViewState(runtime, nextState);
      onViewStateChangeRef.current(nextState);
    };

    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerCancel);
    renderer.domElement.addEventListener('pointerleave', pointerLeave);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    applyViewState(runtime, viewStateRef.current);
    resize();

    const releaseInitialRender = (): void => {
      if (!initialRenderDeferredRef.current) return;
      initialRenderDeferredRef.current = false;
      if (renderRequestedWhileDeferred) {
        renderRequestedWhileDeferred = false;
        render();
      }
    };
    const initialRenderFallbackTimer = initialRenderDeferredRef.current
      ? window.setTimeout(releaseInitialRender, INITIAL_RENDER_DEFER_FALLBACK_MS)
      : null;

    return () => {
      observer.disconnect();
      startViewTransitionRef.current = () => undefined;
      viewTransitioningRef.current = false;
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('wheel', wheel);
      if (initialRenderFallbackTimer !== null) window.clearTimeout(initialRenderFallbackTimer);
      if (renderFrameId !== null) {
        window.cancelAnimationFrame(renderFrameId);
        renderFrameId = null;
      }
      if (transitionFrameId !== null) {
        window.cancelAnimationFrame(transitionFrameId);
        transitionFrameId = null;
      }
      surfaceGeometry.dispose();
      surfaceMaterial.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      stoneGeometry.dispose();
      blackMaterial.dispose();
      whiteMaterial.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
      disposeCube3DPickTargets(pickTargets);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      scene.clear();
      runtimeRef.current = null;
    };
  }, [size]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && !viewTransitioningRef.current) applyViewState(runtime, viewState);
  }, [viewState]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    updateStoneInstances(size, viewModel, runtime.blackStones, runtime.whiteStones);
    updateHoverMarker(size, viewModel, hoveredPointId, hoverStatus, runtime.hoverMarker);
    const host = hostRef.current;
    if (host) {
      host.dataset.cube3dHoveredPoint = hoveredPointId ?? '';
      host.dataset.cube3dHoverStatus = hoverStatus ?? '';
    }
    runtime.render();
  }, [hoverStatus, hoveredPointId, size, viewModel]);

  useEffect(() => {
    if (inputDisabled) {
      onPointHoverRef.current(null);
      return;
    }
    if (!initialRenderDeferredRef.current) return;
    initialRenderDeferredRef.current = false;
    runtimeRef.current?.render();
  }, [inputDisabled]);

  const navigate = (direction: Cube3DNavigationDirection): void => {
    if (viewTransitioningRef.current) return;
    startViewTransitionRef.current(cube3DNavigationTarget(viewStateRef.current, direction));
  };

  const resetView = (): void => {
    if (viewTransitioningRef.current) return;
    startViewTransitionRef.current(cube3DResetTarget());
  };

  return (
    <div className="cube-3d-interaction-surface">
      <div ref={hostRef} className="cube-3d-scene" aria-label="Cube 3D scene" />
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
