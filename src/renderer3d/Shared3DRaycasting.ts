import * as THREE from 'three';

export interface Shared3DViewportBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Shared client-coordinate validation and pointer-to-world-ray conversion. */
export const shared3DRaycasterFromClientPosition = (
  camera: THREE.Camera,
  viewport: Shared3DViewportBounds,
  clientX: number,
  clientY: number,
): THREE.Raycaster | null => {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }

  const localX = clientX - viewport.left;
  const localY = clientY - viewport.top;
  if (localX < 0 || localY < 0 || localX > viewport.width || localY > viewport.height) {
    return null;
  }

  const pointer = new THREE.Vector2(
    (localX / viewport.width) * 2 - 1,
    -(localY / viewport.height) * 2 + 1,
  );
  camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  return raycaster;
};
