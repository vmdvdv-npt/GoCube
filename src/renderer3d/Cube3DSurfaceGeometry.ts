import * as THREE from 'three';
import {
  CubeTopology,
  cubeStepPoint,
  type CubeDirection,
  type CubeFace,
  type CubeSize,
} from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  cubeEdgeLocalCoordinates,
  cubeFaceBasis,
  cubePointToSurfaceLocation,
  cubeSurfaceCoordinateAcrossEdge,
  cubeSurfaceEdgeInset,
  type CubeVector3,
} from '../presentation/cube/CubeSurfaceMapping';

export interface Cube3DSurfaceProfile {
  readonly halfExtent: number;
  readonly roundingRadius: number;
}

export interface Cube3DSurfaceSample {
  readonly position: CubeVector3;
  readonly normal: CubeVector3;
}

export interface Cube3DGridPath {
  readonly fromPointId: PointId;
  readonly toPointId: PointId;
  readonly crossesFaceBoundary: boolean;
  readonly positions: readonly CubeVector3[];
}

/** 0.1 on a side length of 2 = 5% edge rounding. */
export const DEFAULT_CUBE_3D_SURFACE_PROFILE: Cube3DSurfaceProfile = Object.freeze({
  halfExtent: 1,
  roundingRadius: 0.1,
});

export const DEFAULT_CUBE_3D_SURFACE_SEGMENTS = 32;

const validateProfile = (profile: Cube3DSurfaceProfile): void => {
  if (!Number.isFinite(profile.halfExtent) || profile.halfExtent <= 0) {
    throw new Error(`Cube 3D half extent must be finite and > 0, got ${String(profile.halfExtent)}`);
  }
  if (
    !Number.isFinite(profile.roundingRadius) ||
    profile.roundingRadius < 0 ||
    profile.roundingRadius >= profile.halfExtent
  ) {
    throw new Error(
      `Cube 3D rounding radius must be finite and within [0, halfExtent), got ${String(profile.roundingRadius)}`,
    );
  }
};

const validateLocalCoordinate = (coordinate: number): void => {
  if (!Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1) {
    throw new Error(`Cube 3D face coordinate must be finite and within [0, 1], got ${String(coordinate)}`);
  }
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const freezeVector = (x: number, y: number, z: number): CubeVector3 =>
  Object.freeze([x, y, z] as const);

/** Arc length of one rounded face patch from one physical seam to the opposite seam. */
export const cube3DFaceSurfaceSpan = (
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): number => {
  validateProfile(profile);
  return (
    2 * (profile.halfExtent - profile.roundingRadius) +
    (Math.PI * profile.roundingRadius) / 2
  );
};

/**
 * Converts a normalized logical face coordinate to a sharp-cube source coordinate
 * whose rounded projection advances linearly by surface arc length. This prevents
 * the grid pitch from collapsing around rounded edges.
 */
export const cube3DFaceAxisSharpCoordinate = (
  coordinate: number,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): number => {
  validateProfile(profile);
  validateLocalCoordinate(coordinate);

  const { halfExtent, roundingRadius } = profile;
  if (roundingRadius === 0) return (coordinate * 2 - 1) * halfExtent;

  const coreHalfExtent = halfExtent - roundingRadius;
  const roundedHalfArc = (Math.PI * roundingRadius) / 4;
  const flatSpan = 2 * coreHalfExtent;
  const surfaceSpan = flatSpan + 2 * roundedHalfArc;
  const distance = coordinate * surfaceSpan;

  if (distance <= roundedHalfArc) {
    const angle = Math.PI / 4 - distance / roundingRadius;
    return -coreHalfExtent - roundingRadius * Math.tan(angle);
  }

  if (distance <= roundedHalfArc + flatSpan) {
    return -coreHalfExtent + (distance - roundedHalfArc);
  }

  const angle = (distance - roundedHalfArc - flatSpan) / roundingRadius;
  return coreHalfExtent + roundingRadius * Math.tan(angle);
};

const cube3DSharpPointForFaceLocal = (
  face: CubeFace,
  u: number,
  v: number,
  profile: Cube3DSurfaceProfile,
): CubeVector3 => {
  validateProfile(profile);
  const horizontal = cube3DFaceAxisSharpCoordinate(u, profile);
  const vertical = cube3DFaceAxisSharpCoordinate(v, profile);
  const { normal, right, down } = cubeFaceBasis(face);
  const halfExtent = profile.halfExtent;

  return freezeVector(
    normal[0] * halfExtent + right[0] * horizontal + down[0] * vertical,
    normal[1] * halfExtent + right[1] * horizontal + down[1] * vertical,
    normal[2] * halfExtent + right[2] * horizontal + down[2] * vertical,
  );
};

/** Projects canonical sharp-cube geometry onto one continuous rounded-box surface. */
export const projectSharpCubePointToRoundedSurface = (
  point: CubeVector3,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): CubeVector3 => {
  validateProfile(profile);
  if (profile.roundingRadius === 0) return freezeVector(point[0], point[1], point[2]);

  const coreHalfExtent = profile.halfExtent - profile.roundingRadius;
  const core = point.map((component) => clamp(component, -coreHalfExtent, coreHalfExtent));
  const delta = point.map((component, index) => component - core[index]);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length === 0) return freezeVector(point[0], point[1], point[2]);

  const scale = profile.roundingRadius / length;
  return freezeVector(
    core[0] + delta[0] * scale,
    core[1] + delta[1] * scale,
    core[2] + delta[2] * scale,
  );
};

