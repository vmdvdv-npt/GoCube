import type { PointId } from '../core/topology/Topology';
import type { TorusSize } from '../core/topology/TorusTopology';

export const TORUS_3D_OUTER_HALF_EXTENT = 1.55;
export const TORUS_3D_INNER_HALF_EXTENT = 0.75;
export const TORUS_3D_HALF_HEIGHT = 0.3;
export const TORUS_3D_BEVEL_SIZE = 0.045;

const CENTER_HALF_EXTENT = (TORUS_3D_OUTER_HALF_EXTENT + TORUS_3D_INNER_HALF_EXTENT) / 2;
const HALF_FRAME_WIDTH = (TORUS_3D_OUTER_HALF_EXTENT - TORUS_3D_INNER_HALF_EXTENT) / 2;
const BEVEL_PHASE = 0.02;
// The wood keeps its existing narrow XY corner. Grid-only top/bottom paths may
// use a larger radius while staying on the planar wood surface.
const XY_CORNER_PHASE = 0.02;
const GRID_EDGE_MARGIN_STEPS = 1.1;
const GRID_INNER_MARGIN_STEPS = 1.5;
const GRID_MIN_TRANSITION_RADIUS_MULTIPLIER = 3.5;
const GRID_TRANSITION_RADIUS_STEP_RATIO = 1.1;
const GRID_MAX_TRANSITION_RADIUS_RATIO = 0.45;
const LOGICAL_SNAP_EPSILON = 1e-9;

const CROSS_SECTION_INTERVALS: Readonly<
  Record<TorusSize, readonly [number, number, number, number]>
> = Object.freeze({
  9: Object.freeze([3, 2, 3, 1]),
  13: Object.freeze([4, 3, 4, 2]),
  19: Object.freeze([6, 5, 6, 2]),
});

export type Torus3DSurfaceRegion = 'top' | 'outer' | 'bottom' | 'inner';

export interface Torus3DGridRegionLayout {
  readonly region: Torus3DSurfaceRegion;
  readonly intervals: number;
  readonly flatLength: number;
  readonly margin: number;
}

export interface Torus3DGridLayout {
  readonly size: TorusSize;
  readonly topIntervals: number;
  readonly outerIntervals: number;
  readonly bottomIntervals: number;
  readonly innerIntervals: number;
  /** Common physical pitch used by the flat gameplay areas in both toroidal directions. */
  readonly gridStep: number;
  /** Smallest ordinary flat-surface margin. */
  readonly outerMargin: number;
  /** Dedicated enlarged margin on the inner wall. */
  readonly innerMargin: number;
  /** Grid-only XY transition radius. The wooden mesh keeps TORUS_3D_BEVEL_SIZE. */
  readonly transitionRadius: number;
  /** Balanced distribution of the first toroidal cycle over the four XY sides. */
  readonly perimeterIntervals: readonly [number, number, number, number];
  readonly regions: readonly Torus3DGridRegionLayout[];
}

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

const layoutCache = new Map<TorusSize, Torus3DGridLayout>();
const crossSectionPhaseCache = new Map<TorusSize, readonly number[]>();

const crossSectionFlatLength = (regionIndex: number): number =>
  regionIndex === 0 || regionIndex === 2
    ? 2 * (HALF_FRAME_WIDTH - TORUS_3D_BEVEL_SIZE)
    : 2 * (TORUS_3D_HALF_HEIGHT - TORUS_3D_BEVEL_SIZE);

const balancedPerimeterIntervals = (
  size: TorusSize,
): readonly [number, number, number, number] => {
  const base = Math.floor(size / 4);
  const remainder = size % 4;
  return Object.freeze([
    base + (remainder > 0 ? 1 : 0),
    base + (remainder > 1 ? 1 : 0),
    base + (remainder > 2 ? 1 : 0),
    base,
  ]);
};

