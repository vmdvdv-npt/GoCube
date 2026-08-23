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

const sortJson = <T>(values: readonly T[]): readonly T[] =>
  [...values].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

const normalizedGraph = (
  graph: EndgameGraph,
  roleByPoint: Readonly<Record<PointId, string>>,
): Readonly<Record<string, unknown>> => {
  const roleOf = (point: PointId): string => {
    const role = roleByPoint[point];
    if (!role) throw new Error(`Missing graph-isomorphism role for ${point}`);
    return role;
  };
  const groupName = (key: string): string =>
    graph.stringsByKey.get(key)!.points.map(roleOf).sort().join('+');
  const regionName = (key: string): string =>
    graph.regionsByKey.get(key)!.points.map(roleOf).sort().join('+');
  const groupPair = (groups: readonly [string, string]): readonly string[] =>
    Object.freeze(groups.map(groupName).sort());

  const strings = sortJson(
    graph.strings.map((group) =>
      Object.freeze({
        name: groupName(group.key),
        color: group.color,
        points: Object.freeze(group.points.map(roleOf).sort()),
        liberties: Object.freeze(group.liberties.map(roleOf).sort()),
      }),
    ),
  );
  const regions = sortJson(
    graph.emptyRegions.map((region) =>
      Object.freeze({
        name: regionName(region.key),
        points: Object.freeze(region.points.map(roleOf).sort()),
        boundaryGroups: Object.freeze(region.boundaryGroups.map(groupName).sort()),
        boundaryColors: region.boundaryColors,
        vitalGroups: Object.freeze(region.vitalGroups.map(groupName).sort()),
      }),
    ),
  );
  const opponentAdjacencies = sortJson(
    graph.opponentAdjacencies.map((entry) => groupPair(entry.groups)),
  );
  const sharedLiberties = sortJson(
    graph.sharedLiberties.map((entry) =>
      Object.freeze({
        groups: groupPair(entry.groups),
        liberties: Object.freeze(entry.liberties.map(roleOf).sort()),
      }),
    ),
  );
  const possibleConnections = sortJson(
    graph.possibleConnections.map((entry) =>
      Object.freeze({
        groups: groupPair(entry.groups),
        viaRegions: Object.freeze(entry.viaRegions.map(regionName).sort()),
        sharedLiberties: Object.freeze(entry.sharedLiberties.map(roleOf).sort()),
      }),
    ),
  );
  const conflictComponents = sortJson(
    graph.conflictComponents.map((component) =>
      Object.freeze({
        blackStrings: Object.freeze(component.blackStrings.map(groupName).sort()),
        whiteStrings: Object.freeze(component.whiteStrings.map(groupName).sort()),
        emptyRegions: Object.freeze(component.emptyRegions.map(regionName).sort()),
        sharedLiberties: sortJson(
          component.sharedLiberties.map((entry) =>
            Object.freeze({
              groups: groupPair(entry.groups),
              liberties: Object.freeze(entry.liberties.map(roleOf).sort()),
            }),
          ),
        ),
        possibleConnections: sortJson(
          component.possibleConnections.map((entry) =>
            Object.freeze({
              groups: groupPair(entry.groups),
              viaRegions: Object.freeze(entry.viaRegions.map(regionName).sort()),
              sharedLiberties: Object.freeze(entry.sharedLiberties.map(roleOf).sort()),
            }),
          ),
        ),
      }),
    ),
  );
  const stringByPoint = sortJson(
    [...graph.stringByPoint].map(([point, key]) => Object.freeze([roleOf(point), groupName(key)])),
  );
  const regionByPoint = sortJson(
    [...graph.regionByPoint].map(([point, key]) => Object.freeze([roleOf(point), regionName(key)])),
  );

  return Object.freeze({
    strings,
    regions,
    stringByPoint,
    regionByPoint,
    opponentAdjacencies,
    sharedLiberties,
    possibleConnections,
    conflictComponents,
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

  it('records direct opposing-string adjacency once', () => {
    const topology = new TorusTopology(9);
    const graph = buildEndgameGraph(
      makeBoard(topology, {
        '0,0': 'black',
        '1,0': 'white',
      }),
      topology,
    );

    expect(graph.strings).toHaveLength(2);
    expect(graph.opponentAdjacencies).toHaveLength(1);
    const colors = graph.opponentAdjacencies[0]!.groups
      .map((key) => graph.stringsByKey.get(key)!.color)
      .sort();
    expect(colors).toEqual(['black', 'white']);
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

  it('does not create a friendly connection merely because two strings border one large region', () => {
    const topology = new FixtureTopology(
      'long-region',
      Object.freeze(['left', 'e1', 'e2', 'right']),
      Object.freeze({
        left: Object.freeze(['e1']),
        e1: Object.freeze(['left', 'e2']),
        e2: Object.freeze(['e1', 'right']),
        right: Object.freeze(['e2']),
      }),
    );
    const graph = buildEndgameGraph(
      makeBoard(topology, { left: 'black', right: 'black' }),
      topology,
    );

    expect(graph.emptyRegions).toHaveLength(1);
    expect(graph.emptyRegions[0]!.boundaryGroups).toHaveLength(2);
    expect(graph.sharedLiberties).toHaveLength(0);
    expect(graph.possibleConnections).toHaveLength(0);
  });

  it('preserves the exact graph under a pure PointId relabeling', () => {
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

    expect(
      normalizedGraph(secondGraph, {
        'node-71': 'a',
        'node-04': 'b',
        'node-55': 'c',
        'node-19': 'd',
        'node-88': 'x',
        'node-02': 'y',
        'node-43': 'z',
      }),
    ).toEqual(
      normalizedGraph(firstGraph, {
        a: 'a',
        b: 'b',
        c: 'c',
        d: 'd',
        x: 'x',
        y: 'y',
        z: 'z',
      }),
    );
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
