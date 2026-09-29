import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  advanceShared3DInertia,
  SHARED_3D_INERTIA_STOP_SPEED_RAD_PER_SECOND,
  shared3DReleaseInertia,
  type Shared3DAngularInertia,
} from './Shared3DInput';

const expectSameRotation = (actual: THREE.Quaternion, expected: THREE.Quaternion): void => {
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 10);
};

const relativeRotation = (
  nextRotation: THREE.Quaternion,
  startRotation: THREE.Quaternion,
): THREE.Quaternion => nextRotation.clone().multiply(startRotation.clone().invert()).normalize();

describe('shared 3D release inertia', () => {
  it('compresses a deliberate fast throw into a slower long-tail spin on the same axis', () => {
    const axis = new THREE.Vector3(0, 1, 0);
    const previous = new THREE.Quaternion();
    const current = new THREE.Quaternion().setFromAxisAngle(axis, 0.5);
    const inertia = shared3DReleaseInertia(previous, 100, current, 150, 158);

    expect(inertia).not.toBeNull();
    expect(inertia!.mode).toBe('spin');
    expect(inertia!.speedRadPerSecond).toBeLessThan(0.5 / 0.05);
    expect(inertia!.speedRadPerSecond).toBeGreaterThan(
      SHARED_3D_INERTIA_STOP_SPEED_RAD_PER_SECOND,
    );
    expect(inertia!.axis.x).toBeCloseTo(0, 10);
    expect(inertia!.axis.y).toBeCloseTo(1, 10);
    expect(inertia!.axis.z).toBeCloseTo(0, 10);
  });

  it('gives an ordinary slow drag only a short strongly damped glide', () => {
    const axis = new THREE.Vector3(1, 0, 0);
    const previous = new THREE.Quaternion();
    const current = new THREE.Quaternion().setFromAxisAngle(axis, 0.05);
    const gentle = shared3DReleaseInertia(previous, 100, current, 150, 158);
    const fast = shared3DReleaseInertia(
      previous,
      100,
      new THREE.Quaternion().setFromAxisAngle(axis, 0.5),
      150,
      158,
    );

    expect(gentle).not.toBeNull();
    expect(fast).not.toBeNull();
    expect(gentle!.mode).toBe('gentle');
    expect(gentle!.speedRadPerSecond).toBeLessThan(fast!.speedRadPerSecond);
    expect(gentle!.dampingPerSecond).toBeGreaterThan(fast!.dampingPerSecond);
  });

  it('does not reuse stale motion when the pointer stopped before release', () => {
    const previous = new THREE.Quaternion();
    const current = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);

    expect(shared3DReleaseInertia(previous, 100, current, 150, 300)).toBeNull();
  });

  it('advances along the measured trajectory with frame-rate-independent exponential damping', () => {
    const start = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.4, -0.6, 0.2, 'YXZ'))
      .normalize();
    const inertia: Shared3DAngularInertia = Object.freeze({
      axis: Object.freeze({ x: 0, y: 1, z: 0 }),
      speedRadPerSecond: 0.8,
      dampingPerSecond: 1,
      mode: 'spin',
    });
    const deltaSeconds = 0.1;
    const angularTravel = 0.8 * (1 - Math.exp(-deltaSeconds));
    const expectedDelta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angularTravel,
    );

    const frame = advanceShared3DInertia(start, inertia, deltaSeconds);

    expectSameRotation(relativeRotation(frame.rotation, start), expectedDelta);
    expect(frame.rotation.length()).toBeCloseTo(1, 12);
    expect(frame.inertia.speedRadPerSecond).toBeCloseTo(0.8 * Math.exp(-deltaSeconds), 12);
  });
});
