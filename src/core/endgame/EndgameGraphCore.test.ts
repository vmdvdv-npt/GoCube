import { describe, expect, it } from 'vitest';
import type { BoardOccupancy, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph, type EndgameGraph } from './EndgameGraphCore';

const makeBoard = (
  topology: Topology,
  stones: Readonly<Partial<Record<PointId, PointOccupancy>>> = {},
): BoardOccupancy => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze(board);
};

class FixtureTopology implements Topology {
  readonly id: string;
  private readonly pointSet: ReadonlySet<PointId>;

  constructor(
    id: string,
    private readonly allPoints: readonly PointId[],
    private readonly adjacency: Readonly<Record<PointId, readonly PointId[]>>,
  ) {
    this.id = id;
    this.pointSet = new Set(allPoints);
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  neighbors(point: PointId): readonly PointId[] {
    if (!this.has(point)) throw new Error(`Unknown fixture point: ${point}`);
    return this.adjacency[point] ?? Object.freeze([]);
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
  }
}

const fixtureTopology = (
  id: string,
  labels: Readonly<Record<'a' | 'b' | 'c' | 'd' | 'x' | 'y' | 'z', PointId>>,
): FixtureTopology => {
  const { a, b, c, d, x, y, z } = labels;
  return new FixtureTopology(
    id,
    Object.freeze([a, b, c, d, x, y, z]),
    Object.freeze({
      [a]: Object.freeze([b, x, z]),
      [b]: Object.freeze([a, x]),
      [c]: Object.freeze([x, y]),
      [d]: Object.freeze([y, z]),
      [x]: Object.freeze([a, b, c]),
      [y]: Object.freeze([c, d]),
      [z]: Object.freeze([d, a]),
    }),
  );
};

const invariantSignature = (graph: EndgameGraph): Readonly<Record<string, unknown>> => {
  const strings = graph.strings
    .map((group) => `${group.color}:${group.points.length}:${group.liberties.length}`)
    .sort();
  const regions = graph.emptyRegions
    .map(
      (region) =>
        `${region.points.length}:${region.boundaryColors.join('+')}:${region.boundaryGroups.length}:${region.vitalGroups.length}`,
    )
    .sort();
  const sharedLiberties = graph.sharedLiberties
    .map((entry) => {
      const colors = entry.groups
        .map((key) => graph.stringsByKey.get(key)!.color)
        .sort()
        .join('+');
      return `${colors}:${entry.liberties.length}`;
    })
    .sort();
  const connections = graph.possibleConnections
    .map(
      (entry) =>
        `${entry.viaRegions.length}:${entry.sharedLiberties.length}:${entry.groups
          .map((key) => graph.stringsByKey.get(key)!.color)
          .sort()
          .join('+')}`,
    )
    .sort();
  const conflicts = graph.conflictComponents
    .map(
      (component) =>
        `${component.blackStrings.length}:${component.whiteStrings.length}:${component.emptyRegions.length}:${component.sharedLiberties.length}:${component.possibleConnections.length}`,
    )
    .sort();

  return Object.freeze({
    strings,
    regions,
    opponentAdjacencies: graph.opponentAdjacencies.length,
    sharedLiberties,
    connections,
    conflicts,
  });
};

describe('EndgameGraphCore', () => {
  it('joins a stone string across a Torus seam through Topology.neighbors()', () => {
    const topology = new TorusTopology(9);
    const graph = buildEndgameGraph(
      makeBoard(topology, {
        '0,0': 'black',
        '8,0': 'black',
      }),
      topology,
    );

    expect(graph.strings).toHaveLength(1);
    expect(graph.strings[0]).toMatchObject({
      color: 'black',
      points: ['0,0', '8,0'],
    });
    expect(graph.strings[0]!.liberties).toHaveLength(6);
    expect(graph.stringByPoint.get('0,0')).toBe(graph.stringByPoint.get('8,0'));
  });

  it('joins a stone string across a Cube face edge through the same graph path', () => {
    const topology = new CubeTopology(3);
    const graph = buildEndgameGraph(
      makeBoard(topology, {
        'front:1:2': 'white',
        'right:1:0': 'white',
      }),
      topology,
    );

    expect(graph.strings).toHaveLength(1);
    expect(graph.strings[0]).toMatchObject({
      color: 'white',
      points: ['front:1:2', 'right:1:0'],
    });
    expect(graph.stringByPoint.get('front:1:2')).toBe(
      graph.stringByPoint.get('right:1:0'),
    );
  });

  it('builds regions, shared liberties, friendly connection candidates and one conflict component', () => {
    const topology = fixtureTopology('fixture-a', {
      a: 'a',
      b: 'b',
      c: 'c',
      d: 'd',
      x: 'x',
      y: 'y',
      z: 'z',
    });
    const graph = buildEndgameGraph(
      makeBoard(topology, {
        a: 'black',
        b: 'black',
        c: 'white',
        d: 'black',
      }),
      topology,
    );

    expect(graph.strings).toHaveLength(3);
    expect(graph.emptyRegions).toHaveLength(3);
    expect(graph.sharedLiberties).toHaveLength(3);
    expect(graph.possibleConnections).toHaveLength(1);
    expect(graph.possibleConnections[0]!.sharedLiberties).toEqual(['z']);
    expect(graph.opponentAdjacencies).toHaveLength(0);
    expect(graph.conflictComponents).toHaveLength(1);
    expect(graph.conflictComponents[0]).toMatchObject({
      blackStrings: expect.arrayContaining([
        expect.stringContaining('a'),
        expect.stringContaining('d'),
      ]),
      whiteStrings: [expect.stringContaining('c')],
    });
    expect(graph.conflictComponents[0]!.emptyRegions).toHaveLength(3);
    expect(graph.regionByPoint.size).toBe(3);
  });

  it('preserves the graph result under a pure PointId relabeling', () => {
    const first = fixtureTopology('fixture-original', {
      a: 'a',
      b: 'b',
      c: 'c',
      d: 'd',
      x: 'x',
      y: 'y',
      z: 'z',
    });
    const second = fixtureTopology('fixture-renamed', {
      a: 'node-71',
      b: 'node-04',
      c: 'node-55',
      d: 'node-19',
      x: 'node-88',
      y: 'node-02',
      z: 'node-43',
    });

    const firstGraph = buildEndgameGraph(
      makeBoard(first, { a: 'black', b: 'black', c: 'white', d: 'black' }),
      first,
    );
    const secondGraph = buildEndgameGraph(
      makeBoard(second, {
        'node-71': 'black',
        'node-04': 'black',
        'node-55': 'white',
        'node-19': 'black',
      }),
      second,
    );

    expect(invariantSignature(secondGraph)).toEqual(invariantSignature(firstGraph));
  });

  it('fails closed when the logical board does not define a topology point', () => {
    const topology = fixtureTopology('fixture-invalid-board', {
      a: 'a',
      b: 'b',
      c: 'c',
      d: 'd',
      x: 'x',
      y: 'y',
      z: 'z',
    });
    const incompleteBoard = Object.freeze({
      a: 'black',
      b: 'black',
      c: 'white',
      d: 'black',
      x: 'empty',
      y: 'empty',
    }) as BoardOccupancy;

    expect(() => buildEndgameGraph(incompleteBoard, topology)).toThrow(
      'Board has no valid occupancy for topology point: z',
    );
  });
});
