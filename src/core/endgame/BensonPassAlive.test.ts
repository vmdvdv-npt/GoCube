import { describe, expect, it } from 'vitest';
import type { BoardOccupancy, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import {
  buildBensonColorRegions,
  proveBensonPassAlive,
} from './BensonPassAlive';
import { buildEndgameGraph } from './EndgameGraphCore';

const makeTopology = (
  id: string,
  adjacency: Readonly<Record<PointId, readonly PointId[]>>,
): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id,
    points: () => points,
    has: (point: PointId) => Object.prototype.hasOwnProperty.call(adjacency, point),
    neighbors: (point: PointId) => adjacency[point] ?? [],
  });
};

const makeBoard = (
  topology: Topology,
  occupancyAt: (point: PointId) => PointOccupancy,
): BoardOccupancy => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupancyAt(point);
  return Object.freeze(board);
};

const passAliveSignature = (topology: Topology, eyes: readonly PointId[]) => {
  const eyeSet = new Set(eyes);
  const board = makeBoard(topology, (point) => (eyeSet.has(point) ? 'empty' : 'black'));
  const graph = buildEndgameGraph(board, topology);
  const blackGroups = graph.strings.filter((group) => group.color === 'black');
  expect(blackGroups).toHaveLength(1);

  const proofs = proveBensonPassAlive(board, topology, graph, 'black');
  const vitalRegions = proofs.get(blackGroups[0]!.key);
  return Object.freeze({
    proofCount: proofs.size,
    vitalRegionSizes: Object.freeze(
      (vitalRegions ?? []).map((region) => region.points.length).sort((left, right) => left - right),
    ),
  });
};

describe('BensonPassAlive', () => {
  it('uses color-specific non-color regions when opponent stones occupy the regions', () => {
    const topology = makeTopology(
      'benson-opponent-in-region',
      Object.freeze({
        b: Object.freeze(['e1', 'w1', 'e2', 'w2']),
        e1: Object.freeze(['b', 'w1']),
        w1: Object.freeze(['b', 'e1']),
        e2: Object.freeze(['b', 'w2']),
        w2: Object.freeze(['b', 'e2']),
      }),
    );
    const board = makeBoard(topology, (point) => {
      if (point === 'b') return 'black';
      if (point === 'w1' || point === 'w2') return 'white';
      return 'empty';
    });
    const graph = buildEndgameGraph(board, topology);

    const regions = buildBensonColorRegions(board, topology, graph, 'black');
    expect(regions.map((region) => region.points)).toEqual([
      ['e1', 'w1'],
      ['e2', 'w2'],
    ]);

    const proofs = proveBensonPassAlive(board, topology, graph, 'black');
    expect(proofs).toHaveLength(1);
    expect([...proofs.values()][0]).toHaveLength(2);
  });

  it('does not prove one-eye or two empty pockets joined into one non-color region', () => {
    const oneEyeTopology = makeTopology(
      'benson-one-eye',
      Object.freeze({
        b: Object.freeze(['e']),
        e: Object.freeze(['b']),
      }),
    );
    const oneEyeBoard = makeBoard(oneEyeTopology, (point) =>
      point === 'b' ? 'black' : 'empty',
    );
    const oneEyeGraph = buildEndgameGraph(oneEyeBoard, oneEyeTopology);
    expect(proveBensonPassAlive(oneEyeBoard, oneEyeTopology, oneEyeGraph, 'black').size).toBe(0);

    const falseEyeTopology = makeTopology(
      'benson-false-eye',
      Object.freeze({
        b: Object.freeze(['e1', 'w', 'e2']),
        e1: Object.freeze(['b', 'w']),
        w: Object.freeze(['b', 'e1', 'e2']),
        e2: Object.freeze(['b', 'w']),
      }),
    );
    const falseEyeBoard = makeBoard(falseEyeTopology, (point) => {
      if (point === 'b') return 'black';
      if (point === 'w') return 'white';
      return 'empty';
    });
    const falseEyeGraph = buildEndgameGraph(falseEyeBoard, falseEyeTopology);
    const falseEyeRegions = buildBensonColorRegions(
      falseEyeBoard,
      falseEyeTopology,
      falseEyeGraph,
      'black',
    );

    expect(falseEyeRegions).toHaveLength(1);
    expect(falseEyeRegions[0]?.points).toEqual(['e1', 'e2', 'w']);
    expect(
      proveBensonPassAlive(falseEyeBoard, falseEyeTopology, falseEyeGraph, 'black').size,
    ).toBe(0);
  });

  it('preserves the same proof across a Torus seam and a Cube face edge', () => {
    const torus = new TorusTopology(9);
    expect(torus.neighbors('0,4')).toContain('8,4');
    const torusInterior = passAliveSignature(torus, ['2,2', '5,5']);
    const torusSeam = passAliveSignature(torus, ['0,4', '4,4']);
    expect(torusSeam).toEqual(torusInterior);
    expect(torusSeam).toEqual({ proofCount: 1, vitalRegionSizes: [1, 1] });

    const cube = new CubeTopology(5);
    expect(cube.neighbors('front:0:2').some((point) => !point.startsWith('front:'))).toBe(true);
    const cubeInterior = passAliveSignature(cube, ['front:2:2', 'back:2:2']);
    const cubeEdge = passAliveSignature(cube, ['front:0:2', 'back:2:2']);
    expect(cubeEdge).toEqual(cubeInterior);
    expect(cubeEdge).toEqual({ proofCount: 1, vitalRegionSizes: [1, 1] });
  });
});
