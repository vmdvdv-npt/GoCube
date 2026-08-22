import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { endgameGroupId } from './EndgameGroupIdentity';
import { ManualEndgameClassifier } from './ManualEndgameClassifier';

const makeState = (
  topology: Topology,
  stones: Readonly<Partial<Record<PointId, PointOccupancy>>> = {},
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';

  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const analyze = async (
  topology: Topology,
  state: GameState,
  groups: readonly (readonly PointId[])[],
) => new ManualEndgameClassifier().analyze({ state, topology, groups });

describe('ManualEndgameClassifier', () => {
  it('returns every requested stone group as unresolved', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, {
      '0,0': 'black',
      '0,1': 'black',
      '4,4': 'white',
    });

    await expect(analyze(topology, state, [['4,4'], ['0,1', '0,0']])).resolves.toEqual([
      { points: ['0,0', '0,1'], status: 'unresolved' },
      { points: ['4,4'], status: 'unresolved' },
    ]);
  });

  it('canonical group identity is independent of PointId order', () => {
    expect(endgameGroupId(['z', 'a', 'm'])).toBe(endgameGroupId(['m', 'z', 'a']));
    expect(endgameGroupId(['z', 'a', 'm'])).toBe('["a","m","z"]');
  });

  it('recognizes a complete group that crosses a torus wraparound seam', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, { '0,0': 'black', '8,0': 'black' });

    await expect(analyze(topology, state, [['8,0', '0,0']])).resolves.toEqual([
      { points: ['0,0', '8,0'], status: 'unresolved' },
    ]);
  });

  it('uses the same contract on CubeTopology', async () => {
    const topology = new CubeTopology(2);
    const state = makeState(topology, {
      'front:0:0': 'black',
      'front:0:1': 'black',
      'back:1:1': 'white',
    });

    await expect(
      analyze(topology, state, [['back:1:1'], ['front:0:1', 'front:0:0']]),
    ).resolves.toEqual([
      { points: ['back:1:1'], status: 'unresolved' },
      { points: ['front:0:0', 'front:0:1'], status: 'unresolved' },
    ]);
  });

  it('rejects duplicate, overlapping, incomplete and invalid logical groups', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, { '0,0': 'black', '8,0': 'black' });
    const complete = ['0,0', '8,0'] as const;

    await expect(analyze(topology, state, [complete, [...complete].reverse()])).rejects.toThrow(
      'Duplicate group requested for analysis',
    );
    await expect(analyze(topology, state, [['0,0']])).rejects.toThrow(
      'Requested group is not a complete stone group',
    );
    await expect(analyze(topology, state, [['void']])).rejects.toThrow(
      'Requested group contains unknown point',
    );
  });

  it('does not mutate GameState or requested groups', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, { '0,0': 'black', '8,0': 'black' });
    const group = ['8,0', '0,0'];
    const beforeState = JSON.stringify(state);
    const beforeGroup = JSON.stringify(group);

    const result = await analyze(topology, state, [group]);

    expect(JSON.stringify(state)).toBe(beforeState);
    expect(JSON.stringify(group)).toBe(beforeGroup);
    expect(result[0]?.points).not.toBe(group);
  });

  it('uses only abstract PointId and Topology connectivity', async () => {
    const points = ['alpha', 'beta', 'white-stone', 'void'] as const;
    const adjacency: Readonly<Record<string, readonly PointId[]>> = {
      alpha: ['beta', 'void'],
      beta: ['alpha', 'void'],
      'white-stone': ['void'],
      void: ['alpha', 'beta', 'white-stone'],
    };
    const topology: Topology = {
      id: 'abstract-test-topology',
      points: () => points,
      has: (point) => points.includes(point as (typeof points)[number]),
      neighbors: (point) => adjacency[point] ?? [],
    };
    const state = makeState(topology, {
      alpha: 'black',
      beta: 'black',
      'white-stone': 'white',
    });

    await expect(analyze(topology, state, [['beta', 'alpha'], ['white-stone']])).resolves.toEqual([
      { points: ['alpha', 'beta'], status: 'unresolved' },
      { points: ['white-stone'], status: 'unresolved' },
    ]);
  });
});
