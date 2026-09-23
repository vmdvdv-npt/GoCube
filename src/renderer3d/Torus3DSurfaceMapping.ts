import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';

export const TORUS_3D_OUTER_HALF_EXTENT = 1.55;
export const TORUS_3D_INNER_HALF_EXTENT = 0.75;
export const TORUS_3D_HALF_HEIGHT = 0.3;
export const TORUS_3D_BEVEL_SIZE = 0.045;

const CENTER_HALF_EXTENT = (TORUS_3D_OUTER_HALF_EXTENT + TORUS_3D_INNER_HALF_EXTENT) / 2;
const HALF_FRAME_WIDTH = (TORUS_3D_OUTER_HALF_EXTENT - TORUS_3D_INNER_HALF_EXTENT) / 2;

export interface Torus3DVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Torus3DSurfacePoint {
  readonly position: Torus3DVector;
  readonly normal: Torus3DVector;
  readonly tangent: Torus3DVector;
}

const wrapUnit = (value: number): number => ((value % 1) + 1) % 1;

const squarePerimeter = (
  halfExtent: number,
  u: number,
): Readonly<{
  position: Readonly<{ x: number; y: number }>;
  outward: Readonly<{ x: number; y: number }>;
  tangent: Readonly<{ x: number; y: number }>;
}> => {
  // Offset by half an edge segment so u=0 is on a flat major surface, not a corner.
  const perimeter = wrapUnit(u + 0.125) * 4;
  const edge = Math.min(3, Math.floor(perimeter));
  const t = perimeter - edge;

  switch (edge) {
    case 0:
      return Object.freeze({
        position: Object.freeze({ x: -halfExtent + 2 * halfExtent * t, y: halfExtent }),
        outward: Object.freeze({ x: 0, y: 1 }),
        tangent: Object.freeze({ x: 1, y: 0 }),
      });
    case 1:
      return Object.freeze({
        position: Object.freeze({ x: halfExtent, y: halfExtent - 2 * halfExtent * t }),
        outward: Object.freeze({ x: 1, y: 0 }),
        tangent: Object.freeze({ x: 0, y: -1 }),
      });
    case 2:
      return Object.freeze({
        position: Object.freeze({ x: halfExtent - 2 * halfExtent * t, y: -halfExtent }),
        outward: Object.freeze({ x: 0, y: -1 }),
        tangent: Object.freeze({ x: -1, y: 0 }),
      });
    default:
      return Object.freeze({
        position: Object.freeze({ x: -halfExtent, y: -halfExtent + 2 * halfExtent * t }),
        outward: Object.freeze({ x: -1, y: 0 }),
        tangent: Object.freeze({ x: 0, y: 1 }),
      });
  }
};

const rectangularCrossSection = (
  v: number,
): Readonly<{
  radial: number;
  z: number;
  normalRadial: number;
  normalZ: number;
}> => {
  // The same half-segment offset keeps supported odd board sizes away from bevel seams.
  const perimeter = wrapUnit(v + 0.125) * 4;
  const side = Math.min(3, Math.floor(perimeter));
  const t = perimeter - side;

  switch (side) {
    case 0:
      return Object.freeze({
        radial: -HALF_FRAME_WIDTH + 2 * HALF_FRAME_WIDTH * t,
        z: TORUS_3D_HALF_HEIGHT,
        normalRadial: 0,
        normalZ: 1,
      });
    case 1:
      return Object.freeze({
        radial: HALF_FRAME_WIDTH,
        z: TORUS_3D_HALF_HEIGHT - 2 * TORUS_3D_HALF_HEIGHT * t,
        normalRadial: 1,
        normalZ: 0,
      });
    case 2:
      return Object.freeze({
        radial: HALF_FRAME_WIDTH - 2 * HALF_FRAME_WIDTH * t,
        z: -TORUS_3D_HALF_HEIGHT,
        normalRadial: 0,
        normalZ: -1,
      });
    default:
      return Object.freeze({
        radial: -HALF_FRAME_WIDTH,
        z: -TORUS_3D_HALF_HEIGHT + 2 * TORUS_3D_HALF_HEIGHT * t,
        normalRadial: -1,
        normalZ: 0,
      });
  }
};

export const torus3DSurfaceFromUv = (u: number, v: number): Torus3DSurfacePoint => {
  const cross = rectangularCrossSection(v);
  const square = squarePerimeter(CENTER_HALF_EXTENT + cross.radial, u);
  const normal = Object.freeze({
    x: square.outward.x * cross.normalRadial,
    y: square.outward.y * cross.normalRadial,
    z: cross.normalZ,
  });

  return Object.freeze({
    position: Object.freeze({ x: square.position.x, y: square.position.y, z: cross.z }),
    normal,
    tangent: Object.freeze({ x: square.tangent.x, y: square.tangent.y, z: 0 }),
  });
};

const parsePointId = (size: TorusSize, pointId: PointId): Readonly<{ x: number; y: number }> => {
  const [xText, yText, extra] = pointId.split(',');
  const x = Number(xText);
  const y = Number(yText);
  if (
    extra !== undefined ||
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= size ||
    y >= size
  ) {
    throw new Error(`Unknown Torus ${size}x${size} PointId: ${pointId}`);
  }
  return Object.freeze({ x, y });
};

export const torus3DSurfacePoint = (size: TorusSize, pointId: PointId): Torus3DSurfacePoint => {
  const { x, y } = parsePointId(size, pointId);
  return torus3DSurfaceFromUv(x / size, y / size);
};

export const torus3DPointIdFromUv = (size: TorusSize, u: number, v: number): PointId => {
  const x = Math.round(wrapUnit(u) * size) % size;
  const y = Math.round(wrapUnit(v) * size) % size;
  return `${x},${y}`;
};

/** Prototype inverse mapping used by picking. It is renderer-neutral and deterministic. */
export const nearestTorus3DPointId = (
  size: TorusSize,
  position: Torus3DVector,
): PointId => {
  let bestPoint: PointId = '0,0';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const candidate = `${x},${y}`;
      const surface = torus3DSurfacePoint(size, candidate);
      const dx = surface.position.x - position.x;
      const dy = surface.position.y - position.y;
      const dz = surface.position.z - position.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPoint = candidate;
      }
    }
  }
  return bestPoint;
};
