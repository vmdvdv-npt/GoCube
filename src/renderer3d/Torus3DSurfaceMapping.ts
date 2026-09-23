import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';

export const TORUS_3D_OUTER_HALF_EXTENT = 1.55;
export const TORUS_3D_INNER_HALF_EXTENT = 0.75;
export const TORUS_3D_HALF_HEIGHT = 0.3;
export const TORUS_3D_BEVEL_SIZE = 0.045;

const CENTER_HALF_EXTENT = (TORUS_3D_OUTER_HALF_EXTENT + TORUS_3D_INNER_HALF_EXTENT) / 2;
const HALF_FRAME_WIDTH = (TORUS_3D_OUTER_HALF_EXTENT - TORUS_3D_INNER_HALF_EXTENT) / 2;
const BEVEL_PHASE = 0.02;

export interface Torus3DVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Torus3DSurfacePoint {
  readonly position: Torus3DVector;
  readonly normal: Torus3DVector;
  /** Tangent of the first toroidal direction. */
  readonly tangent: Torus3DVector;
}

const freezeVector = (x: number, y: number, z: number): Torus3DVector =>
  Object.freeze({ x, y, z });

const wrapUnit = (value: number): number => ((value % 1) + 1) % 1;
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const squarePerimeter = (
  halfExtent: number,
  u: number,
): Readonly<{
  position: Readonly<{ x: number; y: number }>;
  outward: Readonly<{ x: number; y: number }>;
  tangent: Readonly<{ x: number; y: number }>;
}> => {
  // Half an edge offset keeps supported odd sizes away from the four sharp XY corners.
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

interface CrossSectionSample {
  readonly radial: number;
  readonly z: number;
  readonly normalRadial: number;
  readonly normalZ: number;
}

/**
 * One periodic rounded rectangle in radial/z space. Each quarter is mostly a
 * playable flat surface and spends only its last narrow phase on the bevel.
 * The supported odd board sizes therefore keep every logical intersection on
 * a flat top/bottom/outer/inner surface while arbitrary samples follow bevels.
 */
const roundedCrossSection = (v: number): CrossSectionSample => {
  const perimeter = wrapUnit(v + 0.125) * 4;
  const side = Math.min(3, Math.floor(perimeter));
  const t = perimeter - side;
  const flatEnd = 1 - BEVEL_PHASE;
  const flatT = Math.min(t, flatEnd) / flatEnd;
  const radius = TORUS_3D_BEVEL_SIZE;
  const width = HALF_FRAME_WIDTH;
  const height = TORUS_3D_HALF_HEIGHT;

  if (side === 0) {
    if (t < flatEnd) {
      return Object.freeze({
        radial: lerp(-width + radius, width - radius, flatT),
        z: height,
        normalRadial: 0,
        normalZ: 1,
      });
    }
    const q = (t - flatEnd) / BEVEL_PHASE;
    const angle = (Math.PI / 2) * (1 - q);
    return Object.freeze({
      radial: width - radius + radius * Math.cos(angle),
      z: height - radius + radius * Math.sin(angle),
      normalRadial: Math.cos(angle),
      normalZ: Math.sin(angle),
    });
  }

  if (side === 1) {
    if (t < flatEnd) {
      return Object.freeze({
        radial: width,
        z: lerp(height - radius, -height + radius, flatT),
        normalRadial: 1,
        normalZ: 0,
      });
    }
    const q = (t - flatEnd) / BEVEL_PHASE;
    const angle = -(Math.PI / 2) * q;
    return Object.freeze({
      radial: width - radius + radius * Math.cos(angle),
      z: -height + radius + radius * Math.sin(angle),
      normalRadial: Math.cos(angle),
      normalZ: Math.sin(angle),
    });
  }

  if (side === 2) {
    if (t < flatEnd) {
      return Object.freeze({
        radial: lerp(width - radius, -width + radius, flatT),
        z: -height,
        normalRadial: 0,
        normalZ: -1,
      });
    }
    const q = (t - flatEnd) / BEVEL_PHASE;
    const angle = -Math.PI / 2 - (Math.PI / 2) * q;
    return Object.freeze({
      radial: -width + radius + radius * Math.cos(angle),
      z: -height + radius + radius * Math.sin(angle),
      normalRadial: Math.cos(angle),
      normalZ: Math.sin(angle),
    });
  }

  if (t < flatEnd) {
    return Object.freeze({
      radial: -width,
      z: lerp(-height + radius, height - radius, flatT),
      normalRadial: -1,
      normalZ: 0,
    });
  }
  const q = (t - flatEnd) / BEVEL_PHASE;
  const angle = Math.PI - (Math.PI / 2) * q;
  return Object.freeze({
    radial: -width + radius + radius * Math.cos(angle),
    z: height - radius + radius * Math.sin(angle),
    normalRadial: Math.cos(angle),
    normalZ: Math.sin(angle),
  });
};

export const torus3DSurfaceFromUv = (u: number, v: number): Torus3DSurfacePoint => {
  const cross = roundedCrossSection(v);
  const square = squarePerimeter(CENTER_HALF_EXTENT + cross.radial, u);
  return Object.freeze({
    position: freezeVector(square.position.x, square.position.y, cross.z),
    normal: freezeVector(
      square.outward.x * cross.normalRadial,
      square.outward.y * cross.normalRadial,
      cross.normalZ,
    ),
    tangent: freezeVector(square.tangent.x, square.tangent.y, 0),
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

export const torus3DPointCoordinates = (
  size: TorusSize,
  pointId: PointId,
): Readonly<{ x: number; y: number }> => parsePointId(size, pointId);

export const torus3DSurfacePoint = (size: TorusSize, pointId: PointId): Torus3DSurfacePoint => {
  const { x, y } = parsePointId(size, pointId);
  return torus3DSurfaceFromUv(x / size, y / size);
};

export const torus3DPointIdFromUv = (size: TorusSize, u: number, v: number): PointId => {
  const x = Math.round(wrapUnit(u) * size) % size;
  const y = Math.round(wrapUnit(v) * size) % size;
  return `${x},${y}`;
};
