import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { CubeTopology } from '../topology/CubeTopology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph } from './EndgameGraphCore';
import {
  SMALL_EYE_SPACE_ALGORITHM,
  analyzeSmallEyeSpace,
} from './SmallEyeSpaceAnalyzer';

const makeTopology = (
  adjacency: Readonly<Record<PointId, readonly PointId[]>>,
): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'small-eye-fixture',
    points: () => points,
    neighbors: (point: PointId) => adjacency[point] ?? Object.freeze([]),
    has: (point: PointId) => Object.prototype.hasOwnProperty.call(adjacency, point),
  });
};

const makeState = (
  board: Readonly<Record<PointId, PointOccupancy>>,
): GameState =>
  Object.freeze({
    board,
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });

const makeFilledState = (
  topology: Topology,
  emptyPoints: readonly PointId[],
): GameState => {
  const empty = new Set(emptyPoints);
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) {
    board[point] = empty.has(point) ? 'empty' : 'black';
  }
  return makeState(Object.freeze(board));
};

const groupKeyAt = (
  state: GameState,
  topology: Topology,
  point: PointId,
): string => {
  const key = buildEndgameGraph(state, topology).pointOwner.get(point);
  if (!key) throw new Error(`Expected group at ${point}`);
  return key;
};

describe('SmallEyeSpaceAnalyzer', () => {
  it('keeps two sealed one-point eyes exact without promoting them to fate', () => {
    const topology = makeTopology({
      b1: Object.freeze(['b2', 'e1', 'e2']),
      b2: Object.freeze(['b1', 'e1', 'e2']),
      e1: Object.freeze(['b1', 'b2']),
      e2: Object.freeze(['b1', 'b2']),
    });
    const state = makeState(
      Object.freeze({
        b1: 'black',
        b2: 'black',
        e1: 'empty',
        e2: 'empty',
      }),
    );
    const result = analyzeSmallEyeSpace(
      state,
      topology,
      groupKeyAt(state, topology, 'b1'),
    );

    expect(result).not.toBeNull();
    expect(result?.algorithm).toBe(SMALL_EYE_SPACE_ALGORITHM);
    expect(result?.complete).toBe(true);
    expect(result?.minEyes).toBe(2);
    expect(result?.maxEyes).toBe(2);
    expect(result?.attackVitalPoints).toEqual([]);
    expect(result?.defenseVitalPoints).toEqual([]);
  });

  it('recognizes a capturable one-point false eye through authoritative legality', () => {
    const topology = makeTopology({
      b1: Object.freeze(['b2', 'eye']),
      b2: Object.freeze(['b1', 'eye']),
      eye: Object.freeze(['b1', 'b2']),
    });
    const state = makeState(
      Object.freeze({
        b1: 'black',
        b2: 'black',
        eye: 'empty',
      }),
    );
    const result = analyzeSmallEyeSpace(
      state,
      topology,
      groupKeyAt(state, topology, 'b1'),
    );

    expect(result?.complete).toBe(true);
    expect(result?.minEyes).toBe(0);
    expect(result?.maxEyes).toBe(0);
    expect(result?.attackVitalPoints).toEqual(['eye']);
    expect(result?.defenseVitalPoints).toEqual([]);
  });

  it('finds the exact split point of a three-point eye space for both move orders', () => {
    const topology = makeTopology({
      t: Object.freeze(['a', 'b', 'c']),
      a: Object.freeze(['t', 'b']),
      b: Object.freeze(['t', 'a', 'c']),
      c: Object.freeze(['t', 'b']),
    });
    const state = makeState(
      Object.freeze({
        t: 'black',
        a: 'empty',
        b: 'empty',
        c: 'empty',
      }),
    );
    const result = analyzeSmallEyeSpace(
      state,
      topology,
      groupKeyAt(state, topology, 't'),
    );

    expect(result?.complete).toBe(true);
    expect(result?.regions).toHaveLength(1);
    expect(result?.minEyes).toBe(0);
    expect(result?.maxEyes).toBe(2);
    expect(result?.attackVitalPoints).toEqual(['b']);
    expect(result?.defenseVitalPoints).toEqual(['b']);
  });

  it('keeps mixed-color shared space non-strict and fail-closed', () => {
    const topology = makeTopology({
      b: Object.freeze(['x']),
      w: Object.freeze(['x']),
      x: Object.freeze(['b', 'w']),
    });
    const state = makeState(
      Object.freeze({
        b: 'black',
        w: 'white',
        x: 'empty',
      }),
    );
    const result = analyzeSmallEyeSpace(
      state,
      topology,
      groupKeyAt(state, topology, 'b'),
    );
    const region = result?.regions[0];

    expect(region?.boundary).toBe('shared-space');
    expect(region?.complete).toBe(false);
    expect(region?.minEyes).toBe(0);
    expect(region?.maxEyes).toBe(1);
    expect(region?.attackVitalPoints).toEqual([]);
    expect(region?.defenseVitalPoints).toEqual([]);
    expect(region?.unresolvedReasons).toEqual(['shared-space']);
  });

  it('keeps same-color shared boundary separate from strict eye-space proof', () => {
    const topology = makeTopology({
      b1: Object.freeze(['x']),
      b2: Object.freeze(['x']),
      x: Object.freeze(['b1', 'b2']),
    });
    const state = makeState(
      Object.freeze({
        b1: 'black',
        b2: 'black',
        x: 'empty',
      }),
    );
    const result = analyzeSmallEyeSpace(
      state,
      topology,
      groupKeyAt(state, topology, 'b1'),
    );

    expect(result?.regions[0]?.boundary).toBe('friendly-shared-boundary');
    expect(result?.regions[0]?.complete).toBe(false);
    expect(result?.regions[0]?.unresolvedReasons).toEqual([
      'friendly-shared-boundary',
    ]);
  });

  it('treats a Torus seam as an ordinary graph edge inside one eye space', () => {
    const topology = new TorusTopology(9);
    const state = makeFilledState(topology, ['0,0', '8,0', '4,4']);
    const result = analyzeSmallEyeSpace(
      state,
      topology,
      groupKeyAt(state, topology, '1,0'),
    );
    const seamRegion = result?.regions.find((region) =>
      region.points.includes('0,0'),
    );

    expect(seamRegion?.points).toEqual(['0,0', '8,0']);
    expect(seamRegion?.boundary).toBe('strict-target-boundary');
    expect(seamRegion?.complete).toBe(true);
  });

  it('treats a Cube face edge as an ordinary graph edge inside one eye space', () => {
    const topology = new CubeTopology(2);
    const state = makeFilledState(topology, [
      'front:0:1',
      'right:0:0',
      'back:1:1',
    ]);
    const result = analyzeSmallEyeSpace(
      state,
      topology,
      groupKeyAt(state, topology, 'front:0:0'),
    );
    const edgeRegion = result?.regions.find((region) =>
      region.points.includes('front:0:1'),
    );

    expect(edgeRegion?.points).toEqual(['front:0:1', 'right:0:0']);
    expect(edgeRegion?.boundary).toBe('strict-target-boundary');
    expect(edgeRegion?.complete).toBe(true);
  });

  it('fails closed on a deliberately exhausted exact-search budget', () => {
    const topology = makeTopology({
      t: Object.freeze(['a', 'b', 'c']),
      a: Object.freeze(['t', 'b']),
      b: Object.freeze(['t', 'a', 'c']),
      c: Object.freeze(['t', 'b']),
    });
    const state = makeState(
      Object.freeze({
        t: 'black',
        a: 'empty',
        b: 'empty',
        c: 'empty',
      }),
    );
    const result = analyzeSmallEyeSpace(
      state,
      topology,
      groupKeyAt(state, topology, 't'),
      { nodeBudget: 1 },
    );

    expect(result?.complete).toBe(false);
    expect(result?.attackVitalPoints).toEqual([]);
    expect(result?.defenseVitalPoints).toEqual([]);
    expect(result?.unresolvedReasons).toContain('node-budget-exhausted');
  });

  it('is deterministic for identical graph-native input', () => {
    const topology = makeTopology({
      t: Object.freeze(['a', 'b', 'c']),
      a: Object.freeze(['t', 'b']),
      b: Object.freeze(['t', 'a', 'c']),
      c: Object.freeze(['t', 'b']),
    });
    const state = makeState(
      Object.freeze({
        t: 'black',
        a: 'empty',
        b: 'empty',
        c: 'empty',
      }),
    );
    const target = groupKeyAt(state, topology, 't');

    expect(analyzeSmallEyeSpace(state, topology, target)).toEqual(
      analyzeSmallEyeSpace(state, topology, target),
    );
  });
});
