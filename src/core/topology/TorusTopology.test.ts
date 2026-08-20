import { describe, expect, it } from 'vitest';
import type { Topology } from './Topology';
import { TORUS_SIZES, TorusTopology, type TorusSize } from './TorusTopology';

const asSet = (values: readonly string[]) => new Set(values);

const expectNeighbors = (
  topology: Topology,
  point: string,
  expected: readonly string[],
) => {
  expect(asSet(topology.neighbors(point))).toEqual(asSet(expected));
};

const verifyTopologyContract = (topology: Topology) => {
  for (const point of topology.points()) {
    const neighbors = topology.neighbors(point);

    expect(neighbors).toHaveLength(4);
    expect(new Set(neighbors).size).toBe(4);
    expect(neighbors.every((neighbor) => topology.has(neighbor))).toBe(true);

    for (const neighbor of neighbors) {
      expect(topology.neighbors(neighbor)).toContain(point);
    }
  }
};

describe.each(TORUS_SIZES)('TorusTopology %dx%d', (size: TorusSize) => {
  const createTopology = () => new TorusTopology(size);

  it('enumerates every logical point exactly once', () => {
    const topology = createTopology();
    const points = topology.points();

    expect(points).toHaveLength(size * size);
    expect(new Set(points).size).toBe(size * size);
    expect(points.every((point) => topology.has(point))).toBe(true);
  });

  it('satisfies the generic Topology contract', () => {
    const topology: Topology = createTopology();
    verifyTopologyContract(topology);
  });

  it('wraps every point on the left and right boundaries', () => {
    const topology = createTopology();

    for (let y = 0; y < size; y += 1) {
      expect(topology.neighbors(`0,${y}`)).toContain(`${size - 1},${y}`);
      expect(topology.neighbors(`${size - 1},${y}`)).toContain(`0,${y}`);
    }
  });

  it('wraps every point on the top and bottom boundaries', () => {
    const topology = createTopology();

    for (let x = 0; x < size; x += 1) {
      expect(topology.neighbors(`${x},0`)).toContain(`${x},${size - 1}`);
      expect(topology.neighbors(`${x},${size - 1}`)).toContain(`${x},0`);
    }
  });

  it('connects all four corners correctly', () => {
    const topology = createTopology();
    const last = size - 1;

    expectNeighbors(topology, '0,0', [`${last},0`, '1,0', `0,${last}`, '0,1']);
    expectNeighbors(topology, `${last},0`, [
      `${last - 1},0`,
      '0,0',
      `${last},${last}`,
      `${last},1`,
    ]);
    expectNeighbors(topology, `0,${last}`, [
      `${last},${last}`,
      `1,${last}`,
      `0,${last - 1}`,
      '0,0',
    ]);
    expectNeighbors(topology, `${last},${last}`, [
      `${last - 1},${last}`,
      `0,${last}`,
      `${last},${last - 1}`,
      `${last},0`,
    ]);
  });

  it('keeps ordinary interior adjacency orthogonal', () => {
    const topology = createTopology();
    expectNeighbors(topology, '1,1', ['0,1', '2,1', '1,0', '1,2']);
  });
});

describe('TorusTopology validation', () => {
  it('rejects sizes outside 9x9, 13x13, and 19x19 at runtime', () => {
    for (const size of [0, 1, 2, 8, 10, 18, 20, 9.5]) {
      expect(() => new TorusTopology(size as TorusSize)).toThrow(/Unsupported torus size/);
    }
  });

  it('rejects unknown point ids', () => {
    const topology = new TorusTopology(9);

    expect(() => topology.neighbors('-1,0')).toThrow('Unknown point: -1,0');
    expect(() => topology.neighbors('9,0')).toThrow('Unknown point: 9,0');
    expect(() => topology.neighbors('0,9')).toThrow('Unknown point: 0,9');
    expect(() => topology.neighbors('not-a-point')).toThrow('Unknown point: not-a-point');
  });
});
