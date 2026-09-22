import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type { EndgamePresentationModel } from '../presentation/EndgamePresentation';
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
import { CUBE_3D_PERFORMANCE_BUDGET } from './Cube3DPerformance';
import { cube3DScreenSpaceDragRotation } from './Cube3DScreenRotation';
import {
  createCube3DDebugGridGeometry,
  createCube3DRoundedSurfaceGeometry,
} from './Cube3DSurfaceGeometry';
import { createCube3DWoodMaterial } from './Cube3DWoodMaterial';
import './cube3d.css';

const BASE_CAMERA_DISTANCE = 5;
const ROTATION_SENSITIVITY = 0.008;
const ZOOM_SENSITIVITY = 0.001;
const MARKER_THICKNESS = 0.08;
const INITIAL_RENDER_DEFER_FALLBACK_MS = 500;
const VIEW_TRANSITION_MS = 240;

type Cube3DRotationMode = 'screen' | 'arcball';

interface SceneRuntime {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cubeRoot: THREE.Group;
  readonly surface: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  readonly blackStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly whiteStones: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  readonly hoverMarker: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly featureLayer: Cube3DFeatureLayer;
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

const toQuaternionState = (quaternion: THREE.Quaternion) =>
  Object.freeze({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });

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
  const initialRenderDeferredRef = useRef(inputDisabled);
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
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, CUBE_3D_PERFORMANCE_BUDGET.maxDevicePixelRatio),
    );
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.dataset.testid = 'cube-3d-canvas';
    renderer.domElement.style.touchAction = 'none';
    host.appendChild(renderer.domElement);

    const surfaceGeometry = createCube3DRoundedSurfaceGeometry();
    const surfaceMaterial = createCube3DWoodMaterial();
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surface.receiveShadow = true;
    surface.castShadow = true;
    // A closed body casts from its back faces to avoid self-shadow acne.
    surfaceMaterial.shadowSide = THREE.BackSide;

    // Stage 1's continuous adjacency geometry is now the production gameplay grid.
    const gridGeometry = createCube3DDebugGridGeometry(size);
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x362316, depthTest: true, depthWrite: true });
    const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
    grid.renderOrder = 1;

    const stoneGeometry = createCube3DStoneGeometry();
    const blackMaterial = new THREE.MeshPhysicalMaterial({ color: 0x17191c, roughness: 0.29, clearcoat: 0.3, clearcoatRoughness: 0.35 });
    const whiteMaterial = new THREE.MeshPhysicalMaterial({ color: 0xf4efdf, roughness: 0.25, clearcoat: 0.35, clearcoatRoughness: 0.3 });
    blackMaterial.shadowSide = whiteMaterial.shadowSide = THREE.FrontSide;
    const capacity = 6 * size * size;
    const blackStones = new THREE.InstancedMesh(stoneGeometry, blackMaterial, capacity);
    const whiteStones = new THREE.InstancedMesh(stoneGeometry, whiteMaterial, capacity);
    blackStones.castShadow = whiteStones.castShadow = true;
    blackStones.count = 0;
    whiteStones.count = 0;
    blackStones.renderOrder = 2;
    whiteStones.renderOrder = 2;

    const markerGeometry = new THREE.CylinderGeometry(1, 1, MARKER_THICKNESS, 20);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xe04c4c });
    const hoverMarker = new THREE.Mesh(markerGeometry, markerMaterial);
    const haloGeometry = new THREE.RingGeometry(1.35, 1.65, 48);
    haloGeometry.rotateX(-Math.PI / 2);
    const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xffde8b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.position.y = 0.06;
    hoverMarker.add(halo);
    hoverMarker.visible = false;
    hoverMarker.renderOrder = 3;

    const featureLayer = createCube3DFeatureLayer(size);
    const pickTargets = createCube3DPickTargets(size);
    pickTargets.mesh.renderOrder = 7;

    const cubeRoot = new THREE.Group();
    cubeRoot.add(
      surface,
      grid,
      blackStones,
      whiteStones,
      hoverMarker,
      featureLayer.group,
      pickTargets.mesh,
    );
    scene.add(cubeRoot);

    const ambient = new THREE.HemisphereLight(0xe2edff, 0x705137, 1.4);
    const key = new THREE.DirectionalLight(0xffe4bd, 2.6);
    key.position.set(-3, 5, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top = 2;
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 12;
    key.shadow.normalBias = 0.002;
    key.shadow.bias = -0.00015;
    key.shadow.radius = 3;
    const fill = new THREE.DirectionalLight(0xc0d9ff, 1.1);
    fill.position.set(4, 1, 2);
    const rim = new THREE.DirectionalLight(0xffd7a1, 2.4);
    rim.position.set(1, 3, -4);
    scene.add(ambient, key, fill, rim);

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
      featureLayer,
      pickTargets,
      render,
      pointFromClientPosition,
    };
    runtimeRef.current = runtime;
    host.dataset.cube3dSize = String(size);
    host.dataset.cube3dGridPitch = cube3DGridPitch(size).toFixed(6);
    host.dataset.cube3dMarkerRatio = String(CUBE_3D_MARKER_DIAMETER_PITCH_RATIO);
    host.dataset.cube3dTransitioning = 'false';
    host.dataset.cube3dRotationMode = rotationModeRef.current;

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
      const nextQuaternion =
        rotationModeRef.current === 'arcball'
          ? cube3DArcballDragRotation(
              drag.rotation,
              camera.quaternion,
              { x: drag.x, y: drag.y },
              { x: event.clientX, y: event.clientY },
              renderer.domElement.getBoundingClientRect(),
            )
          : cube3DScreenSpaceDragRotation(
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
      featureLayer.dispose();
      key.shadow.dispose();
      surfaceGeometry.dispose();
      surfaceMaterial.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      stoneGeometry.dispose();
      blackMaterial.dispose();
      whiteMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
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
    const stoneCounts = updateStoneInstances(size, viewModel, runtime.blackStones, runtime.whiteStones);
    updateHoverMarker(size, viewModel, hoveredPointId, hoverStatus, runtime.hoverMarker);
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
    runtime.render();
  }, [endgamePresentation, hoverStatus, hoveredPointId, showMoveNumbers, size, viewModel]);

  useEffect(() => {
    const previous = previousModelRef.current;
    previousModelRef.current = viewModel;
    const runtime = runtimeRef.current;
    if (!runtime || !previous || animationMode === 'disabled' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      viewModel.moveNumber !== previous.moveNumber + 1) return;
    const point = viewModel.points.find((candidate) => candidate.logicalPointId === viewModel.lastMovePointId);
    if (!point || point.occupancy === 'empty' ||
      previous.points.find((candidate) => candidate.logicalPointId === point.logicalPointId)?.occupancy !== 'empty') return;
    const stones = point.occupancy === 'black' ? runtime.blackStones : runtime.whiteStones;
    const index = viewModel.points.filter((candidate) => candidate.occupancy === point.occupancy)
      .findIndex((candidate) => candidate.logicalPointId === point.logicalPointId);
    const finalMatrix = cube3DStoneMatrix(size, point.logicalPointId);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    finalMatrix.decompose(position, rotation, scale);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
    const started = performance.now();
    let frameId = 0;
    const frame = (now: number) => {
      const progress = Math.min(1, (now - started) / 180);
      const eased = easeOutCubic(progress);
      const matrix = new THREE.Matrix4().compose(
        position.clone().addScaledVector(normal, (1 - eased) * cube3DGridPitch(size) * 0.22),
        rotation, scale.clone().multiplyScalar(0.75 + eased * 0.25),
      );
      stones.setMatrixAt(index, matrix);
      stones.instanceMatrix.needsUpdate = true;
      runtime.render();
      if (progress < 1) frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      stones.setMatrixAt(index, finalMatrix);
      stones.instanceMatrix.needsUpdate = true;
      runtime.render();
    };
  }, [animationMode, size, viewModel]);

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
