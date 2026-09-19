import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import {
  withCube3DRotation,
  withCube3DZoom,
  type Cube3DViewState,
} from '../presentation/cube/Cube3DViewState';
import {
  createCube3DDebugGridGeometry,
  createCube3DDebugPointGeometry,
  createCube3DRoundedSurfaceGeometry,
} from './Cube3DSurfaceGeometry';
import { CUBE_3D_PERFORMANCE_BUDGET } from './Cube3DPerformance';
import './cube3d.css';

const BASE_CAMERA_DISTANCE = 5;
const ROTATION_SENSITIVITY = 0.008;
const ZOOM_SENSITIVITY = 0.001;
const DEFAULT_DEBUG_CUBE_SIZE: CubeSize = 4;

interface SceneRuntime {
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cubeRoot: THREE.Group;
  readonly render: () => void;
}

export interface ThreeSceneProps {
  readonly size?: CubeSize;
  readonly viewState: Cube3DViewState;
  readonly onViewStateChange: (state: Cube3DViewState) => void;
}

const toQuaternionState = (quaternion: THREE.Quaternion) =>
  Object.freeze({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });

/** Technical Cube 3D renderer-core scene. Game/domain state stays outside this boundary. */
export function ThreeScene({
  size = DEFAULT_DEBUG_CUBE_SIZE,
  viewState,
  onViewStateChange,
}: ThreeSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const viewStateRef = useRef(viewState);
  const onViewStateChangeRef = useRef(onViewStateChange);
  viewStateRef.current = viewState;
  onViewStateChangeRef.current = onViewStateChange;

  const applyViewState = (runtime: SceneRuntime, state: Cube3DViewState): void => {
    const { rotation } = state;
    runtime.cubeRoot.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
    runtime.camera.position.set(0, 0, BASE_CAMERA_DISTANCE / state.zoom);
    runtime.camera.lookAt(0, 0, 0);
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
    const surfaceMaterial = new THREE.MeshStandardMaterial({
      color: 0x747a80,
      roughness: 0.9,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);

    const gridGeometry = createCube3DDebugGridGeometry(size);
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0xe1e5e9 });
    const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
    grid.renderOrder = 1;

    const pointGeometry = createCube3DDebugPointGeometry(size);
    const pointMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.045,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(pointGeometry, pointMaterial);
    points.renderOrder = 2;

    const cubeRoot = new THREE.Group();
    cubeRoot.add(surface, grid, points);
    scene.add(cubeRoot);

    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 4, 5);
    scene.add(ambient, key);

    host.dataset.cube3dDebugPoints = String(6 * size * size);
    host.dataset.cube3dDebugGridEdges = String(12 * size * size);
    host.dataset.cube3dDebugPhysicalEdges = '12';
    host.dataset.cube3dDebugPhysicalCorners = '8';

    const render = (): void => renderer.render(scene, camera);
    const runtime: SceneRuntime = { camera, renderer, cubeRoot, render };
    runtimeRef.current = runtime;

    const resize = (): void => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      host.dataset.cube3dViewport = `${width}x${height}`;
      render();
    };

    let dragStart: Readonly<{
      pointerId: number;
      x: number;
      y: number;
      rotation: THREE.Quaternion;
    }> | null = null;

    const pointerDown = (event: PointerEvent): void => {
      dragStart = Object.freeze({
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rotation: new THREE.Quaternion(
          viewStateRef.current.rotation.x,
          viewStateRef.current.rotation.y,
          viewStateRef.current.rotation.z,
          viewStateRef.current.rotation.w,
        ),
      });
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event: PointerEvent): void => {
      if (!dragStart || dragStart.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - dragStart.x;
      const deltaY = event.clientY - dragStart.y;
      const yaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        deltaX * ROTATION_SENSITIVITY,
      );
      const pitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        deltaY * ROTATION_SENSITIVITY,
      );
      const nextQuaternion = yaw.multiply(dragStart.rotation).multiply(pitch).normalize();
      const nextState = withCube3DRotation(
        viewStateRef.current,
        toQuaternionState(nextQuaternion),
      );
      viewStateRef.current = nextState;
      cubeRoot.quaternion.copy(nextQuaternion);
      render();
      onViewStateChangeRef.current(nextState);
    };

    const endDrag = (event: PointerEvent): void => {
      if (!dragStart || dragStart.pointerId !== event.pointerId) return;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
      dragStart = null;
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
    renderer.domElement.addEventListener('pointerup', endDrag);
    renderer.domElement.addEventListener('pointercancel', endDrag);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    applyViewState(runtime, viewStateRef.current);
    resize();

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', endDrag);
      renderer.domElement.removeEventListener('pointercancel', endDrag);
      renderer.domElement.removeEventListener('wheel', wheel);
      surfaceGeometry.dispose();
      surfaceMaterial.dispose();
      gridGeometry.dispose();
      gridMaterial.dispose();
      pointGeometry.dispose();
      pointMaterial.dispose();
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

  return <div ref={hostRef} className="cube-3d-scene" aria-label="Cube 3D scene" />;
}
