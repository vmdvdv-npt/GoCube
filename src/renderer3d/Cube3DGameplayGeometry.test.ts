import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  CUBE_3D_STONE_DIAMETER_PITCH_RATIO,
  CUBE_3D_STONE_HEIGHT_RADIUS_RATIO,
  CUBE_3D_STONE_LIFT_PITCH_RATIO,
  createCube3DStoneGeometry,
  cube3DGridPitch,
  cube3DStoneMatrix,
  cube3DStoneVisualMetrics,
} from './Cube3DGameplayGeometry';
import { cube3DPointSample } from './Cube3DSurfaceGeometry';

const point = (face: string, row: number, column: number): PointId =>
  `${face}:${row}:${column}` as PointId;

const transformedUp = (matrix: THREE.Matrix4): THREE.Vector3 => {
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).normalize();
};

const matrixPosition = (matrix: THREE.Matrix4): THREE.Vector3 =>
  new THREE.Vector3().setFromMatrixPosition(matrix);

describe('Cube3D gameplay geometry', () => {
  it.each([
    [5, point('front', 2, 2)],
    [5, point('front', 0, 2)],
    [5, point('front', 0, 0)],
    [7, point('right', 0, 6)],
  ] as const)('aligns stone local up to the sampled rounded-surface normal', (rawSize, pointId) => {
    const size = rawSize as CubeSize;
    const sample = cube3DPointSample(size, pointId);
    const expectedNormal = new THREE.Vector3(...sample.normal).normalize();
    const actualNormal = transformedUp(cube3DStoneMatrix(size, pointId));
    expect(actualNormal.dot(expectedNormal)).toBeGreaterThan(0.999999);
  });

  it.each([
    [4, point('front', 0, 0)],
    [5, point('top', 2, 4)],
    [7, point('right', 6, 3)],
    [8, point('back', 4, 4)],
  ] as const)('places stone matrices directly from the shared point sample', (rawSize, pointId) => {
    const size = rawSize as CubeSize;
    const { centerLift } = cube3DStoneVisualMetrics(size);
    const sample = cube3DPointSample(size, pointId);
    const expected = new THREE.Vector3(...sample.position).addScaledVector(
      new THREE.Vector3(...sample.normal).normalize(),
      centerLift,
    );
    const actual = matrixPosition(cube3DStoneMatrix(size, pointId));

    expect(actual.distanceTo(expected)).toBeLessThan(1e-10);
  });

  it.each([4, 5, 7, 8] as const)(
    'keeps the stone bottom just above the surface for %d×%d',
    (rawSize) => {
      const size = rawSize as CubeSize;
      const { pitch, radius, centerLift } = cube3DStoneVisualMetrics(size);
      const bottomLift = centerLift - radius * CUBE_3D_STONE_HEIGHT_RADIUS_RATIO;
      expect(bottomLift).toBeCloseTo(pitch * CUBE_3D_STONE_LIFT_PITCH_RATIO, 10);
      expect(bottomLift).toBeGreaterThan(0);
    },
  );

  it('scales the shared lens to the configured grid-pitch diameter', () => {
    const size = 5 as CubeSize;
    const pointId = point('front', 2, 2);
    const matrix = cube3DStoneMatrix(size, pointId);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, rotation, scale);
    const diameter = scale.x * 2;
    expect(diameter / cube3DGridPitch(size)).toBeCloseTo(
      CUBE_3D_STONE_DIAMETER_PITCH_RATIO,
      8,
    );
  });

  it('uses one reusable low-profile oblate lens rather than a sphere or flat disk per stone', () => {
    const geometry = createCube3DStoneGeometry();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const width = box.max.x - box.min.x;
    const height = box.max.y - box.min.y;
    const depth = box.max.z - box.min.z;
    expect(height).toBeGreaterThan(width * 0.25);
    expect(height).toBeLessThan(width * 0.35);
    expect(depth).toBeCloseTo(width, 2);
    geometry.dispose();
  });
});
