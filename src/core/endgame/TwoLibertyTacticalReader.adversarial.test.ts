import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import { readTwoLibertyTactics } from './TwoLibertyTacticalReader';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'two-liberty-adversarial-fixture',
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
    moveNumber: 30,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

describe('TwoLibertyTacticalReader adversarial proof boundary', () => {
  it('refuses automatic dead when any exhaustive defender branch is root-ko dependent', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'q']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['a', 'b', 'q1', 'q2']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),

      // Disjoint root-ko branch. White can play c, capture the one-stone
      // black group k, and leave the newly played one-stone string with only
      // the captured point k as a liberty. Without the actual preceding board
      // this legal-defense branch must stay conservative.
      k: Object.freeze(['c']),
      c: Object.freeze(['k']),
    });
    const state = makeState(
      topology,
      Object.freeze({ w: 'white', q: 'black', k: 'black' }),
    );
    const graph = buildEndgameGraph(state, topology);

    const result = readTwoLibertyTactics(
      state,
      topology,
      graph,
      endgameGroupId(['w']),
    );

    expect(result?.attackerFirst.result).toBe('forced-kill');
    expect(result?.defenderFirst.lines).toContainEqual({
      move: { kind: 'place', point: 'c' },
      result: 'ko-dependent',
    });
    expect(result?.defenderFirst.result).toBe('ko-dependent');
    expect(result?.outcome).toBe('ko-dependent');
  });

  it('remains unresolved, never dead, when a ko branch coexists with another unproven defense', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'q']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['a', 'b']),
      k: Object.freeze(['c']),
      c: Object.freeze(['k']),
    });
    const state = makeState(
      topology,
      Object.freeze({ w: 'white', q: 'black', k: 'black' }),
    );
    const graph = buildEndgameGraph(state, topology);

    const first = readTwoLibertyTactics(state, topology, graph, endgameGroupId(['w']));
    const second = readTwoLibertyTactics(state, topology, graph, endgameGroupId(['w']));

    expect(first?.defenderFirst.lines).toContainEqual({
      move: { kind: 'place', point: 'c' },
      result: 'ko-dependent',
    });
    expect(first?.defenderFirst.result).toBe('unresolved');
    expect(first?.outcome).toBe('unresolved');
    expect(second).toEqual(first);
  });
});
