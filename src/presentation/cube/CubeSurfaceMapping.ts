import {
  CUBE_FACES,
  cubePointId,
  isValidCubeSize,
  parseCubePointId,
  type CubeFace,
  type CubeSize,
} from '../../core/topology/CubeTopology';
import type { PointId } from '../../core/topology/Topology';

export type CubeAxisComponent = -1 | 0 | 1;
export type CubeAxisVector = readonly [CubeAxisComponent, CubeAxisComponent, CubeAxisComponent];
export type CubeVector3 = readonly [number, number, number];

export interface CubeFaceBasis {
  readonly normal: CubeAxisVector;
  /** Increasing face-local column / u. */
  readonly right: CubeAxisVector;
  /** Increasing face-local row / v. */
  readonly down: CubeAxisVector;
}

export interface CubeSurfaceLocation {
  readonly pointId: PointId;
  readonly face: CubeFace;
  readonly row: number;
  readonly column: number;
  /** Cell-centred normalized face coordinate in (0, 1). */
  readonly u: number;
  /** Cell-centred normalized face coordinate in (0, 1). */
  readonly v: number;
  readonly basis: CubeFaceBasis;
}

const axis = (x: CubeAxisComponent, y: CubeAxisComponent, z: CubeAxisComponent): CubeAxisVector =>
  Object.freeze([x, y, z] as const);

/**
 * Canonical renderer-neutral basis for every physical face.
 * `right` follows increasing columns and `down` follows increasing rows.
 */
export const CUBE_FACE_BASES: Readonly<Record<CubeFace, CubeFaceBasis>> = Object.freeze({
  front: Object.freeze({ normal: axis(0, 0, 1), right: axis(1, 0, 0), down: axis(0, -1, 0) }),
  back: Object.freeze({ normal: axis(0, 0, -1), right: axis(-1, 0, 0), down: axis(0, -1, 0) }),
  left: Object.freeze({ normal: axis(-1, 0, 0), right: axis(0, 0, 1), down: axis(0, -1, 0) }),
  right: Object.freeze({ normal: axis(1, 0, 0), right: axis(0, 0, -1), down: axis(0, -1, 0) }),
  top: Object.freeze({ normal: axis(0, 1, 0), right: axis(1, 0, 0), down: axis(0, 0, 1) }),
  bottom: Object.freeze({ normal: axis(0, -1, 0), right: axis(1, 0, 0), down: axis(0, 0, -1) }),
});

export const cubeFaceBasis = (face: CubeFace): CubeFaceBasis => CUBE_FACE_BASES[face];

export const negateCubeAxisVector = ([x, y, z]: CubeAxisVector): CubeAxisVector =>
  axis(-x as CubeAxisComponent, -y as CubeAxisComponent, -z as CubeAxisComponent);

export const dotCubeAxisVectors = (
  [ax, ay, az]: CubeAxisVector,
  [bx, by, bz]: CubeAxisVector,
): number => ax * bx + ay * by + az * bz;

export const crossCubeAxisVectors = (
  [ax, ay, az]: CubeAxisVector,
  [bx, by, bz]: CubeAxisVector,
): CubeAxisVector =>
  axis(
    (ay * bz - az * by) as CubeAxisComponent,
    (az * bx - ax * bz) as CubeAxisComponent,
    (ax * by - ay * bx) as CubeAxisComponent,
  );

export const cubeFaceFromNormal = (normal: CubeAxisVector): CubeFace => {
  for (const face of CUBE_FACES) {
    const candidate = CUBE_FACE_BASES[face].normal;
    if (candidate[0] === normal[0] && candidate[1] === normal[1] && candidate[2] === normal[2]) {
      return face;
    }
  }

  throw new Error(`Invalid cube face normal: ${normal.join(',')}`);
};

export const oppositeCubeFace = (face: CubeFace): CubeFace =>
  cubeFaceFromNormal(negateCubeAxisVector(cubeFaceBasis(face).normal));

/** Half a grid step. No logical point is located directly on a physical face seam. */
export const cubeSurfaceEdgeInset = (size: CubeSize): number => {
  if (!isValidCubeSize(size)) {
    throw new Error(`Cube size must be a safe integer >= 2, got ${String(size)}`);
  }
  return 0.5 / size;
};

const normalizedGridCoordinate = (index: number, size: CubeSize): number => (index + 0.5) / size;

const gridIndexFromCoordinate = (coordinate: number, size: CubeSize, name: 'u' | 'v'): number => {
  if (!Number.isFinite(coordinate)) throw new Error(`Cube surface ${name} must be finite`);
  const raw = coordinate * size - 0.5;
  const index = Math.round(raw);
  if (index < 0 || index >= size || Math.abs(raw - index) > 1e-9) {
    throw new Error(`Cube surface ${name}=${coordinate} is not a grid intersection for size ${size}`);
  }
  return index;
};

/** Headless canonical PointId → face/local-coordinate/basis mapping. */
export const cubePointToSurfaceLocation = (
  size: CubeSize,
  pointId: PointId,
): CubeSurfaceLocation => {
  const { face, row, column } = parseCubePointId(size, pointId);
  return Object.freeze({
    pointId,
    face,
    row,
    column,
    u: normalizedGridCoordinate(column, size),
    v: normalizedGridCoordinate(row, size),
    basis: cubeFaceBasis(face),
  });
};

/** Exact inverse for canonical cell-centred face-local grid coordinates. */
export const cubeSurfaceLocationToPoint = (
  size: CubeSize,
  face: CubeFace,
  u: number,
  v: number,
): PointId => {
  if (!isValidCubeSize(size)) {
    throw new Error(`Cube size must be a safe integer >= 2, got ${String(size)}`);
  }
  return cubePointId(face, gridIndexFromCoordinate(v, size, 'v'), gridIndexFromCoordinate(u, size, 'u'));
};

const validateLocalCoordinate = (value: number, name: 'u' | 'v'): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Cube face ${name} must be finite and within [0, 1], got ${String(value)}`);
  }
};

/**
 * Continuous canonical embedding of one face into a sharp cube.
 * This is renderer-neutral reference geometry; Renderer3D may project it onto a rounded surface.
 */
export const cubeFaceLocalToCartesian = (
  face: CubeFace,
  u: number,
  v: number,
  halfExtent = 1,
): CubeVector3 => {
  validateLocalCoordinate(u, 'u');
  validateLocalCoordinate(v, 'v');
  if (!Number.isFinite(halfExtent) || halfExtent <= 0) {
    throw new Error(`Cube half extent must be finite and > 0, got ${String(halfExtent)}`);
  }

  const { normal, right, down } = cubeFaceBasis(face);
  const horizontal = (u * 2 - 1) * halfExtent;
  const vertical = (v * 2 - 1) * halfExtent;
  return Object.freeze([
    normal[0] * halfExtent + right[0] * horizontal + down[0] * vertical,
    normal[1] * halfExtent + right[1] * horizontal + down[1] * vertical,
    normal[2] * halfExtent + right[2] * horizontal + down[2] * vertical,
  ] as const);
};
