import { describe, expect, it } from 'vitest';
import type {
  BoardOccupancy,
  GameState,
  PointOccupancy,
} from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { searchDeterministicAndOrProof } from './DeterministicAndOrProofSearch';
import {
  ENDGAME_GO_MOVE_GENERATION_BOUNDARY,
  createEndgameProofSearchNode,
} from './EndgameProofSearchGoAdapter';
import {
  THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
  THREE_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY,
  createThreeLibertyProofSearchGoAdapter,
} from './ThreeLibertyProofSearchGoAdapter';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'three-liberty-proof-search-fixture',
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

const cloneBoard = (board: BoardOccupancy): BoardOccupancy =>
  Object.freeze({ ...board });

const forcedThreeLibertyFixture = () => {
  const topology = makeTopology({
    w: Object.freeze(['a', 'b', 'c']),
    q: Object.freeze(['a', 'b', 'c']),
    a: Object.freeze(['q', 'w']),
    b: Object.freeze(['q', 'w']),
    c: Object.freeze(['q', 'w']),
  });
  const state = makeState(
    topology,
    Object.freeze({ w: 'white', q: 'black' }),
  );
  return Object.freeze({ topology, state });
};

const moveKeys = (
  topology: Topology,
  node: ReturnType<typeof createEndgameProofSearchNode>,
): readonly string[] => {
  const adapter = createThreeLibertyProofSearchGoAdapter(topology);
  return Object.freeze(
    adapter.expand(node).moves.map((move) => adapter.moveKey(move)),
  );
};

describe('ThreeLibertyProofSearchGoAdapter E2-5', () => {
  it('generates only legal current-liberty attacker reductions and keeps them explicit incomplete', () => {
    const { topology, state } = forcedThreeLibertyFixture();
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const adapter = createThreeLibertyProofSearchGoAdapter(topology);
    const expansion = adapter.expand(node);

    expect(expansion.completeness).toEqual({
      kind: 'incomplete',
      reason: THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
    });
    expect(moveKeys(topology, node)).toEqual([
      'place:a',
      'place:b',
      'place:c',
    ]);

    expect(searchDeterministicAndOrProof(node, adapter)).toMatchObject({
      outcome: 'proven-kill',
      reason: 'attacker-winning-branch',
      exploredNodes: 2,
      maxDepth: 2,
      principalVariation: ['place:a'],
    });
  });

  it('uses a complete whole-board defender set plus Pass and can prove forced kill', () => {
    const { topology, state } = forcedThreeLibertyFixture();
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );
    const adapter = createThreeLibertyProofSearchGoAdapter(topology);
    const expansion = adapter.expand(node);

    expect(expansion.completeness).toEqual({ kind: 'complete' });
    expect(moveKeys(topology, node)).toEqual([
      'place:a',
      'place:b',
      'place:c',
      'pass',
    ]);

    expect(searchDeterministicAndOrProof(node, adapter)).toMatchObject({
      outcome: 'proven-kill',
      reason: 'all-proof-complete-defenses-proven-kill',
    });
  });

  it('includes remote legal defender placements instead of assuming locality', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c']),
      q: Object.freeze(['a', 'b', 'c']),
      a: Object.freeze(['q', 'w']),
      b: Object.freeze(['q', 'w']),
      c: Object.freeze(['q', 'w']),
      r: Object.freeze(['s']),
      s: Object.freeze(['r']),
    });
    const state = makeState(
      topology,
      Object.freeze({ w: 'white', q: 'black' }),
    );
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );
    const adapter = createThreeLibertyProofSearchGoAdapter(topology);

    expect(adapter.expand(node).completeness).toEqual({ kind: 'complete' });
    expect(moveKeys(topology, node)).toEqual([
      'place:a',
      'place:b',
      'place:c',
      'place:r',
      'place:s',
      'pass',
    ]);
  });

  it('fails defender completeness closed on an unknown-root simple-ko branch', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c']),
      q: Object.freeze(['a', 'b', 'c']),
      a: Object.freeze(['q', 'w']),
      b: Object.freeze(['q', 'w']),
      c: Object.freeze(['q', 'w']),
      k: Object.freeze(['x', 'b1', 'b2']),
      x: Object.freeze(['k', 'c1', 'c2']),
      b1: Object.freeze(['k', 'b1e']),
      b1e: Object.freeze(['b1']),
      b2: Object.freeze(['k', 'b2e']),
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
        q: 'black',
        k: 'black',
        c1: 'black',
        c2: 'black',
        b1: 'white',
        b2: 'white',
      }),
    );
    const unknownHistory = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );
    const knownHistory = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
      cloneBoard(state.board),
    );
    const adapter = createThreeLibertyProofSearchGoAdapter(topology);

    expect(adapter.expand(unknownHistory).completeness).toEqual({
      kind: 'incomplete',
      reason: THREE_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY,
    });
    expect(moveKeys(topology, unknownHistory)).not.toContain('place:x');

    expect(adapter.expand(knownHistory).completeness).toEqual({ kind: 'complete' });
    expect(moveKeys(topology, knownHistory)).toContain('place:x');
  });

  it('filters attacker suicide through GameEngine without manufacturing a child', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c']),
      a: Object.freeze(['w']),
      b: Object.freeze(['w']),
      c: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const adapter = createThreeLibertyProofSearchGoAdapter(topology);

    expect(adapter.expand(node)).toEqual({
      moves: [],
      completeness: {
        kind: 'incomplete',
        reason: THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
      },
    });
    expect(searchDeterministicAndOrProof(node, adapter)).toMatchObject({
      outcome: 'unresolved',
      reason: `attacker-move-set-incomplete: ${THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY}`,
      exploredNodes: 1,
      maxDepth: 1,
    });
  });

  it('delegates non-three-liberty nodes to the unchanged E2-4b incomplete boundary', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c', 'd']),
      a: Object.freeze(['w']),
      b: Object.freeze(['w']),
      c: Object.freeze(['w']),
      d: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const expansion = createThreeLibertyProofSearchGoAdapter(topology).expand(node);

    expect(expansion).toEqual({
      moves: [],
      completeness: {
        kind: 'incomplete',
        reason: ENDGAME_GO_MOVE_GENERATION_BOUNDARY,
      },
    });
  });
});
