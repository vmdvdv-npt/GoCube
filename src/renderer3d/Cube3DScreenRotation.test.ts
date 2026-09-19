import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cube3DScreenSpaceDragRotation } from './Cube3DScreenRotation';

const SENSITIVITY = 0.008;
const IDENTITY_CAMERA = new THREE.Quaternion();

const expectSameRotation = (actual: THREE.Quaternion, expected: THREE.Quaternion): void => {
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 10);
};

const relativeRotation = (
  nextRotation: THREE.Quaternion,
  startRotation: THREE.Quaternion,
): THREE.Quaternion => nextRotation.clone().multiply(startRotation.clone().invert()).normalize();

const orientations = [
  new THREE.Quaternion(),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(0.73, -1.14, 0.39, 'YXZ')),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.91, 0.48, -0.67, 'ZYX')),
].map((rotation) => rotation.normalize());

describe('cube3DScreenSpaceDragRotation', () => {
  it('keeps cardinal drag directions screen-relative at standard, 90°, 180° and arbitrary orientations', () => {
    const cardinalDrags = [
      { deltaX: 0, deltaY: -50, axis: new THREE.Vector3(-1, 0, 0), angle: 50 * SENSITIVITY },
      { deltaX: 0, deltaY: 50, axis: new THREE.Vector3(1, 0, 0), angle: 50 * SENSITIVITY },
      { deltaX: 50, deltaY: 0, axis: new THREE.Vector3(0, 1, 0), angle: 50 * SENSITIVITY },
      { deltaX: -50, deltaY: 0, axis: new THREE.Vector3(0, -1, 0), angle: 50 * SENSITIVITY },
    ];

    for (const startRotation of orientations) {
      for (const drag of cardinalDrags) {
        const nextRotation = cube3DScreenSpaceDragRotation(
          startRotation,
          IDENTITY_CAMERA,
          drag.deltaX,
          drag.deltaY,
          SENSITIVITY,
        );
        const expectedDelta = new THREE.Quaternion().setFromAxisAngle(drag.axis, drag.angle);

        expectSameRotation(relativeRotation(nextRotation, startRotation), expectedDelta);
        expect(nextRotation.length()).toBeCloseTo(1, 12);
      }
    }
  });

  it('combines diagonal pointer movement into one screen-space rotation independent of cube orientation', () => {
    const deltaX = 45;
    const deltaY = -30;
    const expectedAxis = new THREE.Vector3(deltaY, deltaX, 0).normalize();
    const expectedAngle = Math.hypot(deltaX, deltaY) * SENSITIVITY;
    const expectedDelta = new THREE.Quaternion().setFromAxisAngle(expectedAxis, expectedAngle);

    for (const startRotation of orientations) {
      const nextRotation = cube3DScreenSpaceDragRotation(
        startRotation,
        IDENTITY_CAMERA,
        deltaX,
        deltaY,
        SENSITIVITY,
      );

      expectSameRotation(relativeRotation(nextRotation, startRotation), expectedDelta);
      expect(nextRotation.length()).toBeCloseTo(1, 12);
    }
  });

  it('uses camera-relative right and up axes instead of cube-local axes', () => {
    const cameraRotation = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.31, -0.44, 0.27, 'YXZ'))
      .normalize();
    const startRotation = orientations[4]!;
    const deltaX = 36;
    const deltaY = 24;
    const cameraRelativeAxis = new THREE.Vector3(deltaY, deltaX, 0)
      .normalize()
      .applyQuaternion(cameraRotation)
      .normalize();
    const expectedDelta = new THREE.Quaternion().setFromAxisAngle(
      cameraRelativeAxis,
      Math.hypot(deltaX, deltaY) * SENSITIVITY,
    );

    const nextRotation = cube3DScreenSpaceDragRotation(
      startRotation,
      cameraRotation,
      deltaX,
      deltaY,
      SENSITIVITY,
    );

    expectSameRotation(relativeRotation(nextRotation, startRotation), expectedDelta);
    expect(nextRotation.length()).toBeCloseTo(1, 12);
  });

  it('normalizes the authoritative quaternion even when there is no pointer movement', () => {
    const unnormalized = orientations[3]!.clone();
    unnormalized.set(
      unnormalized.x * 3,
      unnormalized.y * 3,
      unnormalized.z * 3,
      unnormalized.w * 3,
    );

    const nextRotation = cube3DScreenSpaceDragRotation(
      unnormalized,
      IDENTITY_CAMERA,
      0,
      0,
      SENSITIVITY,
    );

    expect(nextRotation.length()).toBeCloseTo(1, 12);
    expectSameRotation(nextRotation, orientations[3]!);
  });
});
