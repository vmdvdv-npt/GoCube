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

const readTarget = (
  topology: Topology,
  state: GameState,
  maxDefenderPlacements?: number,
) => {
  const graph = buildEndgameGraph(state, topology);
  return readTwoLibertyTactics(
    state,
    topology,
    graph,
    endgameGroupId(['w']),
    maxDefenderPlacements === undefined
      ? undefined
      : Object.freeze({ maxDefenderPlacements }),
  );
};

describe('TwoLibertyTacticalReader', () => {
  it('proves dead only after exhausting every legal defender placement plus pass', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'q']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['a', 'b', 'q1', 'q2']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', q: 'black' }));

    const result = readTarget(topology, state);

    expect(result?.algorithm).toBe('two-liberty-exhaustive-reader-v2');
    expect(result?.attackPoints).toEqual(['a', 'b']);
    expect(result?.attackerFirst.result).toBe('forced-kill');
    expect(result?.defenderFirst.result).toBe('forced-kill');
    expect(result?.defenderFirst.includesPass).toBe(true);
    expect(result?.defenderFirst.examinedPlacements).toBe(4);
    expect(result?.defenderFirst.legalPlacements).toBe(2);
    // a/b are correctly rejected by GameEngine as suicide; q1/q2 are the only
    // legal placements, and Pass is the third complete defender branch.
    expect(result?.defenderFirst.lines).toHaveLength(3);
    expect(result?.defenderFirst.lines.every((line) => line.result === 'forced-kill')).toBe(true);
    expect(result?.outcome).toBe('proven-dead');
  });

  it('keeps the position unresolved when defender can extend into wider liberties', () => {
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
    expect(result?.defenderFirst.result).toBe('unresolved');
    expect(result?.outcome).toBe('unresolved');
    expect(result?.defenderFirst.lines.some((line) => line.result === 'not-proven')).toBe(true);
  });

  it('finds a legal non-liberty preparation move that defeats the naive liberties-only defender model', () => {
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
    });
    const state = makeState(
      topology,
      Object.freeze({ w: 'white', anchor: 'black', q: 'black' }),
    );

    const result = readTarget(topology, state);

    // With attacker to move immediately, either target liberty reduces to the
    // strict one-liberty forced kill.
    expect(result?.attackerFirst.result).toBe('forced-kill');

    // Defender-first can legally play c because c1 remains a liberty. That
    // puts q in atari. After the attacker reduces the target, defender can
    // capture q and create a new target liberty. c is not one of the target's
    // original liberties, so a liberties-only defender model would miss it.
    const preparation = result?.defenderFirst.lines.find(
      (line) => line.move.kind === 'place' && line.move.point === 'c',
    );
    expect(preparation).toMatchObject({
      move: { kind: 'place', point: 'c' },
      result: 'not-proven',
      targetLibertiesAfter: ['a', 'b'],
    });
    expect(result?.defenderFirst.result).toBe('unresolved');
    expect(result?.outcome).toBe('unresolved');
  });

  it('stops safely when the deterministic full-board defender placement budget is exceeded', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'q']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['a', 'b', 'q1', 'q2']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', q: 'black' }));

    const result = readTarget(topology, state, 2);

    expect(result?.attackerFirst.result).toBe('forced-kill');
    expect(result?.defenderFirst).toMatchObject({
      result: 'budget-exhausted',
      examinedPlacements: 0,
      legalPlacements: 0,
      includesPass: true,
      placementBudget: 2,
    });
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
