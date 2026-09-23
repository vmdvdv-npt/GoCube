import type { TorusSize } from '../core/topology/TorusTopology';
import {
  createTorusSpatialAnchor,
  moveTorusSpatialAnchor,
  torusSpatialAnchorPointId,
  type TorusSpatialAnchor,
  type TorusSpatialDirection,
} from '../presentation/TorusSpatialAnchor';
import {
  createTorus3DViewState,
  type Torus3DQuaternionState,
  type Torus3DViewState,
} from '../presentation/Torus3DViewState';
import {
  torus3DSurfacePoint,
  type Torus3DVector,
} from './Torus3DSurfaceMapping';

export type Torus3DNavigationDirection = TorusSpatialDirection;

export const TORUS_3D_STANDARD_ZOOM = 1;

const normalizeVector = (vector: Torus3DVector): Torus3DVector => {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new Error('Torus 3D navigation vector became degenerate');
  }
  return Object.freeze({
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  });
};

const dot = (left: Torus3DVector, right: Torus3DVector): number =>
  left.x * right.x + left.y * right.y + left.z * right.z;

const cross = (left: Torus3DVector, right: Torus3DVector): Torus3DVector =>
  Object.freeze({
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  });

const subtractScaled = (
  vector: Torus3DVector,
  axis: Torus3DVector,
  scale: number,
): Torus3DVector =>
  Object.freeze({
    x: vector.x - axis.x * scale,
    y: vector.y - axis.y * scale,
    z: vector.z - axis.z * scale,
  });

const normalizeQuaternion = (rotation: Torus3DQuaternionState): Torus3DQuaternionState => {
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new Error('Torus 3D navigation quaternion became degenerate');
  }
  const sign = rotation.w < 0 ? -1 : 1;
  return Object.freeze({
    x: (rotation.x / length) * sign,
    y: (rotation.y / length) * sign,
    z: (rotation.z / length) * sign,
    w: (rotation.w / length) * sign,
  });
};

const quaternionFromRotationMatrix = (
  m00: number,
  m01: number,
  m02: number,
  m10: number,
  m11: number,
  m12: number,
  m20: number,
  m21: number,
  m22: number,
): Torus3DQuaternionState => {
  const trace = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;

  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    w = 0.25 * scale;
    x = (m21 - m12) / scale;
    y = (m02 - m20) / scale;
    z = (m10 - m01) / scale;
  } else if (m00 > m11 && m00 > m22) {
    const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / scale;
    x = 0.25 * scale;
    y = (m01 + m10) / scale;
    z = (m02 + m20) / scale;
  } else if (m11 > m22) {
    const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / scale;
    x = (m01 + m10) / scale;
    y = 0.25 * scale;
    z = (m12 + m21) / scale;
  } else {
    const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / scale;
    x = (m02 + m20) / scale;
    y = (m12 + m21) / scale;
    z = 0.25 * scale;
  }

  return normalizeQuaternion({ x, y, z, w });
};

const rotateVector = (
  vector: Torus3DVector,
  rotation: Torus3DQuaternionState,
): Torus3DVector => {
  const { x, y, z, w } = normalizeQuaternion(rotation);
  const tx = 2 * (y * vector.z - z * vector.y);
  const ty = 2 * (z * vector.x - x * vector.z);
  const tz = 2 * (x * vector.y - y * vector.x);
  return Object.freeze({
    x: vector.x + w * tx + (y * tz - z * ty),
    y: vector.y + w * ty + (z * tx - x * tz),
    z: vector.z + w * tz + (x * ty - y * tx),
  });
};

/**
 * A logical anchor is not a renderer coordinate. This local view direction only
 * converts that logical anchor into the orientation needed by the Torus renderer.
 * A small position contribution makes neighboring points on one flat surface
 * produce distinct canonical rotations while the surface normal remains dominant.
 */
