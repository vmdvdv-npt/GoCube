import { CUBE_FACES, type CubeFace } from '../../core/topology/CubeTopology';
import { CubeOrientation, type CubeOrientationState } from './CubeOrientation';
import {
  crossCubeAxisVectors,
  cubeFaceBasis,
  dotCubeAxisVectors,
  type CubeAxisVector,
} from './CubeSurfaceMapping';

export interface CubeQuaternionState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Cube3DViewState {
  readonly rotation: CubeQuaternionState;
  readonly zoom: number;
  readonly orientationAnchor: CubeOrientationState;
}

export const CUBE_3D_ZOOM_MIN = 0.65;
export const CUBE_3D_ZOOM_MAX = 2.5;

export const IDENTITY_CUBE_QUATERNION: CubeQuaternionState = Object.freeze({
  x: 0,
  y: 0,
  z: 0,
  w: 1,
});

const normalizeQuaternion = (rotation: CubeQuaternionState): CubeQuaternionState => {
  const { x, y, z, w } = rotation;
  if (![x, y, z, w].every(Number.isFinite)) {
    throw new Error('Cube 3D rotation quaternion must contain finite values');
  }
  const length = Math.hypot(x, y, z, w);
  if (length === 0) throw new Error('Cube 3D rotation quaternion cannot be zero-length');

  const sign = w < 0 ? -1 : 1;
  return Object.freeze({
    x: (x / length) * sign,
    y: (y / length) * sign,
    z: (z / length) * sign,
    w: (w / length) * sign,
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
): CubeQuaternionState => {
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

const rotateAxisByQuaternion = (
  [vx, vy, vz]: CubeAxisVector,
  rotation: CubeQuaternionState,
): readonly [number, number, number] => {
  const { x, y, z, w } = rotation;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return Object.freeze([
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ] as const);
};

/**
 * Converts the renderer-neutral discrete Cube orientation anchor into a plain numeric
 * object-rotation quaternion. No Three.js type participates in this spatial contract.
 */
export const cubeOrientationAnchorToQuaternion = (
  orientationAnchor: CubeOrientationState,
): CubeQuaternionState => {
  const orientation = new CubeOrientation(orientationAnchor);
  const center = cubeFaceBasis(orientation.centerFace).normal;
  const up = cubeFaceBasis(orientation.upFace).normal;
  const right = crossCubeAxisVectors(up, center);

  // The matrix rows are the local vectors that must become world +X/+Y/+Z.
  return quaternionFromRotationMatrix(
    right[0],
    right[1],
    right[2],
    up[0],
    up[1],
    up[2],
    center[0],
    center[1],
    center[2],
  );
};

const bestFaceByWorldComponent = (
  rotation: CubeQuaternionState,
  component: 0 | 1 | 2,
  candidates: readonly CubeFace[],
): CubeFace => {
  let bestFace = candidates[0];
  let bestValue = -Infinity;
  for (const face of candidates) {
    const transformedNormal = rotateAxisByQuaternion(cubeFaceBasis(face).normal, rotation);
    const value = transformedNormal[component];
    if (value > bestValue + 1e-12) {
      bestFace = face;
      bestValue = value;
    }
  }
  return bestFace;
};

/**
 * Quantizes an arbitrary renderer-neutral numeric quaternion to the nearest discrete
 * Cube orientation anchor: the face nearest world +Z is central and the adjacent face
 * nearest world +Y is up. Ties are deterministic in CUBE_FACES order.
 */
export const cubeQuaternionToOrientationAnchor = (
  inputRotation: CubeQuaternionState,
): CubeOrientationState => {
  const rotation = normalizeQuaternion(inputRotation);
  const centerFace = bestFaceByWorldComponent(rotation, 2, CUBE_FACES);
  const centerNormal = cubeFaceBasis(centerFace).normal;
  const adjacentFaces = CUBE_FACES.filter(
    (face) => dotCubeAxisVectors(centerNormal, cubeFaceBasis(face).normal) === 0,
  );
  const upFace = bestFaceByWorldComponent(rotation, 1, adjacentFaces);
  return Object.freeze({ centerFace, upFace });
};

const clampZoom = (zoom: number): number => {
  if (!Number.isFinite(zoom)) throw new Error(`Cube 3D zoom must be finite, got ${String(zoom)}`);
  return Math.min(CUBE_3D_ZOOM_MAX, Math.max(CUBE_3D_ZOOM_MIN, zoom));
};

export const createCube3DViewState = (
  state: Partial<Cube3DViewState> = {},
): Cube3DViewState => {
  const zoom = clampZoom(state.zoom ?? 1);
  if (state.rotation) {
    const rotation = normalizeQuaternion(state.rotation);
    return Object.freeze({
      rotation,
      zoom,
      orientationAnchor: cubeQuaternionToOrientationAnchor(rotation),
    });
  }

  const orientationAnchor = state.orientationAnchor ?? { centerFace: 'front', upFace: 'top' };
  new CubeOrientation(orientationAnchor);
  return Object.freeze({
    rotation: cubeOrientationAnchorToQuaternion(orientationAnchor),
    zoom,
    orientationAnchor: Object.freeze({ ...orientationAnchor }),
  });
};

export const withCube3DRotation = (
  state: Cube3DViewState,
  rotation: CubeQuaternionState,
): Cube3DViewState => createCube3DViewState({ rotation, zoom: state.zoom });

export const withCube3DZoom = (state: Cube3DViewState, zoom: number): Cube3DViewState =>
  createCube3DViewState({ rotation: state.rotation, zoom });

export const withCube3DOrientationAnchor = (
  state: Cube3DViewState,
  orientationAnchor: CubeOrientationState,
): Cube3DViewState => createCube3DViewState({ orientationAnchor, zoom: state.zoom });
