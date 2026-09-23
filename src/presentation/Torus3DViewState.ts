export interface Torus3DQuaternionState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Torus3DViewState {
  readonly rotation: Torus3DQuaternionState;
  readonly zoom: number;
}

export const TORUS_3D_ZOOM_MIN = 0.65;
export const TORUS_3D_ZOOM_MAX = 2.5;

const normalize = (rotation: Torus3DQuaternionState): Torus3DQuaternionState => {
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (!Number.isFinite(length) || length === 0) {
    throw new Error('Torus 3D rotation quaternion must be finite and non-zero');
  }
  return Object.freeze({
    x: rotation.x / length,
    y: rotation.y / length,
    z: rotation.z / length,
    w: rotation.w / length,
  });
};

export const createTorus3DViewState = (
  input: Partial<Torus3DViewState> = {},
): Torus3DViewState => {
  const rotation = normalize(
    input.rotation ?? { x: -0.23, y: 0.17, z: -0.04, w: 0.95 },
  );
  const requestedZoom = input.zoom ?? 1;
  if (!Number.isFinite(requestedZoom)) throw new Error('Torus 3D zoom must be finite');
  const zoom = Math.min(TORUS_3D_ZOOM_MAX, Math.max(TORUS_3D_ZOOM_MIN, requestedZoom));
  return Object.freeze({ rotation, zoom });
};
