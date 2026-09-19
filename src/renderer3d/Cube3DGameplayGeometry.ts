import * as THREE from 'three';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  cube3DFaceSurfaceSpan,
  cube3DPointSample,
  type Cube3DSurfaceSample,
} from './Cube3DSurfaceGeometry';

export const CUBE_3D_STONE_DIAMETER_PITCH_RATIO = 0.83;
export const CUBE_3D_STONE_LIFT_PITCH_RATIO = 0.055;
export const CUBE_3D_MARKER_DIAMETER_PITCH_RATIO = 0.28;
export const CUBE_3D_MARKER_LIFT_PITCH_RATIO = 0.07;

const UP = new THREE.Vector3(0, 1, 0);

export const cube3DGridPitch = (size: CubeSize): number => cube3DFaceSurfaceSpan() / size;

const sampleVectors = (sample: Cube3DSurfaceSample) => ({
  position: new THREE.Vector3(...sample.position),
  normal: new THREE.Vector3(...sample.normal).normalize(),
});

export const cube3DSurfaceAlignedMatrix = (
  size: CubeSize,
  pointId: PointId,
  lift: number,
  scale = 1,
): THREE.Matrix4 => {
  const { position, normal } = sampleVectors(cube3DPointSample(size, pointId));
  position.addScaledVector(normal, lift);
  const rotation = new THREE.Quaternion().setFromUnitVectors(UP, normal);
  return new THREE.Matrix4().compose(
    position,
    rotation,
    new THREE.Vector3(scale, scale, scale),
  );
};

/** Shared, low-poly oblate lens. Instances are scaled to the current grid pitch. */
export const createCube3DStoneGeometry = (): THREE.BufferGeometry => {
  const geometry = new THREE.SphereGeometry(1, 20, 12);
  geometry.scale(1, 0.34, 1);
  geometry.computeVertexNormals();
  return geometry;
};

export const cube3DStoneMatrix = (size: CubeSize, pointId: PointId): THREE.Matrix4 => {
  const pitch = cube3DGridPitch(size);
  const radius = (pitch * CUBE_3D_STONE_DIAMETER_PITCH_RATIO) / 2;
  return cube3DSurfaceAlignedMatrix(
    size,
    pointId,
    pitch * CUBE_3D_STONE_LIFT_PITCH_RATIO + radius * 0.03,
    radius,
  );
};

export const cube3DMarkerMatrix = (size: CubeSize, pointId: PointId): THREE.Matrix4 => {
  const pitch = cube3DGridPitch(size);
  const radius = (pitch * CUBE_3D_MARKER_DIAMETER_PITCH_RATIO) / 2;
  return cube3DSurfaceAlignedMatrix(
    size,
    pointId,
    pitch * CUBE_3D_MARKER_LIFT_PITCH_RATIO,
    radius,
  );
};
