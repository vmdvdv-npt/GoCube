import * as THREE from 'three';

export interface Cube3DArcballViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

const projectPointerToArcball = (
  pointer: PointerPosition,
  viewport: Cube3DArcballViewport,
): THREE.Vector3 => {
  const diameter = Math.max(1, Math.min(viewport.width, viewport.height));
  const radius = diameter / 2;
  const centerX = viewport.left + viewport.width / 2;
  const centerY = viewport.top + viewport.height / 2;
  const x = (pointer.x - centerX) / radius;
  const y = (centerY - pointer.y) / radius;
  const distanceSquared = x * x + y * y;

  if (distanceSquared <= 1) {
    return new THREE.Vector3(x, y, Math.sqrt(1 - distanceSquared)).normalize();
  }

  const inverseLength = 1 / Math.sqrt(distanceSquared);
  return new THREE.Vector3(x * inverseLength, y * inverseLength, 0);
};

/**
 * Maps a pointer drag through a virtual sphere centered on the viewport.
 *
 * The virtual-sphere vectors are transformed by the camera orientation before
 * their delta is pre-multiplied onto the cube. The cube quaternion therefore
 * remains authoritative while Arcball stays camera-relative.
 */
export const cube3DArcballDragRotation = (
  startRotation: THREE.Quaternion,
  cameraRotation: THREE.Quaternion,
  startPointer: PointerPosition,
  currentPointer: PointerPosition,
  viewport: Cube3DArcballViewport,
): THREE.Quaternion => {
  const normalizedStart = startRotation.clone().normalize();
  if (startPointer.x === currentPointer.x && startPointer.y === currentPointer.y) {
    return normalizedStart;
  }

  const startVector = projectPointerToArcball(startPointer, viewport)
    .applyQuaternion(cameraRotation)
    .normalize();
  const currentVector = projectPointerToArcball(currentPointer, viewport)
    .applyQuaternion(cameraRotation)
    .normalize();
  const worldDelta = new THREE.Quaternion()
    .setFromUnitVectors(startVector, currentVector)
    .normalize();

  return worldDelta.multiply(normalizedStart).normalize();
};
