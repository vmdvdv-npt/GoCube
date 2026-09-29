import * as THREE from 'three';

export interface Shared3DQuaternionState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Shared3DAngularInertia {
  readonly axis: Readonly<{ x: number; y: number; z: number }>;
  readonly speedRadPerSecond: number;
  readonly dampingPerSecond: number;
  readonly mode: 'gentle' | 'spin';
}

export interface Shared3DInertiaFrame {
  readonly rotation: THREE.Quaternion;
  readonly inertia: Shared3DAngularInertia;
}

export const SHARED_3D_INERTIA_SAMPLE_WINDOW_MS = 80;
export const SHARED_3D_INERTIA_RELEASE_MAX_AGE_MS = 90;
export const SHARED_3D_INERTIA_STOP_SPEED_RAD_PER_SECOND = 0.025;

const SHARED_3D_FAST_THROW_THRESHOLD_RAD_PER_SECOND = 2.2;
const SHARED_3D_GENTLE_RELEASE_SCALE = 0.32;
const SHARED_3D_GENTLE_DAMPING_PER_SECOND = 5.5;
const SHARED_3D_SPIN_EXTRA_RELEASE_SCALE = 0.04;
const SHARED_3D_SPIN_MAX_RELEASE_SPEED_RAD_PER_SECOND = 0.9;
const SHARED_3D_SPIN_DAMPING_PER_SECOND = 0.85;
const SHARED_3D_MIN_SAMPLE_SECONDS = 0.006;
const QUATERNION_EPSILON = 1e-9;

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

const shortestRelativeRotation = (
  previousRotation: THREE.Quaternion,
  currentRotation: THREE.Quaternion,
): THREE.Quaternion => {
  const relative = currentRotation
    .clone()
    .normalize()
    .multiply(previousRotation.clone().normalize().invert())
    .normalize();
  if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w);
  return relative;
};

/**
 * Converts the most recent real drag motion into a deliberately compressed release velocity.
 * A normal drag gets a short, strongly damped glide. A deliberate fast throw is reduced to a
 * slow capped spin, then decays more gradually while keeping the measured rotational trajectory.
 */
export const shared3DReleaseInertia = (
  previousRotation: THREE.Quaternion,
  previousAtMs: number,
  currentRotation: THREE.Quaternion,
  currentAtMs: number,
  releaseAtMs: number,
): Shared3DAngularInertia | null => {
  const sampleSeconds = (currentAtMs - previousAtMs) / 1000;
  const releaseAgeMs = releaseAtMs - currentAtMs;
  if (
    !Number.isFinite(sampleSeconds) ||
    sampleSeconds < SHARED_3D_MIN_SAMPLE_SECONDS ||
    !Number.isFinite(releaseAgeMs) ||
    releaseAgeMs < 0 ||
    releaseAgeMs > SHARED_3D_INERTIA_RELEASE_MAX_AGE_MS
  ) return null;

  const relative = shortestRelativeRotation(previousRotation, currentRotation);
  const sinHalfAngle = Math.hypot(relative.x, relative.y, relative.z);
  if (sinHalfAngle <= QUATERNION_EPSILON) return null;

  const angle = 2 * Math.atan2(sinHalfAngle, Math.max(0, relative.w));
  const measuredSpeed = angle / sampleSeconds;
  if (!Number.isFinite(measuredSpeed) || measuredSpeed <= 0) return null;

  const axis = Object.freeze({
    x: relative.x / sinHalfAngle,
    y: relative.y / sinHalfAngle,
    z: relative.z / sinHalfAngle,
  });
  const fastThrow = measuredSpeed >= SHARED_3D_FAST_THROW_THRESHOLD_RAD_PER_SECOND;
  const thresholdReleaseSpeed =
    SHARED_3D_FAST_THROW_THRESHOLD_RAD_PER_SECOND * SHARED_3D_GENTLE_RELEASE_SCALE;
  const releaseSpeed = fastThrow
    ? Math.min(
        SHARED_3D_SPIN_MAX_RELEASE_SPEED_RAD_PER_SECOND,
        thresholdReleaseSpeed +
          (measuredSpeed - SHARED_3D_FAST_THROW_THRESHOLD_RAD_PER_SECOND) *
            SHARED_3D_SPIN_EXTRA_RELEASE_SCALE,
      )
    : measuredSpeed * SHARED_3D_GENTLE_RELEASE_SCALE;

  if (releaseSpeed <= SHARED_3D_INERTIA_STOP_SPEED_RAD_PER_SECOND) return null;

  return Object.freeze({
    axis,
    speedRadPerSecond: releaseSpeed,
    dampingPerSecond: fastThrow
      ? SHARED_3D_SPIN_DAMPING_PER_SECOND
      : SHARED_3D_GENTLE_DAMPING_PER_SECOND,
    mode: fastThrow ? 'spin' : 'gentle',
  });
};

/** Frame-rate-independent exponential angular damping for release inertia. */
export const advanceShared3DInertia = (
  currentRotation: THREE.Quaternion,
  inertia: Shared3DAngularInertia,
  deltaSeconds: number,
): Shared3DInertiaFrame => {
  const safeDeltaSeconds = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
  const damping = Math.max(0, inertia.dampingPerSecond);
  const speed = Math.max(0, inertia.speedRadPerSecond);
  if (safeDeltaSeconds === 0 || speed === 0) {
    return Object.freeze({
      rotation: currentRotation.clone().normalize(),
      inertia,
    });
  }

  const decay = damping === 0 ? 1 : Math.exp(-damping * safeDeltaSeconds);
  const angularTravel = damping === 0
    ? speed * safeDeltaSeconds
    : (speed / damping) * (1 - decay);
  const axis = new THREE.Vector3(inertia.axis.x, inertia.axis.y, inertia.axis.z).normalize();
  const step = new THREE.Quaternion().setFromAxisAngle(axis, angularTravel);
  const rotation = step.multiply(currentRotation.clone().normalize()).normalize();

  return Object.freeze({
    rotation,
    inertia: Object.freeze({
      ...inertia,
      speedRadPerSecond: speed * decay,
    }),
  });
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
