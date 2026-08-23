import { describe, expect, it } from 'vitest';
import type { BoardOccupancy, GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { searchDeterministicAndOrProof } from './DeterministicAndOrProofSearch';
import {
  createEndgameProofSearchGoAdapter,
  createEndgameProofSearchNode,
  endgameProofSearchNodeKey,
  evaluateEndgameSpecialisedTerminal,
  transitionEndgameProofSearchMove,
} from './EndgameProofSearchGoAdapter';
import { buildEndgameGraph } from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import { readOneLibertyTactics } from './OneLibertyTacticalReader';
import { readTwoLibertyTacticsPruned } from './TwoLibertyPrunedTacticalReader';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'generic-go-adapter-fixture',
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

const cloneBoard = (board: BoardOccupancy): BoardOccupancy => Object.freeze({ ...board });

describe('EndgameProofSearchGoAdapter', () => {
  it('differentially maps a strict one-lib attacker proof to generic proven-kill', () => {
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
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const generic = searchDeterministicAndOrProof(
      node,
      createEndgameProofSearchGoAdapter(topology),
    );

    expect(specialised?.attackerFirst.result).toBe('kill');
    expect(generic).toMatchObject({
      outcome: 'proven-kill',
      reason: 'one-liberty-attacker-proof',
      exploredNodes: 1,
      maxDepth: 1,
    });
  });

  it('differentially maps a strict one-lib defender AND proof to generic proven-kill', () => {
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
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );

    expect(specialised?.defenderFirst.result).toBe('forced-kill');
    expect(evaluateEndgameSpecialisedTerminal(node, topology)).toEqual({
      outcome: 'proven-kill',
      reason: 'one-liberty-defender-proof',
    });
  });

  it('does not map one-lib defender escape to survival', () => {
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
    const defenderNode = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );
    const attackerNode = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const adapter = createEndgameProofSearchGoAdapter(topology);

    expect(specialised?.outcome).toBe('critical');
    expect(specialised?.defenderFirst.result).toBe('escape');
    expect(searchDeterministicAndOrProof(defenderNode, adapter)).toMatchObject({
      outcome: 'unresolved',
      reason: 'defender-move-set-incomplete: go-move-generation-not-installed-e2-4b',
    });
    expect(searchDeterministicAndOrProof(attackerNode, adapter)).toMatchObject({
      outcome: 'proven-kill',
      reason: 'one-liberty-attacker-proof',
    });
  });

  it('differentially maps validated two-lib attacker and defender proofs', () => {
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
    const targetKey = endgameGroupId(['w']);
    const specialised = readTwoLibertyTacticsPruned(state, topology, graph, targetKey);
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
      expect(searchDeterministicAndOrProof(node, adapter).outcome).toBe('proven-kill');
    }
  });

  it('keeps an unresolved two-lib specialised case unresolved in the generic bridge', () => {
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
    const graph = buildEndgameGraph(state, topology);
    const specialised = readTwoLibertyTacticsPruned(
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
      'defender',
    );

    expect(specialised?.outcome).toBe('unresolved');
    expect(
      searchDeterministicAndOrProof(node, createEndgameProofSearchGoAdapter(topology)),
    ).toMatchObject({
      outcome: 'unresolved',
      reason: 'defender-move-set-incomplete: go-move-generation-not-installed-e2-4b',
    });
  });

  it('treats captured crucial stones as a direct generic terminal proof', () => {
    const topology = makeTopology({
      w: Object.freeze(['x']),
      x: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({}));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );

    expect(evaluateEndgameSpecialisedTerminal(node, topology)).toEqual({
      outcome: 'proven-kill',
      reason: 'target-crucial-stones-captured',
    });
  });

  it('applies ordinary placements through GameEngine and carries exact previousBoard forward', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'y']),
      x: Object.freeze(['w', 'xe']),
      xe: Object.freeze(['x']),
      y: Object.freeze(['w', 'ye']),
      ye: Object.freeze(['y']),
      z: Object.freeze(['ze']),
      ze: Object.freeze(['z']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );

    const transition = transitionEndgameProofSearchMove(
      node,
      topology,
      Object.freeze({ kind: 'place', point: 'z' }),
    );

    expect(transition.result).toBe('accepted');
    if (transition.result !== 'accepted') return;
    expect(transition.node.role).toBe('defender');
    expect(transition.node.state.board.z).toBe('black');
    expect(transition.node.state.currentPlayer).toBe('white');
    expect(transition.node.previousBoard).toBe(state.board);
  });

  it('rejects illegal authoritative transitions instead of manufacturing a child', () => {
    const topology = makeTopology({
      w: Object.freeze(['x']),
      x: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );

    expect(
      transitionEndgameProofSearchMove(
        node,
        topology,
        Object.freeze({ kind: 'place', point: 'w' }),
      ),
    ).toEqual({ result: 'illegal', reason: 'occupied' });
  });

  it('marks an unknown-history root simple-ko-shaped placement ko-dependent', () => {
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
    const unknownHistoryNode = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const knownHistoryNode = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
      cloneBoard(state.board),
    );

    expect(
      transitionEndgameProofSearchMove(
        unknownHistoryNode,
        topology,
        Object.freeze({ kind: 'place', point: 'x' }),
      ),
    ).toEqual({ result: 'ko-dependent', reason: 'unknown-root-simple-ko' });

    const known = transitionEndgameProofSearchMove(
      knownHistoryNode,
      topology,
      Object.freeze({ kind: 'place', point: 'x' }),
    );
    expect(known.result).toBe('accepted');
  });

  it('treats Pass as an authoritative role-changing transition and carries history', () => {
    const topology = makeTopology({
      w: Object.freeze(['x']),
      x: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );

    const transition = transitionEndgameProofSearchMove(
      node,
      topology,
      Object.freeze({ kind: 'pass' }),
    );

    expect(transition.result).toBe('accepted');
    if (transition.result !== 'accepted') return;
    expect(transition.node.role).toBe('attacker');
    expect(transition.node.state.currentPlayer).toBe('black');
    expect(transition.node.previousBoard).toBe(state.board);
  });

  it('includes previousBoard and role in the deterministic node key', () => {
    const topology = makeTopology({
      w: Object.freeze(['x']),
      x: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const attacker = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const defender = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );
    const withHistory = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
      cloneBoard(state.board),
    );

    expect(endgameProofSearchNodeKey(attacker, topology)).not.toBe(
      endgameProofSearchNodeKey(defender, topology),
    );
    expect(endgameProofSearchNodeKey(attacker, topology)).not.toBe(
      endgameProofSearchNodeKey(withHistory, topology),
    );
  });

  it('rejects an empty or unknown crucial-stone identity', () => {
    const topology = makeTopology({
      w: Object.freeze(['x']),
      x: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));

    expect(() =>
      createEndgameProofSearchNode(topology, state, 'white', Object.freeze([]), 'attacker'),
    ).toThrow('at least one crucial stone');
    expect(() =>
      createEndgameProofSearchNode(
        topology,
        state,
        'white',
        Object.freeze(['missing']),
        'attacker',
      ),
    ).toThrow('Unknown crucial stone point: missing');
  });
});
