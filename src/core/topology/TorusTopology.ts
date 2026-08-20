import type { PointId, Topology } from './Topology';

export const TORUS_SIZES = [9, 13, 19] as const;
export type TorusSize = (typeof TORUS_SIZES)[number];

const pointId = (x: number, y: number): PointId => `${x},${y}`;

const isSupportedTorusSize = (size: number): size is TorusSize =>
  TORUS_SIZES.some((supportedSize) => supportedSize === size);

export class TorusTopology implements Topology {
  readonly id: string;
  private readonly pointSet: ReadonlySet<PointId>;
  private readonly allPoints: readonly PointId[];

  constructor(readonly size: TorusSize) {
    if (!isSupportedTorusSize(size)) {
      throw new Error(`Unsupported torus size: ${size}. Expected one of: ${TORUS_SIZES.join(', ')}`);
    }

    this.id = `torus-${size}x${size}`;
    this.allPoints = Object.freeze(
      Array.from({ length: size * size }, (_, index) =>
        pointId(index % size, Math.floor(index / size)),
      ),
    );
    this.pointSet = new Set(this.allPoints);
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    if (!this.has(point)) {
      throw new Error(`Unknown point: ${point}`);
    }

    const [x, y] = point.split(',').map(Number);
    const wrap = (value: number) => (value + this.size) % this.size;

    return [
      pointId(wrap(x - 1), y),
      pointId(wrap(x + 1), y),
      pointId(x, wrap(y - 1)),
      pointId(x, wrap(y + 1)),
    ];
  }
}
