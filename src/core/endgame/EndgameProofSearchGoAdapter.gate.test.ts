import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { searchDeterministicAndOrProof } from './DeterministicAndOrProofSearch';
import {
  createEndgameProofSearchGoAdapter,
  createEndgameProofSearchNode,
  transitionEndgameProofSearchMove,
} from './EndgameProofSearchGoAdapter';
import { buildEndgameGraph } from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import { readOneLibertyTactics } from './OneLibertyTacticalReader';
import { readTwoLibertyTacticsPruned } from './TwoLibertyPrunedTacticalReader';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'generic-path-gate-fixture',
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

describe('EndgameProofSearchGoAdapter E2-4c correctness gate', () => {
  it('agrees with strict one-lib positive proofs for both attacker and defender roles', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b']),
      x: Object.freeze(['w', 'b']),
      b: Object.freeze(['w', 'x', 'be']),
      be: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', b: 'black' }));
    const graph = buildEndgameGraph(state, topology);
    const specialised = readOneLibertyTactics(
      state,
      topology,
      graph,
      endgameGroupId(['w']),
    );
    const adapter = createEndgameProofSearchGoAdapter(topology);

    expect(specialised?.attackerFirst.result).toBe('kill');
    expect(specialised?.defenderFirst.result).toBe('forced-kill');

    for (const role of ['attacker', 'defender'] as const) {
      const node = createEndgameProofSearchNode(
        topology,
        state,
        'white',
        Object.freeze(['w']),
        role,
      );
      expect(searchDeterministicAndOrProof(node, adapter)).toMatchObject({
        outcome: 'proven-kill',
        exploredNodes: 1,
        maxDepth: 1,
      });
    }
  });

  it('keeps a one-lib defender escape unresolved instead of manufacturing survival', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b']),
      x: Object.freeze(['w', 'b', 'y', 'z']),
      y: Object.freeze(['x']),
      z: Object.freeze(['x']),
      b: Object.freeze(['w', 'x', 'be']),
      be: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', b: 'black' }));
    const graph = buildEndgameGraph(state, topology);
    const specialised = readOneLibertyTactics(
      state,
      topology,
      graph,
      endgameGroupId(['w']),
    );
    const adapter = createEndgameProofSearchGoAdapter(topology);
    const defenderNode = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );

    expect(specialised?.defenderFirst.result).toBe('escape');
    expect(searchDeterministicAndOrProof(defenderNode, adapter)).toMatchObject({
      outcome: 'unresolved',
      reason: 'defender-move-set-incomplete: go-move-generation-not-installed-e2-4b',
      exploredNodes: 1,
      maxDepth: 1,
    });
  });

  it('agrees with validated two-lib positive proofs for both roles', () => {
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
    const graph = buildEndgameGraph(state, topology);
    const specialised = readTwoLibertyTacticsPruned(
      state,
      topology,
      graph,
      endgameGroupId(['w']),
    );
    const adapter = createEndgameProofSearchGoAdapter(topology);

    expect(specialised?.attackerFirst.result).toBe('forced-kill');
    expect(specialised?.defenderFirst.result).toBe('forced-kill');

    for (const role of ['attacker', 'defender'] as const) {
      const node = createEndgameProofSearchNode(
        topology,
        state,
        'white',
        Object.freeze(['w']),
        role,
      );
      expect(searchDeterministicAndOrProof(node, adapter)).toMatchObject({
        outcome: 'proven-kill',
        exploredNodes: 1,
        maxDepth: 1,
      });
    }
  });

  it('forbids universal conclusions at non-terminal roots while Go move generation is incomplete', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c', 'd']),
      a: Object.freeze(['w']),
      b: Object.freeze(['w']),
      c: Object.freeze(['w']),
      d: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const adapter = createEndgameProofSearchGoAdapter(topology);

    const attacker = searchDeterministicAndOrProof(
      createEndgameProofSearchNode(
        topology,
        state,
        'white',
        Object.freeze(['w']),
        'attacker',
      ),
      adapter,
    );
    const defender = searchDeterministicAndOrProof(
      createEndgameProofSearchNode(
        topology,
        state,
        'white',
        Object.freeze(['w']),
        'defender',
      ),
      adapter,
    );

    expect(attacker).toMatchObject({
      outcome: 'unresolved',
      reason: 'attacker-move-set-incomplete: go-move-generation-not-installed-e2-4b',
      exploredNodes: 1,
      maxDepth: 1,
    });
    expect(defender).toMatchObject({
      outcome: 'unresolved',
      reason: 'defender-move-set-incomplete: go-move-generation-not-installed-e2-4b',
      exploredNodes: 1,
      maxDepth: 1,
    });
    expect(attacker.outcome).not.toBe('proven-survival');
    expect(defender.outcome).not.toBe('proven-kill');
  });

  it('keeps unknown-root simple ko conservative across specialised, transition, and generic layers', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b1', 'b2']),
      x: Object.freeze(['w', 'c1', 'c2']),
      b1: Object.freeze(['w', 'b1e']),
      b1e: Object.freeze(['b1']),
      b2: Object.freeze(['w', 'b2e']),
      b2e: Object.freeze(['b2']),
      c1: Object.freeze(['x', 'c1e']),
      c1e: Object.freeze(['c1']),
      c2: Object.freeze(['x', 'c2e']),
      c2e: Object.freeze(['c2']),
    });
    const state = makeState(
      topology,
      Object.freeze({
        w: 'white',
        c1: 'white',
        c2: 'white',
        b1: 'black',
        b2: 'black',
      }),
    );
    const graph = buildEndgameGraph(state, topology);
    const specialised = readOneLibertyTactics(
      state,
      topology,
      graph,
      endgameGroupId(['w']),
    );
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );

    expect(specialised?.attackerFirst.result).toBe('ko-dependent');
    expect(
      transitionEndgameProofSearchMove(
        node,
        topology,
        Object.freeze({ kind: 'place', point: 'x' }),
      ),
    ).toEqual({ result: 'ko-dependent', reason: 'unknown-root-simple-ko' });

    const generic = searchDeterministicAndOrProof(
      node,
      createEndgameProofSearchGoAdapter(topology),
    );
    expect(generic.outcome).toBe('unresolved');
    expect(generic.outcome).not.toBe('proven-kill');
  });
});
