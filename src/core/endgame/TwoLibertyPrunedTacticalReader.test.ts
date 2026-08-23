import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import {
  TWO_LIBERTY_IRRELEVANCE_CERTIFICATE,
  readTwoLibertyTacticsPruned,
} from './TwoLibertyPrunedTacticalReader';
import { readTwoLibertyTactics } from './TwoLibertyTacticalReader';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'two-liberty-pruned-fixture',
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
    moveNumber: 50,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const readBoth = (topology: Topology, state: GameState, targetGroupKey: string) => {
  const graph = buildEndgameGraph(state, topology);
  return Object.freeze({
    exhaustive: readTwoLibertyTactics(state, topology, graph, targetGroupKey),
    pruned: readTwoLibertyTacticsPruned(state, topology, graph, targetGroupKey),
  });
};

describe('TwoLibertyPrunedTacticalReader', () => {
  it('retains the non-liberty counter-capture preparation branch as deep-relevant', () => {
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

    const { exhaustive, pruned } = readBoth(topology, state, endgameGroupId(['w']));

    expect(exhaustive?.outcome).toBe('unresolved');
    expect(pruned?.outcome).toBe('unresolved');
    expect(pruned?.pruning.deepEvaluatedPoints).toContain('c');
    expect(
      pruned?.defenderFirst.lines.find(
        (line) => line.move.kind === 'place' && line.move.point === 'c',
      ),
    ).toMatchObject({
      result: 'not-proven',
      evaluation: 'deep',
    });
  });

  it('still discovers a remote root-ko branch before applying local pruning', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'q']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['a', 'b', 'q1', 'q2']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),
      k: Object.freeze(['c']),
      c: Object.freeze(['k']),
    });
    const state = makeState(
      topology,
      Object.freeze({ w: 'white', q: 'black', k: 'black' }),
    );

    const { exhaustive, pruned } = readBoth(topology, state, endgameGroupId(['w']));

    expect(exhaustive?.outcome).toBe('ko-dependent');
    expect(pruned?.pruning.relevance.relevantRootPlacements).not.toContain('c');
    expect(pruned?.defenderFirst.lines).toContainEqual({
      move: { kind: 'place', point: 'c' },
      result: 'ko-dependent',
      evaluation: 'root-ko',
    });
    expect(pruned?.outcome).toBe('ko-dependent');
  });

  it('uses the explicit irrelevance certificate only when Pass is already proven losing', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'q']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['a', 'b', 'q1', 'q2']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),
      r: Object.freeze(['x', 'y']),
      x: Object.freeze(['r']),
      y: Object.freeze(['r']),
    });
    const state = makeState(
      topology,
      Object.freeze({ w: 'white', q: 'black', r: 'white' }),
    );

    const { exhaustive, pruned } = readBoth(topology, state, endgameGroupId(['w']));

    expect(exhaustive?.outcome).toBe('proven-dead');
    expect(pruned?.outcome).toBe('proven-dead');
    expect(pruned?.pruning.certifiedIrrelevantPoints).toEqual(['x', 'y']);
    for (const point of ['x', 'y']) {
      expect(
        pruned?.defenderFirst.lines.find(
          (line) => line.move.kind === 'place' && line.move.point === point,
        ),
      ).toMatchObject({
        result: 'forced-kill',
        evaluation: 'certified-irrelevant',
        irrelevanceCertificate: TWO_LIBERTY_IRRELEVANCE_CERTIFICATE,
      });
    }
  });

  it('is deterministic and never upgrades an exhaustive non-proof to proven-dead on a fixed graph corpus', () => {
    const topologies: readonly Topology[] = Object.freeze([
      new TorusTopology(9),
      new CubeTopology(2),
    ]);
    let checkedTargets = 0;

    for (const topology of topologies) {
      const points = [...topology.points()].sort();
      for (let seed = 1; seed <= 8; seed += 1) {
        let value = seed >>> 0;
        const board: Record<PointId, PointOccupancy> = {};
        for (const point of points) {
          value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
          const roll = value % 10;
          board[point] = roll < 3 ? 'black' : roll < 6 ? 'white' : 'empty';
        }
        const state: GameState = Object.freeze({
          board: Object.freeze(board),
          currentPlayer: 'black',
          moveNumber: seed,
          consecutivePasses: 2,
          phase: 'endgame',
          captures: Object.freeze({ black: 0, white: 0 }),
        });
        const graph = buildEndgameGraph(state, topology);

        for (const group of graph.groups.values()) {
          if (group.liberties.length !== 2) continue;
          checkedTargets += 1;
          const exhaustive = readTwoLibertyTactics(state, topology, graph, group.key);
          const first = readTwoLibertyTacticsPruned(state, topology, graph, group.key);
          const second = readTwoLibertyTacticsPruned(state, topology, graph, group.key);

          expect(second).toEqual(first);
          if (first?.outcome === 'proven-dead') {
            expect(exhaustive?.outcome).toBe('proven-dead');
          }
        }
      }
    }

    expect(checkedTargets).toBeGreaterThan(10);
  });

  it('stops conservatively when the relevant deep-placement budget is exceeded', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b']),
      a: Object.freeze(['w', 'q']),
      b: Object.freeze(['w', 'q']),
      q: Object.freeze(['a', 'b', 'q1', 'q2']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', q: 'black' }));
    const graph = buildEndgameGraph(state, topology);

    const result = readTwoLibertyTacticsPruned(
      state,
      topology,
      graph,
      endgameGroupId(['w']),
      Object.freeze({ maxRelevantDefenderPlacements: 1 }),
    );

    expect(result?.defenderFirst.result).toBe('budget-exhausted');
    expect(result?.outcome).toBe('unresolved');
  });
});
