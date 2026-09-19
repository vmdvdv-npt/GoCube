import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import type { GamePointHoverStatus } from '../presentation/GamePointHoverStatus';
import type { GameViewModel } from '../presentation/PresentationModel';
import { pointerMovementExceedsDragThreshold } from '../presentation/PointerGesture';
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
import {
  createCube3DDebugGridGeometry,
  createCube3DRoundedSurfaceGeometry,
} from './Cube3DSurfaceGeometry';
import { CUBE_3D_PERFORMANCE_BUDGET } from './Cube3DPerformance';
import './cube3d.css';

const BASE_CAMERA_DISTANCE = 5;
const ROTATION_SENSITIVITY = 0.008;
const ZOOM_SENSITIVITY = 0.001;
const MARKER_THICKNESS = 0.08;

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
  readonly onPointHover: (pointId: PointId | null) => void;
  readonly onPointActivate: (pointId: PointId) => void;
}

const toQuaternionState = (quaternion: THREE.Quaternion) =>
  Object.freeze({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });

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
  onPointHover,
  onPointActivate,
}: ThreeSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const viewStateRef = useRef(viewState);
  const inputDisabledRef = useRef(inputDisabled);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const onPointHoverRef = useRef(onPointHover);
  const onPointActivateRef = useRef(onPointActivate);
  viewStateRef.current = viewState;
  inputDisabledRef.current = inputDisabled;
  onViewStateChangeRef.current = onViewStateChange;
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
    const blackMaterial = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.52 });
    const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xeee9df, roughness: 0.58 });
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

    const render = (): void => renderer.render(scene, camera);
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
      if (event.button !== 0) return;
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
        if (event.buttons === 0) {
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
      const yaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        deltaX * ROTATION_SENSITIVITY,
      );
      const pitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        deltaY * ROTATION_SENSITIVITY,
      );
      const nextQuaternion = yaw.multiply(drag.rotation).multiply(pitch).normalize();
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
      if (wasDragging || !activate || inputDisabledRef.current) return;

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

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerCancel);
      renderer.domElement.removeEventListener('pointerleave', pointerLeave);
      renderer.domElement.removeEventListener('wheel', wheel);
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
    if (runtime) applyViewState(runtime, viewState);
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
    if (inputDisabled) onPointHoverRef.current(null);
  }, [inputDisabled]);

  return <div ref={hostRef} className="cube-3d-scene" aria-label="Cube 3D scene" />;
}