export const createTorus3DGridLayout = (size: TorusSize): Torus3DGridLayout => {
  const cached = layoutCache.get(size);
  if (cached) return cached;

  const [topIntervals, outerIntervals, bottomIntervals, innerIntervals] =
    CROSS_SECTION_INTERVALS[size];
  const intervalCounts = [topIntervals, outerIntervals, bottomIntervals, innerIntervals] as const;
  const maximumSteps = intervalCounts.map((intervals, regionIndex) => {
    const marginSteps = regionIndex === 3 ? GRID_INNER_MARGIN_STEPS : GRID_EDGE_MARGIN_STEPS;
    return crossSectionFlatLength(regionIndex) / (Math.max(0, intervals - 1) + 2 * marginSteps);
  });
  const gridStep = Math.min(...maximumSteps);
  const regions = intervalCounts.map((intervals, regionIndex) => {
    const flatLength = crossSectionFlatLength(regionIndex);
    const margin = (flatLength - Math.max(0, intervals - 1) * gridStep) / 2;
    const names = ['top', 'outer', 'bottom', 'inner'] as const;
    return Object.freeze({
      region: names[regionIndex]!,
      intervals,
      flatLength,
      margin,
    });
  });
  const outerMargin = Math.min(regions[0]!.margin, regions[1]!.margin, regions[2]!.margin);
  const innerMargin = regions[3]!.margin;
  const transitionRadius = Math.min(
    HALF_FRAME_WIDTH * GRID_MAX_TRANSITION_RADIUS_RATIO,
    Math.max(
      TORUS_3D_BEVEL_SIZE * GRID_MIN_TRANSITION_RADIUS_MULTIPLIER,
      gridStep * GRID_TRANSITION_RADIUS_STEP_RATIO,
    ),
  );
  const layout = Object.freeze({
    size,
    topIntervals,
    outerIntervals,
    bottomIntervals,
    innerIntervals,
    gridStep,
    outerMargin,
    innerMargin,
    transitionRadius,
    perimeterIntervals: balancedPerimeterIntervals(size),
    regions: Object.freeze(regions),
  });
  layoutCache.set(size, layout);
  return layout;
};

interface SquarePerimeterSample {
  readonly position: Readonly<{ x: number; y: number }>;
  readonly outward: Readonly<{ x: number; y: number }>;
  readonly tangent: Readonly<{ x: number; y: number }>;
  /** Normal component of d(position)/d(halfExtent); tangent components do not affect the surface normal. */
  readonly radialScale: number;
}

