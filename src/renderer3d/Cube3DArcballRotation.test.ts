import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cube3DArcballDragRotation } from './Cube3DArcballRotation';

const viewport = Object.freeze({ left: 0, top: 0, width: 400, height: 400 });
const identityCamera = new THREE.Quaternion();

const relativeDelta = (
  start: THREE.Quaternion,
  next: THREE.Quaternion,
): THREE.Quaternion => next.clone().multiply(start.clone().normalize().invert()).normalize();

const expectSameRotation = (actual: THREE.Quaternion, expected: THREE.Quaternion): void => {
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 6);
};

describe('cube3DArcballDragRotation', () => {
  it('uses the virtual sphere for cardinal drags through the viewport center', () => {
    const start = new THREE.Quaternion();
    const center = { x: 200, y: 200 };

    const right = relativeDelta(
      start,
      cube3DArcballDragRotation(start, identityCamera, center, { x: 240, y: 200 }, viewport),
    );
    const down = relativeDelta(
      start,
      cube3DArcballDragRotation(start, identityCamera, center, { x: 200, y: 240 }, viewport),
    );

    const angle = Math.asin(0.2);
    expectSameRotation(right, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
    expectSameRotation(down, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle));
  });

  it('keeps the arcball delta independent of the cube current orientation', () => {
    const center = { x: 200, y: 200 };
    const pointer = { x: 250, y: 160 };
    const starts = [
      new THREE.Quaternion(),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, -1.1, 0.45, 'YXZ')),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
    ];

    const baseline = relativeDelta(
      starts[0],
      cube3DArcballDragRotation(starts[0], identityCamera, center, pointer, viewport),
    );

    for (const start of starts.slice(1)) {
      const delta = relativeDelta(
        start,
        cube3DArcballDragRotation(start, identityCamera, center, pointer, viewport),
      );
      expectSameRotation(delta, baseline);
    }
  });

  it('allows genuine arcball roll for an off-center horizontal drag', () => {
    const start = new THREE.Quaternion();
    const next = cube3DArcballDragRotation(
      start,
      identityCamera,
      { x: 200, y: 120 },
      { x: 240, y: 120 },
      viewport,
    );
    const delta = relativeDelta(start, next);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
    const scale = Math.sin(angle / 2);
    const axis = new THREE.Vector3(delta.x / scale, delta.y / scale, delta.z / scale).normalize();

    expect(Math.abs(axis.z)).toBeGreaterThan(0.05);
  });

  it('continues rotating for radial drags outside the virtual sphere', () => {
    const start = new THREE.Quaternion();
    const next = cube3DArcballDragRotation(
      start,
      identityCamera,
      { x: 390, y: 200 },
      { x: 430, y: 200 },
      viewport,
    );

    expect(Math.abs(next.w)).toBeLessThan(0.999999);
    expect(next.length()).toBeCloseTo(1, 8);
  });

  it('rotates the virtual sphere with the camera basis', () => {
    const camera = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.55, 0.2));
    const start = new THREE.Quaternion();
    const center = { x: 200, y: 200 };
    const next = cube3DArcballDragRotation(start, camera, center, { x: 240, y: 200 }, viewport);

    const cameraSpaceDelta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.asin(0.2),
    );
    const expected = camera.clone().multiply(cameraSpaceDelta).multiply(camera.clone().invert()).normalize();

    expectSameRotation(next, expected);
  });

  it('normalizes the quaternion even when there is no pointer movement', () => {
    const start = new THREE.Quaternion(0.2, -0.3, 0.4, 0.5);
    const pointer = { x: 150, y: 170 };
    const next = cube3DArcballDragRotation(start, identityCamera, pointer, pointer, viewport);

    expect(next.length()).toBeCloseTo(1, 8);
    expectSameRotation(next, start.clone().normalize());
  });
});
