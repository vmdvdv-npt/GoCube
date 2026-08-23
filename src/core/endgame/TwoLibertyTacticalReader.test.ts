import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import { readTwoLibertyTactics } from './TwoLibertyTacticalReader';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'two-liberty-fixture',
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
    moveNumber: 20,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const readTarget = (topology: Topology, state: GameState) => {
  const graph = buildEndgameGraph(state, topology);
  return readTwoLibertyTactics(state, topology, graph, endgameGroupId(['w']));
};

describe('TwoLibertyTacticalReader', () => {
  it('proves an attacker-first reduction when one liberty leads to the strict one-liberty forced kill', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'ae1', 'ae2']),
      ae1: Object.freeze(['a']),
      ae2: Object.freeze(['a']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['b', 'q1', 'q2']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', q: 'black' }));

    const result = readTarget(topology, state);

    expect(result?.algorithm).toBe('two-liberty-reduction-reader-v1');
    expect(result?.attackPoints).toEqual(['a', 'b']);
    expect(result?.attackerFirst.result).toBe('forced-kill');
    expect(result?.attackerFirst.winningMoves).toEqual(['a']);
    expect(result?.defenderFirst).toEqual({
      result: 'unresolved',
      reason: 'complete-defender-move-set-not-proven',
    });
    expect(result?.outcome).toBe('unresolved');

    const winningLine = result?.attackerFirst.lines.find((line) => line.move === 'a');
    expect(winningLine).toMatchObject({
      result: 'forced-kill',
      remainingLiberties: ['b'],
      oneLibertyProof: {
        defenderFirst: { result: 'forced-kill' },
      },
    });
  });

  it('does not claim an attacker-first kill when either reduction allows an immediate escape', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'ae1', 'ae2']),
      ae1: Object.freeze(['a']),
      ae2: Object.freeze(['a']),
      b: Object.freeze(['w', 'be1', 'be2']),
      be1: Object.freeze(['b']),
      be2: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));

    const result = readTarget(topology, state);

    expect(result?.attackerFirst.result).toBe('unresolved');
    expect(result?.attackerFirst.winningMoves).toEqual([]);
    expect(result?.attackerFirst.lines.every((line) => line.result === 'not-proven')).toBe(true);
    expect(result?.outcome).toBe('unresolved');
  });

  it('keeps the overall result unresolved even after proving attacker-first kill', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'ae1', 'ae2']),
      ae1: Object.freeze(['a']),
      ae2: Object.freeze(['a']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['b', 'q1', 'q2']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', q: 'black' }));

    const result = readTarget(topology, state);

    expect(result?.attackerFirst.result).toBe('forced-kill');
    expect(result?.outcome).toBe('unresolved');
  });

  it('returns null outside its exact two-liberty scope', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c']),
      a: Object.freeze(['w']),
      b: Object.freeze(['w']),
      c: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));

    expect(readTarget(topology, state)).toBeNull();
  });
});
