import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import { buildTwoLibertyDefenderRelevance } from './TwoLibertyDefenderRelevance';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'two-liberty-relevance-fixture',
    points: () => points,
    neighbors: (point: PointId) => adjacency[point] ?? Object.freeze([]),
    has: (point: PointId) => Object.prototype.hasOwnProperty.call(adjacency, point),
  });
};

const makeState = (
  topology: Topology,
  occupied: Readonly<Record<PointId, Exclude<PointOccupancy, 'empty'>>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupied[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 40,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

describe('TwoLibertyDefenderRelevance', () => {
  it('keeps the non-liberty counter-capture preparation point inside the proof cone', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'q']),
      a: Object.freeze(['w', 'anchor']),
      b: Object.freeze(['w', 'anchor']),
      anchor: Object.freeze(['a', 'b', 'e1', 'e2']),
      e1: Object.freeze(['anchor']),
      e2: Object.freeze(['anchor']),
      q: Object.freeze(['w', 'c', 'd']),
      c: Object.freeze(['q', 'c1']),
      c1: Object.freeze(['c']),
      d: Object.freeze(['q']),
      remote0: Object.freeze(['remote1']),
      remote1: Object.freeze(['remote0']),
    });
    const state = makeState(
      topology,
      Object.freeze({ w: 'white', anchor: 'black', q: 'black' }),
    );
    const graph = buildEndgameGraph(state, topology);

    const relevance = buildTwoLibertyDefenderRelevance(
      topology,
      graph,
      endgameGroupId(['w']),
    );

    expect(relevance?.relevantRootPlacements).toContain('c');
    expect(relevance?.relevantRootPlacements).not.toContain('remote0');
    expect(relevance?.relevantRootPlacements).not.toContain('remote1');
  });

  it('collapses a long existing stone string at zero ply cost before expanding liberties', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'q0']),
      a: Object.freeze(['w']),
      b: Object.freeze(['w']),
      q0: Object.freeze(['w', 'q1']),
      q1: Object.freeze(['q0', 'q2']),
      q2: Object.freeze(['q1', 'q3']),
      q3: Object.freeze(['q2', 'q4']),
      q4: Object.freeze(['q3', 'q5']),
      q5: Object.freeze(['q4', 'far-liberty']),
      'far-liberty': Object.freeze(['q5', 'far-next']),
      'far-next': Object.freeze(['far-liberty']),
    });
    const state = makeState(
      topology,
      Object.freeze({
        w: 'white',
        q0: 'black',
        q1: 'black',
        q2: 'black',
        q3: 'black',
        q4: 'black',
        q5: 'black',
      }),
    );
    const graph = buildEndgameGraph(state, topology);

    const relevance = buildTwoLibertyDefenderRelevance(
      topology,
      graph,
      endgameGroupId(['w']),
    );

    expect(relevance?.causalConePoints).toContain('q5');
    expect(relevance?.causalConePoints).toContain('far-liberty');
    expect(relevance?.relevantRootPlacements).toContain('far-next');
  });

  it('returns null outside the exact two-liberty scope', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c']),
      a: Object.freeze(['w']),
      b: Object.freeze(['w']),
      c: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const graph = buildEndgameGraph(state, topology);

    expect(
      buildTwoLibertyDefenderRelevance(topology, graph, endgameGroupId(['w'])),
    ).toBeNull();
  });
});