const roundedSurfaceNormalFromSharpPoint = (
  point: CubeVector3,
  fallbackNormal: readonly number[],
  profile: Cube3DSurfaceProfile,
): CubeVector3 => {
  if (profile.roundingRadius === 0) {
    return freezeVector(fallbackNormal[0], fallbackNormal[1], fallbackNormal[2]);
  }

  const coreHalfExtent = profile.halfExtent - profile.roundingRadius;
  const core = point.map((component) => clamp(component, -coreHalfExtent, coreHalfExtent));
  const delta = point.map((component, index) => component - core[index]);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length === 0) {
    return freezeVector(fallbackNormal[0], fallbackNormal[1], fallbackNormal[2]);
  }

  return freezeVector(delta[0] / length, delta[1] / length, delta[2] / length);
};

/** Renderer-level face/local → rounded position + normal adapter. */
export const cube3DSurfaceSample = (
  face: CubeFace,
  u: number,
  v: number,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): Cube3DSurfaceSample => {
  const sharp = cube3DSharpPointForFaceLocal(face, u, v, profile);
  return Object.freeze({
    position: projectSharpCubePointToRoundedSurface(sharp, profile),
    normal: roundedSurfaceNormalFromSharpPoint(sharp, cubeFaceBasis(face).normal, profile),
  });
};

/** Stable logical point placement on the rounded surface; no new PointIds are created. */
export const cube3DPointSample = (
  size: CubeSize,
  pointId: PointId,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): Cube3DSurfaceSample => {
  const surface = cubePointToSurfaceLocation(size, pointId);
  return cube3DSurfaceSample(surface.face, surface.u, surface.v, profile);
};

export const cube3DPointPosition = (
  size: CubeSize,
  pointId: PointId,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): CubeVector3 => cube3DPointSample(size, pointId, profile).position;

export const cube3DPointNormal = (
  size: CubeSize,
  pointId: PointId,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): CubeVector3 => cube3DPointSample(size, pointId, profile).normal;

const squaredDistance = (a: CubeVector3, b: CubeVector3): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const interpolate = (a: CubeVector3, b: CubeVector3, amount: number): CubeVector3 =>
  freezeVector(
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  );

const projectedSegment = (
  from: CubeVector3,
  to: CubeVector3,
  profile: Cube3DSurfaceProfile,
  steps: number,
  includeStart: boolean,
): CubeVector3[] => {
  const result: CubeVector3[] = [];
  const first = includeStart ? 0 : 1;
  for (let index = first; index <= steps; index += 1) {
    result.push(projectSharpCubePointToRoundedSurface(interpolate(from, to, index / steps), profile));
  }
  return result;
};

/**
 * Builds one continuous grid connection between logical neighbours. Across a
 * physical edge the path uses the explicit renderer-neutral edge transform and
 * both face descriptions are required to resolve to the same seam point.
 */
