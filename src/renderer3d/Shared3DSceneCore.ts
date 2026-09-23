import * as THREE from 'three';
import type { PointId } from '../core/topology/Topology';
import { pointerMovementExceedsDragThreshold } from '../presentation/PointerGesture';
import {
  quaternionState,
  shared3DScreenSpaceDragRotation,
  shared3DWheelZoom,
  type Shared3DQuaternionState,
} from './Shared3DInput';
import {
  SHARED_3D_PERFORMANCE_BUDGET,
  shared3DMotionPixelRatio,
} from './Shared3DPerformance';

export const SHARED_3D_BASE_CAMERA_DISTANCE = 5;
export const SHARED_3D_ROTATION_SENSITIVITY = 0.008;
export const SHARED_3D_ZOOM_SENSITIVITY = 0.001;

export interface Shared3DViewTransform {
  readonly rotation: Shared3DQuaternionState;
  readonly zoom: number;
}

export interface Shared3DSceneCore {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly root: THREE.Group;
  readonly render: () => void;
  readonly renderNow: () => void;
  readonly beginMotion: () => void;
  readonly restoreResolution: () => void;
  readonly dispose: () => void;
}

export interface Shared3DSceneCoreOptions {
  readonly canvasTestId: string;
  readonly onAfterRender?: () => void;
}

export const applyShared3DViewTransform = (
  core: Shared3DSceneCore,
  transform: Shared3DViewTransform,
): void => {
  const { rotation } = transform;
  core.root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w).normalize();
  core.camera.position.set(0, 0, SHARED_3D_BASE_CAMERA_DISTANCE / transform.zoom);
  core.camera.lookAt(0, 0, 0);
  core.camera.updateMatrixWorld(true);
  core.root.updateMatrixWorld(true);
  core.render();
};

/** Shared WebGL/camera/light/render/resize/DPR lifecycle for topology adapters. */
export const createShared3DSceneCore = (
  host: HTMLElement,
  options: Shared3DSceneCoreOptions,
): Shared3DSceneCore => {
  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const idlePixelRatio = Math.min(
    window.devicePixelRatio,
    SHARED_3D_PERFORMANCE_BUDGET.maxDevicePixelRatio,
  );
  renderer.setPixelRatio(idlePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.dataset.testid = options.canvasTestId;
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);

  const root = new THREE.Group();
  scene.add(root);

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
  const renderNow = (): void => {
    if (renderFrameId !== null) {
      window.cancelAnimationFrame(renderFrameId);
      renderFrameId = null;
    }
    renderer.render(scene, camera);
    options.onAfterRender?.();
  };
  const render = (): void => {
    if (renderFrameId !== null) return;
    renderFrameId = window.requestAnimationFrame(() => {
      renderFrameId = null;
      renderNow();
    });
  };
  const beginMotion = (): void => {
    const ratio = shared3DMotionPixelRatio(idlePixelRatio, host.clientWidth, host.clientHeight);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  };
  const restoreResolution = (): void => {
    if (renderer.getPixelRatio() !== idlePixelRatio) renderer.setPixelRatio(idlePixelRatio);
  };
  const resize = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (renderFrameId !== null) window.cancelAnimationFrame(renderFrameId);
    key.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    scene.clear();
  };

  return Object.freeze({
    scene,
    camera,
    renderer,
    root,
    render,
    renderNow,
    beginMotion,
    restoreResolution,
    dispose,
  });
};

export interface Shared3DPointerInputOptions {
  readonly core: Shared3DSceneCore;
  readonly getViewTransform: () => Shared3DViewTransform;
  readonly commitViewTransform: (candidate: Shared3DViewTransform) => Shared3DViewTransform;
  readonly pointFromClientPosition: (x: number, y: number) => PointId | null;
  readonly onPointHover: (pointId: PointId | null) => void;
  readonly onPointActivate?: (pointId: PointId) => void;
  readonly inputDisabled: () => boolean;
  readonly interactionBlocked?: () => boolean;
  readonly zoomMin: number;
  readonly zoomMax: number;
  readonly rotationSensitivity?: number;
  readonly zoomSensitivity?: number;
}

/** Shared pointer capture, click-vs-drag, screen rotation, hover/pick and wheel lifecycle. */
export const attachShared3DPointerInput = (
  options: Shared3DPointerInputOptions,
): (() => void) => {
  const { core } = options;
  const canvas = core.renderer.domElement;
  let wheelSettleTimer: number | null = null;
  let drag: null | {
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly rotation: THREE.Quaternion;
    dragging: boolean;
  } = null;

  const blocked = (): boolean => options.interactionBlocked?.() ?? false;
  const pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || blocked()) return;
    const current = options.getViewTransform();
    drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rotation: new THREE.Quaternion(
        current.rotation.x,
        current.rotation.y,
        current.rotation.z,
        current.rotation.w,
      ),
      dragging: false,
    };
    canvas.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) {
      if (event.buttons === 0 && !blocked()) {
        options.onPointHover(
          options.inputDisabled() ? null : options.pointFromClientPosition(event.clientX, event.clientY),
        );
      }
      return;
    }
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (!drag.dragging) {
      if (!pointerMovementExceedsDragThreshold(deltaX, deltaY)) return;
      drag.dragging = true;
      options.onPointHover(null);
    }
    event.preventDefault();
    core.beginMotion();
    const rotation = shared3DScreenSpaceDragRotation(
      drag.rotation,
      core.camera.quaternion,
      deltaX,
      deltaY,
      options.rotationSensitivity ?? SHARED_3D_ROTATION_SENSITIVITY,
    );
    const accepted = options.commitViewTransform({
      rotation: quaternionState(rotation),
      zoom: options.getViewTransform().zoom,
    });
    applyShared3DViewTransform(core, accepted);
  };

  const finishPointer = (event: PointerEvent, activate: boolean): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasDragging = drag.dragging;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = null;
    if (wasDragging) {
      core.restoreResolution();
      core.renderNow();
    }
    if (wasDragging || !activate || options.inputDisabled() || blocked()) return;
    const pointId = options.pointFromClientPosition(event.clientX, event.clientY);
    options.onPointHover(pointId);
    if (pointId) options.onPointActivate?.(pointId);
  };

  const pointerUp = (event: PointerEvent): void => finishPointer(event, true);
  const pointerCancel = (event: PointerEvent): void => finishPointer(event, false);
  const pointerLeave = (): void => {
    if (!drag) options.onPointHover(null);
  };
  const wheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (blocked()) return;
    core.beginMotion();
    if (wheelSettleTimer !== null) window.clearTimeout(wheelSettleTimer);
    wheelSettleTimer = window.setTimeout(() => {
      wheelSettleTimer = null;
      core.restoreResolution();
      core.renderNow();
    }, 120);
    const current = options.getViewTransform();
    const accepted = options.commitViewTransform({
      rotation: current.rotation,
      zoom: shared3DWheelZoom(
        current.zoom,
        event.deltaY,
        options.zoomSensitivity ?? SHARED_3D_ZOOM_SENSITIVITY,
        options.zoomMin,
        options.zoomMax,
      ),
    });
    applyShared3DViewTransform(core, accepted);
  };

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('pointerleave', pointerLeave);
  canvas.addEventListener('wheel', wheel, { passive: false });

  return () => {
    if (wheelSettleTimer !== null) window.clearTimeout(wheelSettleTimer);
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerCancel);
    canvas.removeEventListener('pointerleave', pointerLeave);
    canvas.removeEventListener('wheel', wheel);
  };
};