const squarePerimeter = (
  halfExtent: number,
  u: number,
  cornerRadius = TORUS_3D_BEVEL_SIZE,
): SquarePerimeterSample => {
  const perimeter = wrapUnit(u + 0.125) * 4;
  const edge = Math.min(3, Math.floor(perimeter));
  const t = perimeter - edge;
  const flatEnd = 1 - XY_CORNER_PHASE;
  const radius = Math.min(cornerRadius, halfExtent * 0.25);
  const flatT = Math.min(t, flatEnd) / flatEnd;

  if (edge === 0) {
    if (t < flatEnd) {
      return Object.freeze({
        position: Object.freeze({
          x: lerp(-halfExtent + radius, halfExtent - radius, flatT),
          y: halfExtent,
        }),
        outward: Object.freeze({ x: 0, y: 1 }),
        tangent: Object.freeze({ x: 1, y: 0 }),
        radialScale: 1,
      });
    }
    const q = (t - flatEnd) / XY_CORNER_PHASE;
    const angle = (Math.PI / 2) * (1 - q);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return Object.freeze({
      position: Object.freeze({
        x: halfExtent - radius + radius * cos,
        y: halfExtent - radius + radius * sin,
      }),
      outward: Object.freeze({ x: cos, y: sin }),
      tangent: Object.freeze({ x: sin, y: -cos }),
      radialScale: Math.abs(cos) + Math.abs(sin),
    });
  }

  if (edge === 1) {
    if (t < flatEnd) {
      return Object.freeze({
        position: Object.freeze({
          x: halfExtent,
          y: lerp(halfExtent - radius, -halfExtent + radius, flatT),
        }),
        outward: Object.freeze({ x: 1, y: 0 }),
        tangent: Object.freeze({ x: 0, y: -1 }),
        radialScale: 1,
      });
    }
    const q = (t - flatEnd) / XY_CORNER_PHASE;
    const angle = -(Math.PI / 2) * q;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return Object.freeze({
      position: Object.freeze({
        x: halfExtent - radius + radius * cos,
        y: -halfExtent + radius + radius * sin,
      }),
      outward: Object.freeze({ x: cos, y: sin }),
      tangent: Object.freeze({ x: sin, y: -cos }),
      radialScale: Math.abs(cos) + Math.abs(sin),
    });
  }

  if (edge === 2) {
    if (t < flatEnd) {
      return Object.freeze({
        position: Object.freeze({
          x: lerp(halfExtent - radius, -halfExtent + radius, flatT),
          y: -halfExtent,
        }),
        outward: Object.freeze({ x: 0, y: -1 }),
        tangent: Object.freeze({ x: -1, y: 0 }),
        radialScale: 1,
      });
    }
    const q = (t - flatEnd) / XY_CORNER_PHASE;
    const angle = -Math.PI / 2 - (Math.PI / 2) * q;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return Object.freeze({
      position: Object.freeze({
        x: -halfExtent + radius + radius * cos,
        y: -halfExtent + radius + radius * sin,
      }),
      outward: Object.freeze({ x: cos, y: sin }),
      tangent: Object.freeze({ x: sin, y: -cos }),
      radialScale: Math.abs(cos) + Math.abs(sin),
    });
  }

  if (t < flatEnd) {
    return Object.freeze({
      position: Object.freeze({
        x: -halfExtent,
        y: lerp(-halfExtent + radius, halfExtent - radius, flatT),
      }),
      outward: Object.freeze({ x: -1, y: 0 }),
      tangent: Object.freeze({ x: 0, y: 1 }),
      radialScale: 1,
    });
  }
  const q = (t - flatEnd) / XY_CORNER_PHASE;
  const angle = Math.PI - (Math.PI / 2) * q;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Object.freeze({
    position: Object.freeze({
      x: -halfExtent + radius + radius * cos,
      y: halfExtent - radius + radius * sin,
    }),
    outward: Object.freeze({ x: cos, y: sin }),
    tangent: Object.freeze({ x: sin, y: -cos }),
    radialScale: Math.abs(cos) + Math.abs(sin),
  });
};

interface CrossSectionSample {
  readonly radial: number;
  readonly z: number;
  readonly normalRadial: number;
  readonly normalZ: number;
}

/** Existing physical wooden cross-section. This intentionally stays unchanged. */
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

const normalizedVector = (x: number, y: number, z: number): Torus3DVector => {
  const length = Math.hypot(x, y, z);
  if (length <= Number.EPSILON) throw new Error('Torus 3D surface frame became degenerate');
  return freezeVector(x / length, y / length, z / length);
};

const surfaceFromCrossSection = (
  u: number,
  cross: CrossSectionSample,
  xyCornerRadius = TORUS_3D_BEVEL_SIZE,
): Torus3DSurfacePoint => {
  const square = squarePerimeter(CENTER_HALF_EXTENT + cross.radial, u, xyCornerRadius);
  const tangent = freezeVector(square.tangent.x, square.tangent.y, 0);

  const radialTangent = cross.normalZ * square.radialScale;
  const zTangent = -cross.normalRadial;
  const vx = square.outward.x * radialTangent;
  const vy = square.outward.y * radialTangent;
  const vz = zTangent;
  const normal = normalizedVector(
    square.tangent.y * vz,
    -square.tangent.x * vz,
    square.tangent.x * vy - square.tangent.y * vx,
  );

  return Object.freeze({
    position: freezeVector(square.position.x, square.position.y, cross.z),
    normal,
    tangent,
  });
};

/** Authoritative physical wood surface. Do not use this directly for logical grid intersections. */
export const torus3DSurfaceFromUv = (u: number, v: number): Torus3DSurfacePoint =>
  surfaceFromCrossSection(u, roundedCrossSection(v));

