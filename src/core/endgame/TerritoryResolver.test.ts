import { describe, expect, it } from 'vitest';
import type { EndgameClassification, GroupStatus } from './EndgameClassifier';
import { endgameGroupId } from './EndgameGroupIdentity';
import { resolveTerritory } from './TerritoryResolver';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';

class GraphTopology implements Topology {
  readonly id = 'work8-territory-opaque-graph';
  private readonly allPoints: readonly PointId[];

  constructor(private readonly adjacency: Readonly<Record<PointId, readonly PointId[]>>) {
    this.allPoints = Object.freeze(Object.keys(adjacency));
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  neighbors(point: PointId): readonly PointId[] {
    const neighbors = this.adjacency[point];
    if (!neighbors) throw new Error(`Unknown point: ${point}`);
    return neighbors;
  }

  has(point: PointId): boolean {
    return Object.prototype.hasOwnProperty.call(this.adjacency, point);
  }
}

const makeState = (
  topology: Topology,
  occupancy: Readonly<Record<PointId, PointOccupancy>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) {
    const value = occupancy[point];
    if (!value) throw new Error(`Missing test occupancy: ${point}`);
    board[point] = value;
  }

  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const classification = (
  entries: readonly (readonly [PointId, GroupStatus])[],
): EndgameClassification =>
  Object.freeze(
    entries.map(([point, status]) =>
      Object.freeze({
        points: Object.freeze([point]),
        status,
        source: 'user' as const,
      }),
    ),
  );

describe('TerritoryResolver Work 8A/8B', () => {
  it('virtually removes dead stones and flood-fills through the removed points without mutating GameState', () => {
    const topology = new GraphTopology({
      'black-left': ['empty-left'],
      'empty-left': ['black-left', 'dead-white'],
      'dead-white': ['empty-left', 'empty-right'],
      'empty-right': ['dead-white', 'black-right'],
      'black-right': ['empty-right'],
    });
    const state = makeState(topology, {
      'black-left': 'black',
      'empty-left': 'empty',
      'dead-white': 'white',
      'empty-right': 'empty',
      'black-right': 'black',
    });

    const result = resolveTerritory(
      state,
      classification([['dead-white', 'dead']]),
      topology,
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]).toMatchObject({
      points: ['dead-white', 'empty-left', 'empty-right'],
      borderingColors: ['black'],
      touchesSeki: false,
      owner: 'BLACK',
    });
    expect(result.regions[0].borderingGroups).toEqual([
      endgameGroupId(['black-left']),
      endgameGroupId(['black-right']),
    ]);
    expect(result.regionByPoint.get('dead-white')).toBe(result.regions[0].key);
    expect(state.board['dead-white']).toBe('white');
  });

  it('removes only dead classifications; alive, seki and unclassified stones survive the virtual view', () => {
    const topology = new GraphTopology({
      alive: [],
      dead: [],
      seki: [],
      unclassified: [],
    });
    const state = makeState(topology, {
      alive: 'black',
      dead: 'white',
      seki: 'black',
      unclassified: 'white',
    });

    const result = resolveTerritory(
      state,
      classification([
        ['alive', 'alive'],
        ['dead', 'dead'],
        ['seki', 'seki'],
      ]),
      topology,
    );

    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].points).toEqual(['dead']);
    expect(result.regions[0].touchesSeki).toBe(false);
    expect(result.regions[0].owner).toBe('NEUTRAL');
    expect(result.regionByPoint.has('alive')).toBe(false);
    expect(result.regionByPoint.has('seki')).toBe(false);
    expect(result.regionByPoint.has('unclassified')).toBe(false);
  });

  it('classifies a region bordered by one white color as WHITE', () => {
    const topology = new GraphTopology({
      'white-a': ['void'],
      void: ['white-a', 'white-b'],
      'white-b': ['void'],
    });
    const state = makeState(topology, {
      'white-a': 'white',
      void: 'empty',
      'white-b': 'white',
    });

    const [region] = resolveTerritory(state, Object.freeze([]), topology).regions;

    expect(region.owner).toBe('WHITE');
    expect(region.touchesSeki).toBe(false);
    expect(region.borderingColors).toEqual(['white']);
    expect(region.borderingGroups).toEqual([
      endgameGroupId(['white-a']),
      endgameGroupId(['white-b']),
    ]);
  });

  it('marks a single-color region touching classified seki as neutral', () => {
    const topology = new GraphTopology({
      'seki-black': ['shared-empty'],
      'shared-empty': ['seki-black', 'alive-black'],
      'alive-black': ['shared-empty'],
    });
    const state = makeState(topology, {
      'seki-black': 'black',
      'shared-empty': 'empty',
      'alive-black': 'black',
    });

    const [region] = resolveTerritory(
      state,
      classification([
        ['seki-black', 'seki'],
        ['alive-black', 'alive'],
      ]),
      topology,
    ).regions;

    expect(region.points).toEqual(['shared-empty']);
    expect(region.borderingColors).toEqual(['black']);
    expect(region.touchesSeki).toBe(true);
    expect(region.owner).toBe('NEUTRAL');
  });

  it('keeps mixed-color dame neutral without misclassifying it as seki', () => {
    const topology = new GraphTopology({
      black: ['dame'],
      dame: ['black', 'white'],
      white: ['dame'],
    });
    const state = makeState(topology, {
      black: 'black',
      dame: 'empty',
      white: 'white',
    });

    const [region] = resolveTerritory(state, Object.freeze([]), topology).regions;

    expect(region.points).toEqual(['dame']);
    expect(region.borderingColors).toEqual(['black', 'white']);
    expect(region.touchesSeki).toBe(false);
    expect(region.owner).toBe('NEUTRAL');
  });

  it('uses only Topology.neighbors() to connect opaque empty points', () => {
    const topology = new GraphTopology({
      boundary: ['portal-one'],
      'portal-one': ['boundary', 'totally-unrelated-name'],
      'totally-unrelated-name': ['portal-one'],
    });
    const state = makeState(topology, {
      boundary: 'black',
      'portal-one': 'empty',
      'totally-unrelated-name': 'empty',
    });

    const [region] = resolveTerritory(state, Object.freeze([]), topology).regions;

    expect(region.points).toEqual(['portal-one', 'totally-unrelated-name']);
    expect(region.owner).toBe('BLACK');
    expect(region.touchesSeki).toBe(false);
    expect(region.borderingGroups).toEqual([endgameGroupId(['boundary'])]);
  });

  it('rejects classification that points outside the topology', () => {
    const topology = new GraphTopology({ only: [] });
    const state = makeState(topology, { only: 'black' });

    expect(() =>
      resolveTerritory(state, classification([['missing', 'dead']]), topology),
    ).toThrow('Classification contains unknown point: missing');
  });

  it('rejects classification of an empty point', () => {
    const topology = new GraphTopology({ only: [] });
    const state = makeState(topology, { only: 'empty' });

    expect(() => resolveTerritory(state, classification([['only', 'dead']]), topology)).toThrow(
      'Classification point is not occupied by a stone: only',
    );
  });

  it('rejects conflicting statuses for the same stone', () => {
    const topology = new GraphTopology({ only: [] });
    const state = makeState(topology, { only: 'black' });

    expect(() =>
      resolveTerritory(
        state,
        classification([
          ['only', 'alive'],
          ['only', 'dead'],
        ]),
        topology,
      ),
    ).toThrow('Conflicting classification for point: only');
  });
});
