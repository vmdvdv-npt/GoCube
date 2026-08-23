import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { endgameGroupId } from './EndgameGroupIdentity';
import { buildEndgameGraph } from './EndgameGraphCore';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'fixture-graph',
    points: () => points,
    neighbors: (point: PointId) => adjacency[point] ?? Object.freeze([]),
    has: (point: PointId) => Object.prototype.hasOwnProperty.call(adjacency, point),
  });
};

const makeState = (board: Readonly<Record<PointId, PointOccupancy>>): GameState =>
  Object.freeze({
    board,
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });

describe('EndgameGraphCore', () => {
  it('builds strings, liberties, shared liberties, regions and direct connection points', () => {
    const topology = makeTopology({
      b1: Object.freeze(['x', 'y']),
      b2: Object.freeze(['x', 'z']),
      w1: Object.freeze(['x', 'y', 'z']),
      x: Object.freeze(['b1', 'b2', 'w1']),
      y: Object.freeze(['b1', 'w1']),
      z: Object.freeze(['b2', 'w1']),
    });
    const state = makeState(
      Object.freeze({
        b1: 'black',
        b2: 'black',
        w1: 'white',
        x: 'empty',
        y: 'empty',
        z: 'empty',
      }),
    );

    const graph = buildEndgameGraph(state, topology);
    const b1Key = endgameGroupId(['b1']);
    const b2Key = endgameGroupId(['b2']);
    const w1Key = endgameGroupId(['w1']);

    expect([...graph.groups.values()].map((group) => group.points)).toEqual([
      ['b1'],
      ['b2'],
      ['w1'],
    ]);
    expect(graph.groups.get(b1Key)?.liberties).toEqual(['x', 'y']);
    expect(graph.groups.get(b2Key)?.liberties).toEqual(['x', 'z']);
    expect(graph.groups.get(w1Key)?.liberties).toEqual(['x', 'y', 'z']);

    expect(graph.sharedLiberties).toEqual([
      Object.freeze({
        groupKeys: Object.freeze([b1Key, w1Key]),
        liberties: Object.freeze(['x', 'y']),
      }),
      Object.freeze({
        groupKeys: Object.freeze([b2Key, w1Key]),
        liberties: Object.freeze(['x', 'z']),
      }),
    ]);

    expect(graph.friendlyConnections).toEqual([
      Object.freeze({
        point: 'x',
        color: 'black',
        groupKeys: Object.freeze([b1Key, b2Key]),
      }),
    ]);

    expect(graph.emptyRegions.map((region) => region.points)).toEqual([['x'], ['y'], ['z']]);
    expect(graph.emptyRegions.find((region) => region.points[0] === 'x')).toEqual(
      Object.freeze({
        key: JSON.stringify(['x']),
        points: Object.freeze(['x']),
        boundaryGroups: Object.freeze([b1Key, b2Key, w1Key].sort()),
        boundaryColors: Object.freeze(['black', 'white']),
        vitalGroups: Object.freeze([b1Key, b2Key, w1Key].sort()),
      }),
    );
  });

  it('treats an arbitrary topology edge exactly like an ordinary board adjacency', () => {
    const topology = makeTopology({
      left: Object.freeze(['right', 'lib-left']),
      right: Object.freeze(['left', 'lib-right']),
      'lib-left': Object.freeze(['left']),
      'lib-right': Object.freeze(['right']),
    });
    const state = makeState(
      Object.freeze({
        left: 'black',
        right: 'black',
        'lib-left': 'empty',
        'lib-right': 'empty',
      }),
    );

    const graph = buildEndgameGraph(state, topology);
    const groups = [...graph.groups.values()];

    expect(groups).toHaveLength(1);
    expect(groups[0]?.points).toEqual(['left', 'right']);
    expect(groups[0]?.liberties).toEqual(['lib-left', 'lib-right']);
  });

  it('rejects an incomplete logical board instead of silently building partial analysis', () => {
    const topology = makeTopology({
      stone: Object.freeze(['liberty']),
      liberty: Object.freeze(['stone']),
    });
    const state = makeState(Object.freeze({ stone: 'black' }));

    expect(() => buildEndgameGraph(state, topology)).toThrow(
      'Endgame graph is missing occupancy for point: liberty',
    );
  });
});