export const cube3DGridPath = (
  size: CubeSize,
  pointId: PointId,
  direction: CubeDirection,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
  samplesPerSide = 4,
): Cube3DGridPath => {
  validateProfile(profile);
  if (!Number.isSafeInteger(samplesPerSide) || samplesPerSide < 1) {
    throw new Error(`Cube 3D grid samples per side must be an integer >= 1, got ${String(samplesPerSide)}`);
  }

  const nextPointId = cubeStepPoint(size, pointId, direction);
  const from = cubePointToSurfaceLocation(size, pointId);
  const to = cubePointToSurfaceLocation(size, nextPointId);
  const fromSharp = cube3DSharpPointForFaceLocal(from.face, from.u, from.v, profile);
  const toSharp = cube3DSharpPointForFaceLocal(to.face, to.u, to.v, profile);

  if (from.face === to.face) {
    return Object.freeze({
      fromPointId: pointId,
      toPointId: nextPointId,
      crossesFaceBoundary: false,
      positions: Object.freeze(projectedSegment(fromSharp, toSharp, profile, samplesPerSide, true)),
    });
  }

  const t = direction === 'top' || direction === 'bottom' ? from.u : from.v;
  const fromSeamLocal = cubeEdgeLocalCoordinates(direction, t);
  const targetSeamLocal = cubeSurfaceCoordinateAcrossEdge(from.face, direction, t);
  const expectedTarget = cubeSurfaceCoordinateAcrossEdge(
    from.face,
    direction,
    t,
    cubeSurfaceEdgeInset(size),
  );

  if (
    expectedTarget.face !== to.face ||
    Math.abs(expectedTarget.u - to.u) > 1e-12 ||
    Math.abs(expectedTarget.v - to.v) > 1e-12
  ) {
    throw new Error(`Cube surface mapping is inconsistent across ${pointId} → ${nextPointId}`);
  }

  const sourceSeamSharp = cube3DSharpPointForFaceLocal(
    from.face,
    fromSeamLocal.u,
    fromSeamLocal.v,
    profile,
  );
  const targetSeamSharp = cube3DSharpPointForFaceLocal(
    targetSeamLocal.face,
    targetSeamLocal.u,
    targetSeamLocal.v,
    profile,
  );
  if (squaredDistance(sourceSeamSharp, targetSeamSharp) > 1e-20) {
    throw new Error(`Cube surface seam is discontinuous across ${pointId} → ${nextPointId}`);
  }

  return Object.freeze({
    fromPointId: pointId,
    toPointId: nextPointId,
    crossesFaceBoundary: true,
    positions: Object.freeze([
      ...projectedSegment(fromSharp, sourceSeamSharp, profile, samplesPerSide, true),
      ...projectedSegment(targetSeamSharp, toSharp, profile, samplesPerSide, false),
    ]),
  });
};

export const cube3DGridPathLength = (path: Cube3DGridPath): number => {
  let length = 0;
  for (let index = 1; index < path.positions.length; index += 1) {
    const from = path.positions[index - 1];
    const to = path.positions[index];
    length += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  }
  return length;
};

/** Every logical adjacency exactly once, preventing debug-grid double lines. */
export const cube3DDebugGridPaths = (
  size: CubeSize,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
  samplesPerSide = 4,
): readonly Cube3DGridPath[] => {
  const topology = new CubeTopology(size);
  const seen = new Set<string>();
  const paths: Cube3DGridPath[] = [];
  const directions: readonly CubeDirection[] = ['top', 'right', 'bottom', 'left'];

  for (const point of topology.points()) {
    for (const direction of directions) {
      const next = cubeStepPoint(size, point, direction);
      const edgeKey = [point, next].sort().join('|');
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      paths.push(cube3DGridPath(size, point, direction, profile, samplesPerSide));
    }
  }

  return Object.freeze(paths);
};

/** One closed Three.js mesh geometry for the whole rounded Cube surface. */
export const createCube3DRoundedSurfaceGeometry = (
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
  segments = DEFAULT_CUBE_3D_SURFACE_SEGMENTS,
): THREE.BufferGeometry => {
  validateProfile(profile);
  if (!Number.isSafeInteger(segments) || segments < 1) {
    throw new Error(`Cube 3D surface segments must be an integer >= 1, got ${String(segments)}`);
  }

  const side = profile.halfExtent * 2;
  const geometry = new THREE.BoxGeometry(side, side, side, segments, segments, segments);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');

  for (let index = 0; index < positions.count; index += 1) {
    const sharp = freezeVector(positions.getX(index), positions.getY(index), positions.getZ(index));
    const fallbackNormal = freezeVector(normals.getX(index), normals.getY(index), normals.getZ(index));
    const rounded = projectSharpCubePointToRoundedSurface(sharp, profile);
    const normal = roundedSurfaceNormalFromSharpPoint(sharp, fallbackNormal, profile);
    positions.setXYZ(index, rounded[0], rounded[1], rounded[2]);
    normals.setXYZ(index, normal[0], normal[1], normal[2]);
  }

  positions.needsUpdate = true;
  normals.needsUpdate = true;
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

export const createCube3DDebugGridGeometry = (
  size: CubeSize,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
  samplesPerSide = 4,
): THREE.BufferGeometry => {
  const vertices: number[] = [];
  for (const path of cube3DDebugGridPaths(size, profile, samplesPerSide)) {
    for (let index = 1; index < path.positions.length; index += 1) {
      const from = path.positions[index - 1];
      const to = path.positions[index];
      vertices.push(from[0], from[1], from[2], to[0], to[1], to[2]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
};

export const createCube3DDebugPointGeometry = (
  size: CubeSize,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): THREE.BufferGeometry => {
  const vertices: number[] = [];
  for (const pointId of new CubeTopology(size).points()) {
    const position = cube3DPointPosition(size, pointId, profile);
    vertices.push(position[0], position[1], position[2]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return geometry;
};
