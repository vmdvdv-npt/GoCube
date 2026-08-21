import { describe, expect, it } from 'vitest';
import type { PointId, Topology } from './Topology';
import {
  CUBE_FACES,
  CUBE_SIZES,
  CubeTopology,
  cubePointId,
  type CubeFace,
  type CubeSize,
} from './CubeTopology';

type Edge = 'top' | 'right' | 'bottom' | 'left';

interface EdgeExpectation {
  readonly fromFace: CubeFace;
  readonly fromEdge: Edge;
  readonly toFace: CubeFace;
  readonly toEdge: Edge;
  readonly reverse: boolean;
}

const EDGE_EXPECTATIONS: readonly EdgeExpectation[] = [
  { fromFace: 'front', fromEdge: 'left', toFace: 'left', toEdge: 'right', reverse: false },
  { fromFace: 'front', fromEdge: 'right', toFace: 'right', toEdge: 'left', reverse: false },
  { fromFace: 'front', fromEdge: 'top', toFace: 'top', toEdge: 'bottom', reverse: false },
  { fromFace: 'front', fromEdge: 'bottom', toFace: 'bottom', toEdge: 'top', reverse: false },
  { fromFace: 'back', fromEdge: 'left', toFace: 'right', toEdge: 'right', reverse: false },
  { fromFace: 'back', fromEdge: 'right', toFace: 'left', toEdge: 'left', reverse: false },
  { fromFace: 'back', fromEdge: 'top', toFace: 'top', toEdge: 'top', reverse: true },
  { fromFace: 'back', fromEdge: 'bottom', toFace: 'bottom', toEdge: 'bottom', reverse: true },
  { fromFace: 'left', fromEdge: 'top', toFace: 'top', toEdge: 'left', reverse: false },
  { fromFace: 'left', fromEdge: 'bottom', toFace: 'bottom', toEdge: 'left', reverse: true },
  { fromFace: 'right', fromEdge: 'top', toFace: 'top', toEdge: 'right', reverse: true },
  { fromFace: 'right', fromEdge: 'bottom', toFace: 'bottom', toEdge: 'right', reverse: false },
];

const pointOnEdge = (
  face: CubeFace,
  edge: Edge,
  index: number,
  last: number,
): PointId => {
  switch (edge) {
    case 'top':
      return cubePointId(face, 0, index);
    case 'right':
      return cubePointId(face, index, last);
    case 'bottom':
      return cubePointId(face, last, index);
    case 'left':
      return cubePointId(face, index, 0);
  }
};

const physicalCorners = (last: number): readonly (readonly PointId[])[] => [
  [cubePointId('front', 0, 0), cubePointId('left', 0, last), cubePointId('top', last, 0)],
  [cubePointId('front', 0, last), cubePointId('right', 0, 0), cubePointId('top', last, last)],
  [cubePointId('front', last, 0), cubePointId('left', last, last), cubePointId('bottom', 0, 0)],
  [cubePointId('front', last, last), cubePointId('right', last, 0), cubePointId('bottom', 0, last)],
  [cubePointId('back', 0, last), cubePointId('left', 0, 0), cubePointId('top', 0, 0)],
  [cubePointId('back', 0, 0), cubePointId('right', 0, last), cubePointId('top', 0, last)],
  [cubePointId('back', last, last), cubePointId('left', last, 0), cubePointId('bottom', last, 0)],
  [cubePointId('back', last, 0), cubePointId('right', last, last), cubePointId('bottom', last, last)],
];

const verifyTopologyContract = (topology: Topology) => {
  for (const point of topology.points()) {
    const neighbors = topology.neighbors(point);

    expect(neighbors).toHaveLength(4);
    expect(new Set(neighbors).size).toBe(4);
    expect(neighbors).not.toContain(point);
    expect(neighbors.every((neighbor) => topology.has(neighbor))).toBe(true);

    for (const neighbor of neighbors) {
      expect(topology.neighbors(neighbor)).toContain(point);
    }
  }
};

describe.each(CUBE_SIZES)('CubeTopology %dx%d', (size: CubeSize) => {
  const createTopology = () => new CubeTopology(size);

  it('enumerates six faces with unique logical point ids', () => {
    const topology = createTopology();
    const points = topology.points();

    expect(points).toHaveLength(6 * size * size);
    expect(new Set(points).size).toBe(6 * size * size);
    expect(points.every((point) => topology.has(point))).toBe(true);

    for (const face of CUBE_FACES) {
      expect(points.filter((point) => point.startsWith(`${face}:`))).toHaveLength(size * size);
    }
  });

  it('satisfies the generic four-neighbor Topology contract', () => {
    const topology: Topology = createTopology();
    verifyTopologyContract(topology);
  });

  it('keeps ordinary interior adjacency orthogonal', () => {
    if (size < 3) return;

    const topology = createTopology();
    expect(new Set(topology.neighbors(cubePointId('front', 1, 1)))).toEqual(
      new Set([
        cubePointId('front', 0, 1),
        cubePointId('front', 1, 2),
        cubePointId('front', 2, 1),
        cubePointId('front', 1, 0),
      ]),
    );
  });

  it('maps every point of every physical edge to the expected neighboring face', () => {
    const topology = createTopology();
    const last = size - 1;

    for (const expectation of EDGE_EXPECTATIONS) {
      for (let index = 0; index < size; index += 1) {
        const from = pointOnEdge(
          expectation.fromFace,
          expectation.fromEdge,
          index,
          last,
        );
        const targetIndex = expectation.reverse ? last - index : index;
        const to = pointOnEdge(
          expectation.toFace,
          expectation.toEdge,
          targetIndex,
          last,
        );

        expect(topology.neighbors(from)).toContain(to);
        expect(topology.neighbors(to)).toContain(from);
      }
    }
  });

  it('connects the three logical corner points at each physical cube corner without extras', () => {
    const topology = createTopology();
    const last = size - 1;

    for (const corner of physicalCorners(last)) {
      for (const point of corner) {
        const neighbors = topology.neighbors(point);
        const otherCornerPoints = corner.filter((candidate) => candidate !== point);

        expect(otherCornerPoints).toHaveLength(2);
        expect(otherCornerPoints.every((candidate) => neighbors.includes(candidate))).toBe(true);
        expect(neighbors.filter((candidate) => corner.includes(candidate))).toHaveLength(2);
        expect(neighbors).toHaveLength(4);
        expect(new Set(neighbors).size).toBe(4);
      }
    }
  });
});

describe('CubeTopology validation', () => {
  it('rejects sizes outside 2x2 through 7x7 at runtime', () => {
    for (const size of [0, 1, 8, 9, 2.5]) {
      expect(() => new CubeTopology(size as CubeSize)).toThrow(/Unsupported cube size/);
    }
  });

  it('rejects unknown point ids', () => {
    const topology = new CubeTopology(3);

    expect(() => topology.neighbors('front:-1:0')).toThrow('Unknown point: front:-1:0');
    expect(() => topology.neighbors('front:3:0')).toThrow('Unknown point: front:3:0');
    expect(() => topology.neighbors('front:0:3')).toThrow('Unknown point: front:0:3');
    expect(() => topology.neighbors('unknown:0:0')).toThrow('Unknown point: unknown:0:0');
    expect(() => topology.neighbors('not-a-point')).toThrow('Unknown point: not-a-point');
  });
});
