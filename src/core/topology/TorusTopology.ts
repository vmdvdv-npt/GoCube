import type { PointId, Topology } from './Topology';

const pointId = (x: number, y: number): PointId => `${x},${y}`;

export class TorusTopology implements Topology {
  readonly id: string;
  private readonly pointSet: Set<PointId>;
  private readonly allPoints: PointId[];

  constructor(readonly size: number) {
    if (!Number.isInteger(size) || size < 2) {
      throw new Error('Torus size must be an integer >= 2');
    }

    this.id = `torus-${size}x${size}`;
    this.allPoints = Array.from({ length: size * size }, (_, index) =>
      pointId(index % size, Math.floor(index / size)),
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
    if (!this.has(point)) throw new Error(`Unknown point: ${point}`);

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
