import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import { readOneLibertyTactics } from './OneLibertyTacticalReader';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'one-liberty-fixture',
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
    moveNumber: 12,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const readTarget = (
  topology: Topology,
  state: GameState,
  targetPoints: readonly PointId[] = Object.freeze(['w']),
) => {
  const graph = buildEndgameGraph(state, topology);
  return readOneLibertyTactics(state, topology, graph, endgameGroupId(targetPoints));
};

describe('OneLibertyTacticalReader', () => {
  it('proves dead when the defender has no legal immediate defense', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b']),
      x: Object.freeze(['w', 'b']),
      b: Object.freeze(['w', 'x', 'be']),
      be: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', b: 'black' }));

    const result = readTarget(topology, state);

    expect(result).toMatchObject({
      algorithm: 'one-liberty-tactical-reader-v1',
      crucialStones: ['w'],
      attackPoints: ['x'],
      defensePoints: ['x'],
      attackerFirst: { move: 'x', result: 'kill' },
      defenderFirst: { result: 'forced-kill' },
      outcome: 'proven-dead',
      exploredNodes: 2,
      maxDepth: 1,
      principalVariation: ['x'],
    });
    expect(result?.defenderFirst.lines).toEqual([
      {
        move: 'x',
        reasons: ['extend'],
        result: 'illegal',
        rejectionReason: 'suicide',
      },
    ]);
  });

  it('proves dead when every legal extension is captured on the next move', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b']),
      x: Object.freeze(['w', 'b', 'y']),
      y: Object.freeze(['x']),
      b: Object.freeze(['w', 'x', 'be']),
      be: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', b: 'black' }));

    const result = readTarget(topology, state);

    expect(result?.outcome).toBe('proven-dead');
    expect(result?.maxDepth).toBe(2);
    expect(result?.defenderFirst).toEqual({
      result: 'forced-kill',
      lines: [
        {
          move: 'x',
          reasons: ['extend'],
          result: 'immediately-killed',
          attackerReply: 'y',
        },
      ],
    });
  });

  it('keeps attacker-first kill critical when extending creates two liberties', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b']),
      x: Object.freeze(['w', 'b', 'y', 'z']),
      y: Object.freeze(['x']),
      z: Object.freeze(['x']),
      b: Object.freeze(['w', 'x', 'be']),
      be: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', b: 'black' }));

    const result = readTarget(topology, state);

    expect(result?.attackerFirst.result).toBe('kill');
    expect(result?.defenderFirst.result).toBe('escape');
    expect(result?.outcome).toBe('critical');
    expect(result?.defenderFirst.lines[0]).toMatchObject({
      move: 'x',
      reasons: ['extend'],
      result: 'escapes-immediate-capture',
    });
  });

  it('recognizes a connection through the sole liberty as a legal escape', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b']),
      x: Object.freeze(['w', 'b', 'friend']),
      friend: Object.freeze(['x', 'y', 'z']),
      y: Object.freeze(['friend']),
      z: Object.freeze(['friend']),
      b: Object.freeze(['w', 'x', 'be']),
      be: Object.freeze(['b']),
    });
    const state = makeState(
      topology,
      Object.freeze({ w: 'white', friend: 'white', b: 'black' }),
    );

    const result = readTarget(topology, state);

    expect(result?.outcome).toBe('critical');
    expect(result?.defenderFirst.lines[0]).toEqual({
      move: 'x',
      reasons: ['connect', 'extend'],
      result: 'escapes-immediate-capture',
    });
  });

  it('enumerates a counter-capture of an adjacent attacker in atari', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b']),
      x: Object.freeze(['w']),
      b: Object.freeze(['w', 'c']),
      c: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', b: 'black' }));

    const result = readTarget(topology, state);

    expect(result?.attackPoints).toEqual(['x']);
    expect(result?.defensePoints).toEqual(['c', 'x']);
    expect(result?.defenderFirst.result).toBe('escape');
    expect(result?.outcome).toBe('critical');
    expect(result?.defenderFirst.lines).toContainEqual({
      move: 'c',
      reasons: ['counter-capture'],
      result: 'escapes-immediate-capture',
    });
  });

  it('returns null instead of pretending the one-liberty proof covers wider groups', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'y']),
      x: Object.freeze(['w']),
      y: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));

    expect(readTarget(topology, state)).toBeNull();
  });
});
