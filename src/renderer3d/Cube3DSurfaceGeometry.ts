import {
  cubeStepPoint,
  type CubeDirection,
  type CubeSize,
} from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  cubeFaceLocalToCartesian,
  cubePointToSurfaceLocation,
  type CubeVector3,
} from '../presentation/cube/CubeSurfaceMapping';

export interface Cube3DSurfaceProfile {
  readonly halfExtent: number;
  readonly roundingRadius: number;
}

export interface Cube3DGridPath {
  readonly fromPointId: PointId;
  readonly toPointId: PointId;
  readonly crossesFaceBoundary: boolean;
  readonly positions: readonly CubeVector3[];
}

export const DEFAULT_CUBE_3D_SURFACE_PROFILE: Cube3DSurfaceProfile = Object.freeze({
  halfExtent: 1,
  roundingRadius: 0.14,
});

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

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Projects the canonical sharp-cube surface onto a rounded-box surface. */
export const projectSharpCubePointToRoundedSurface = (
  point: CubeVector3,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): CubeVector3 => {
  validateProfile(profile);
  if (profile.roundingRadius === 0) return Object.freeze([...point] as CubeVector3);

  const coreHalfExtent = profile.halfExtent - profile.roundingRadius;
  const core = point.map((component) => clamp(component, -coreHalfExtent, coreHalfExtent));
  const delta = point.map((component, index) => component - core[index]);
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  if (length === 0) return Object.freeze([...point] as CubeVector3);

  const scale = profile.roundingRadius / length;
  return Object.freeze([
    core[0] + delta[0] * scale,
    core[1] + delta[1] * scale,
    core[2] + delta[2] * scale,
  ] as const);
};

const sharpPointPosition = (
  size: CubeSize,
  pointId: PointId,
  halfExtent: number,
): CubeVector3 => {
  const surface = cubePointToSurfaceLocation(size, pointId);
  return cubeFaceLocalToCartesian(surface.face, surface.u, surface.v, halfExtent);
};

/** Stable logical point placement; edge points remain distinct because face coordinates are cell-centred. */
export const cube3DPointPosition = (
  size: CubeSize,
  pointId: PointId,
  profile: Cube3DSurfaceProfile = DEFAULT_CUBE_3D_SURFACE_PROFILE,
): CubeVector3 => {
  validateProfile(profile);
  return projectSharpCubePointToRoundedSurface(
    sharpPointPosition(size, pointId, profile.halfExtent),
    profile,
  );
};

const squaredDistance = (a: CubeVector3, b: CubeVector3): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const interpolate = (a: CubeVector3, b: CubeVector3, amount: number): CubeVector3 =>
  Object.freeze([
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ] as const);

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

const seamLocalForDirection = (
  direction: CubeDirection,
  u: number,
  v: number,
): Readonly<{ u: number; v: number }> => {
  switch (direction) {
    case 'top':
      return Object.freeze({ u, v: 0 });
    case 'right':
      return Object.freeze({ u: 1, v });
    case 'bottom':
      return Object.freeze({ u, v: 1 });
    case 'left':
      return Object.freeze({ u: 0, v });
  }
};

/**
 * Builds one continuous grid connection between logical neighbours.
 * Across a face boundary it explicitly passes through the shared seam and is then
 * projected onto the rounded surface, so distinct PointIds never collapse onto the seam.
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
  const fromSharp = sharpPointPosition(size, pointId, profile.halfExtent);
  const toSharp = sharpPointPosition(size, nextPointId, profile.halfExtent);

  if (from.face === to.face) {
    return Object.freeze({
      fromPointId: pointId,
      toPointId: nextPointId,
      crossesFaceBoundary: false,
      positions: Object.freeze(projectedSegment(fromSharp, toSharp, profile, samplesPerSide, true)),
    });
  }

  const fromSeamLocal = seamLocalForDirection(direction, from.u, from.v);
  const seamSharp = cubeFaceLocalToCartesian(
    from.face,
    fromSeamLocal.u,
    fromSeamLocal.v,
    profile.halfExtent,
  );
  const targetCandidates = [
    cubeFaceLocalToCartesian(to.face, 0, to.v, profile.halfExtent),
    cubeFaceLocalToCartesian(to.face, 1, to.v, profile.halfExtent),
    cubeFaceLocalToCartesian(to.face, to.u, 0, profile.halfExtent),
    cubeFaceLocalToCartesian(to.face, to.u, 1, profile.halfExtent),
  ];
  const targetSeam = targetCandidates.reduce((closest, candidate) =>
    squaredDistance(candidate, seamSharp) < squaredDistance(closest, seamSharp) ? candidate : closest,
  );
  if (squaredDistance(targetSeam, seamSharp) > 1e-12) {
    throw new Error(`Cube surface mapping is inconsistent across ${pointId} → ${nextPointId}`);
  }

  return Object.freeze({
    fromPointId: pointId,
    toPointId: nextPointId,
    crossesFaceBoundary: true,
    positions: Object.freeze([
      ...projectedSegment(fromSharp, seamSharp, profile, samplesPerSide, true),
      ...projectedSegment(seamSharp, toSharp, profile, samplesPerSide, false),
    ]),
  });
};
