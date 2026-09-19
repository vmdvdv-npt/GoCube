import { CubeOrientation, type CubeOrientationState } from './CubeOrientation';

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
  return Object.freeze({ x: x / length, y: y / length, z: z / length, w: w / length });
};

const clampZoom = (zoom: number): number => {
  if (!Number.isFinite(zoom)) throw new Error(`Cube 3D zoom must be finite, got ${String(zoom)}`);
  return Math.min(CUBE_3D_ZOOM_MAX, Math.max(CUBE_3D_ZOOM_MIN, zoom));
};

export const createCube3DViewState = (
  state: Partial<Cube3DViewState> = {},
): Cube3DViewState => {
  const orientationAnchor = state.orientationAnchor ?? { centerFace: 'front', upFace: 'top' };
  new CubeOrientation(orientationAnchor);
  return Object.freeze({
    rotation: normalizeQuaternion(state.rotation ?? IDENTITY_CUBE_QUATERNION),
    zoom: clampZoom(state.zoom ?? 1),
    orientationAnchor: Object.freeze({ ...orientationAnchor }),
  });
};

export const withCube3DRotation = (
  state: Cube3DViewState,
  rotation: CubeQuaternionState,
): Cube3DViewState => createCube3DViewState({ ...state, rotation });

export const withCube3DZoom = (state: Cube3DViewState, zoom: number): Cube3DViewState =>
  createCube3DViewState({ ...state, zoom });

export const withCube3DOrientationAnchor = (
  state: Cube3DViewState,
  orientationAnchor: CubeOrientationState,
): Cube3DViewState => createCube3DViewState({ ...state, orientationAnchor });
