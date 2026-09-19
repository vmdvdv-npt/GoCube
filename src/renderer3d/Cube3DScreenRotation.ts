import * as THREE from 'three';

/**
 * Maps a pointer drag to one camera-relative screen-space rotation.
 *
 * Horizontal pointer movement rotates around the camera's up axis, while
 * vertical movement rotates around the camera's right axis. The resulting
 * delta is pre-multiplied so it stays screen-relative regardless of the
 * cube's current orientation.
 */
export const cube3DScreenSpaceDragRotation = (
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
