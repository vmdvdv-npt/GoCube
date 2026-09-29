import * as THREE from 'three';
import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';
import {
  SHARED_3D_MARKER_DIAMETER_PITCH_RATIO,
  SHARED_3D_MARKER_LIFT_PITCH_RATIO,
  SHARED_3D_STONE_DIAMETER_PITCH_RATIO,
  SHARED_3D_STONE_LIFT_PITCH_RATIO,
} from './Shared3DGameplayVisuals';
import {
  createTorus3DGridLayout,
  torus3DSurfacePoint,
} from './Torus3DSurfaceMapping';

const vector = (value: Readonly<{ x: number; y: number; z: number }>): THREE.Vector3 =>
  new THREE.Vector3(value.x, value.y, value.z);

export const torus3DGridPitch = (size: TorusSize): number =>
  createTorus3DGridLayout(size).gridStep;

/** Stable local frame: local X=tangent, local Y=surface normal, local Z=bitangent. */
export const torus3DSurfaceAlignedMatrix = (
  size: TorusSize,
  pointId: PointId,
  lift: number,
  scale = 1,
): THREE.Matrix4 => {
  const sample = torus3DSurfacePoint(size, pointId);
  const position = vector(sample.position);
  const normal = vector(sample.normal).normalize();
  const tangent = vector(sample.tangent).normalize();
  const bitangent = tangent.clone().cross(normal).normalize();
  position.addScaledVector(normal, lift);
  const basis = new THREE.Matrix4().makeBasis(tangent, normal, bitangent);
  const rotation = new THREE.Quaternion().setFromRotationMatrix(basis).normalize();
  return new THREE.Matrix4().compose(
    position,
    rotation,
    new THREE.Vector3(scale, scale, scale),
  );
};

export const torus3DStoneMatrix = (size: TorusSize, pointId: PointId): THREE.Matrix4 => {
  const pitch = torus3DGridPitch(size);
  const radius = (pitch * SHARED_3D_STONE_DIAMETER_PITCH_RATIO) / 2;
  return torus3DSurfaceAlignedMatrix(
    size,
    pointId,
    pitch * SHARED_3D_STONE_LIFT_PITCH_RATIO + radius * 0.03,
    radius,
  );
};

export const torus3DMarkerMatrix = (size: TorusSize, pointId: PointId): THREE.Matrix4 => {
  const pitch = torus3DGridPitch(size);
  const radius = (pitch * SHARED_3D_MARKER_DIAMETER_PITCH_RATIO) / 2;
  return torus3DSurfaceAlignedMatrix(
    size,
    pointId,
    pitch * SHARED_3D_MARKER_LIFT_PITCH_RATIO,
    radius,
  );
};
