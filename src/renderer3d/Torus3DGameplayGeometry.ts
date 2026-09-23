import * as THREE from 'three';
import type { PointId } from '../core/topology/Topology';
import { TorusTopology, type TorusSize } from '../core/topology/TorusTopology';
import {
  SHARED_3D_MARKER_DIAMETER_PITCH_RATIO,
  SHARED_3D_MARKER_LIFT_PITCH_RATIO,
  SHARED_3D_STONE_DIAMETER_PITCH_RATIO,
  SHARED_3D_STONE_LIFT_PITCH_RATIO,
} from './Shared3DGameplayVisuals';
import { torus3DSurfacePoint } from './Torus3DSurfaceMapping';

const pitchCache = new Map<TorusSize, number>();

const vector = (value: Readonly<{ x: number; y: number; z: number }>): THREE.Vector3 =>
  new THREE.Vector3(value.x, value.y, value.z);

export const torus3DGridPitch = (size: TorusSize): number => {
  const cached = pitchCache.get(size);
  if (cached !== undefined) return cached;
  let minimum = Number.POSITIVE_INFINITY;
  const topology = new TorusTopology(size);
  for (const pointId of topology.points()) {
    const [xText, yText] = pointId.split(',');
    const x = Number(xText);
    const y = Number(yText);
    const source = vector(torus3DSurfacePoint(size, pointId).position);
    for (const neighbor of [`${(x + 1) % size},${y}`, `${x},${(y + 1) % size}`]) {
      minimum = Math.min(
        minimum,
        source.distanceTo(vector(torus3DSurfacePoint(size, neighbor).position)),
      );
    }
  }
  if (!Number.isFinite(minimum) || minimum <= 0) {
    throw new Error(`Could not derive Torus 3D grid pitch for ${size}x${size}`);
  }
  pitchCache.set(size, minimum);
  return minimum;
};

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
