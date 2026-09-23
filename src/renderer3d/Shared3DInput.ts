import * as THREE from 'three';

export interface Shared3DQuaternionState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Camera-relative screen-space rotation shared by every 3D topology. */
export const shared3DScreenSpaceDragRotation = (
  startRotation: THREE.Quaternion,
  cameraRotation: THREE.Quaternion,
  deltaX: number,
  deltaY: number,
  sensitivity: number,
): THREE.Quaternion => {
  const dragDistance = Math.hypot(deltaX, deltaY);
  const normalizedStart = startRotation.clone().normalize();
  if (dragDistance === 0) return normalizedStart;

  const screenSpaceAxis = new THREE.Vector3(deltaY, deltaX, 0)
    .normalize()
    .applyQuaternion(cameraRotation)
    .normalize();
  const screenSpaceDelta = new THREE.Quaternion().setFromAxisAngle(
    screenSpaceAxis,
    dragDistance * sensitivity,
  );

  return screenSpaceDelta.multiply(normalizedStart).normalize();
};

/** Exponential wheel zoom used by the shared 3D interaction path. */
export const shared3DWheelZoom = (
  currentZoom: number,
  deltaY: number,
  sensitivity: number,
  minimum: number,
  maximum: number,
): number => {
  const next = currentZoom * Math.exp(-deltaY * sensitivity);
  return Math.min(maximum, Math.max(minimum, next));
};

export const quaternionState = (quaternion: THREE.Quaternion): Shared3DQuaternionState =>
  Object.freeze({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