const anchorFrame = (
  size: TorusSize,
  anchor: TorusSpatialAnchor,
): Readonly<{
  front: Torus3DVector;
  right: Torus3DVector;
  up: Torus3DVector;
  position: Torus3DVector;
}> => {
  const surface = torus3DSurfacePoint(size, torusSpatialAnchorPointId(anchor));
  const positionDirection = normalizeVector(surface.position);
  const front = normalizeVector({
    x: surface.normal.x * 0.84 + positionDirection.x * 0.16,
    y: surface.normal.y * 0.84 + positionDirection.y * 0.16,
    z: surface.normal.z * 0.84 + positionDirection.z * 0.16,
  });
  const tangent = normalizeVector(surface.tangent);
  const right = normalizeVector(subtractScaled(tangent, front, dot(tangent, front)));
  const up = normalizeVector(cross(front, right));
  return Object.freeze({ front, right, up, position: surface.position });
};

/** Stable canonical pose for one logical Torus region. */
export const torus3DCanonicalRotationForAnchor = (
  size: TorusSize,
  anchor: TorusSpatialAnchor,
): Torus3DQuaternionState => {
  const normalized = createTorusSpatialAnchor(size, anchor.row, anchor.column);
  const frame = anchorFrame(size, normalized);
  // Matrix rows map the local right/up/front frame to world +X/+Y/+Z.
  return quaternionFromRotationMatrix(
    frame.right.x,
    frame.right.y,
    frame.right.z,
    frame.up.x,
    frame.up.y,
    frame.up.z,
    frame.front.x,
    frame.front.y,
    frame.front.z,
  );
};

/**
 * Quantize an arbitrary free rotation to the logical region currently facing the
 * camera. The canonical anchor view direction is the primary metric; projected
 * position is only a deterministic tie-breaker on symmetric samples.
 */
export const torus3DFrontFacingAnchor = (
  size: TorusSize,
  rotation: Torus3DQuaternionState,
): TorusSpatialAnchor => {
  let best = createTorusSpatialAnchor(size, 0, 0);
  let bestFacing = -Infinity;
  let bestScreenDistance = Infinity;
  let bestDepth = -Infinity;

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const candidate = createTorusSpatialAnchor(size, row, column);
      const frame = anchorFrame(size, candidate);
      const worldFront = rotateVector(frame.front, rotation);
      const worldPosition = rotateVector(frame.position, rotation);
      const facing = worldFront.z;
      const screenDistance = worldPosition.x ** 2 + worldPosition.y ** 2;
      const depth = worldPosition.z;

      const betterFacing = facing > bestFacing + 1e-10;
      const tiedFacing = Math.abs(facing - bestFacing) <= 1e-10;
      const betterScreen = screenDistance < bestScreenDistance - 1e-10;
      const tiedScreen = Math.abs(screenDistance - bestScreenDistance) <= 1e-10;
      if (
        betterFacing ||
        (tiedFacing && betterScreen) ||
        (tiedFacing && tiedScreen && depth > bestDepth + 1e-10)
      ) {
        best = candidate;
        bestFacing = facing;
        bestScreenDistance = screenDistance;
        bestDepth = depth;
      }
    }
  }

  return best;
};

export const torus3DViewTargetForAnchor = (
  size: TorusSize,
  state: Torus3DViewState,
  anchor: TorusSpatialAnchor,
): Torus3DViewState =>
  createTorus3DViewState({
    rotation: torus3DCanonicalRotationForAnchor(size, anchor),
    zoom: state.zoom,
  });

export const torus3DNavigationTarget = (
  size: TorusSize,
  state: Torus3DViewState,
  direction: Torus3DNavigationDirection,
): Torus3DViewState => {
  const currentAnchor = torus3DFrontFacingAnchor(size, state.rotation);
  const targetAnchor = moveTorusSpatialAnchor(size, currentAnchor, direction);
  return torus3DViewTargetForAnchor(size, state, targetAnchor);
};

export const torus3DResetTarget = (): Torus3DViewState =>
  createTorus3DViewState({ zoom: TORUS_3D_STANDARD_ZOOM });

export const torus3DStandardAnchor = (size: TorusSize): TorusSpatialAnchor =>
  torus3DFrontFacingAnchor(size, torus3DResetTarget().rotation);