const phaseForLogicalCoordinate = (
  logicalCoordinate: number,
  size: TorusSize,
  phases: readonly number[],
): number => {
  const scaled = wrapUnit(logicalCoordinate) * size;
  const nearest = Math.round(scaled);
  if (Math.abs(scaled - nearest) <= LOGICAL_SNAP_EPSILON) {
    return phases[nearest % size]!;
  }

  const index = Math.floor(scaled);
  const fraction = scaled - index;
  const from = phases[index]!;
  let to = phases[(index + 1) % size]!;
  if (to <= from) to += 4;
  return lerp(from, to, fraction);
};

const crossSectionAnchorPhases = (layout: Torus3DGridLayout): readonly number[] => {
  const cached = crossSectionPhaseCache.get(layout.size);
  if (cached) return cached;

  const phases: number[] = [];
  const flatEnd = 1 - BEVEL_PHASE;
  for (let regionIndex = 0; regionIndex < layout.regions.length; regionIndex += 1) {
    const region = layout.regions[regionIndex]!;
    for (let index = 0; index < region.intervals; index += 1) {
      const distance = region.margin + index * layout.gridStep;
      const flatT = distance / region.flatLength;
      phases.push(regionIndex + flatT * flatEnd);
    }
  }
  if (phases.length !== layout.size) {
    throw new Error(`Torus 3D cross-section layout for ${layout.size}x${layout.size} is incomplete`);
  }
  const frozen = Object.freeze(phases);
  crossSectionPhaseCache.set(layout.size, frozen);
  return frozen;
};

const perimeterAnchorPhases = (
  layout: Torus3DGridLayout,
  halfExtent: number,
  cornerRadius: number,
): readonly number[] => {
  const radius = Math.min(cornerRadius, halfExtent * 0.25);
  const flatLength = 2 * (halfExtent - radius);
  const flatEnd = 1 - XY_CORNER_PHASE;
  const phases: number[] = [];

  for (let side = 0; side < 4; side += 1) {
    const intervals = layout.perimeterIntervals[side]!;
    const margin = (flatLength - Math.max(0, intervals - 1) * layout.gridStep) / 2;
    if (margin <= layout.gridStep) {
      throw new Error(`Torus 3D perimeter margin is too small for ${layout.size}x${layout.size}`);
    }
    for (let index = 0; index < intervals; index += 1) {
      const distance = margin + index * layout.gridStep;
      phases.push(side + (distance / flatLength) * flatEnd);
    }
  }
  return phases;
};

/**
 * Unified logical-grid surface parameterization. Integer logical coordinates are
 * centered on flat gameplay regions; interpolation keeps each toroidal cycle
 * continuous through the existing wood transitions. Top/bottom XY corners use
 * a larger grid-only radius without modifying the wooden mesh.
 */
export const torus3DGridSurfaceFromLogicalUv = (
  size: TorusSize,
  logicalU: number,
  logicalV: number,
): Torus3DSurfacePoint => {
  const layout = createTorus3DGridLayout(size);
  const crossPhase = phaseForLogicalCoordinate(
    logicalV,
    size,
    crossSectionAnchorPhases(layout),
  );
  const cross = roundedCrossSection(crossPhase / 4 - 0.125);
  const halfExtent = CENTER_HALF_EXTENT + cross.radial;
  const onPlanarTopOrBottom = Math.abs(Math.abs(cross.normalZ) - 1) <= 1e-9;
  const xyCornerRadius = onPlanarTopOrBottom
    ? layout.transitionRadius
    : TORUS_3D_BEVEL_SIZE;
  const perimeterPhase = phaseForLogicalCoordinate(
    logicalU,
    size,
    perimeterAnchorPhases(layout, halfExtent, xyCornerRadius),
  );
  return surfaceFromCrossSection(perimeterPhase / 4 - 0.125, cross, xyCornerRadius);
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
  return torus3DGridSurfaceFromLogicalUv(size, x / size, y / size);
};

export const torus3DPointIdFromUv = (size: TorusSize, u: number, v: number): PointId => {
  const x = Math.round(wrapUnit(u) * size) % size;
  const y = Math.round(wrapUnit(v) * size) % size;
  return `${x},${y}`;
};
