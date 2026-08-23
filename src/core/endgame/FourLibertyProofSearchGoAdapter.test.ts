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
  FOUR_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
  FOUR_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY,
  createFourLibertyProofSearchGoAdapter,
} from './FourLibertyProofSearchGoAdapter';
import {
  THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
  createThreeLibertyProofSearchGoAdapter,
} from './ThreeLibertyProofSearchGoAdapter';

const makeTopology = (adjacency: Readonly<Record<PointId, readonly PointId[]>>): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'four-liberty-proof-search-fixture',
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
    moveNumber: 60,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const cloneBoard = (board: BoardOccupancy): BoardOccupancy =>
  Object.freeze({ ...board });

const forcedFourLibertyFixture = () => {
  const topology = makeTopology({
    w: Object.freeze(['a', 'b', 'c', 'd']),
    q: Object.freeze(['a', 'b', 'c', 'd', 'q1', 'q2']),
    a: Object.freeze(['q', 'w']),
    b: Object.freeze(['q', 'w']),
    c: Object.freeze(['q', 'w']),
    d: Object.freeze(['q', 'w']),
    q1: Object.freeze(['q']),
    q2: Object.freeze(['q']),
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
  const adapter = createFourLibertyProofSearchGoAdapter(topology);
  return Object.freeze(
    adapter.expand(node).moves.map((move) => adapter.moveKey(move)),
  );
};

describe('FourLibertyProofSearchGoAdapter E2-6', () => {
  it('generates only legal current-liberty attacker reductions and keeps them explicit incomplete', () => {
    const { topology, state } = forcedFourLibertyFixture();
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const adapter = createFourLibertyProofSearchGoAdapter(topology);
    const expansion = adapter.expand(node);

    expect(expansion.completeness).toEqual({
      kind: 'incomplete',
      reason: FOUR_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
    });
    expect(moveKeys(topology, node)).toEqual([
      'place:a',
      'place:b',
      'place:c',
      'place:d',
    ]);

    expect(searchDeterministicAndOrProof(node, adapter)).toMatchObject({
      outcome: 'proven-kill',
      reason: 'attacker-winning-branch',
    });
  });

  it('uses a complete whole-board defender set plus Pass and can prove forced kill', () => {
    const { topology, state } = forcedFourLibertyFixture();
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'defender',
    );
    const adapter = createFourLibertyProofSearchGoAdapter(topology);
    const expansion = adapter.expand(node);

    expect(expansion.completeness).toEqual({ kind: 'complete' });
    expect(moveKeys(topology, node)).toEqual([
      'place:a',
      'place:b',
      'place:c',
      'place:d',
      'pass',
    ]);

    expect(searchDeterministicAndOrProof(node, adapter)).toMatchObject({
      outcome: 'proven-kill',
      reason: 'all-proof-complete-defenses-proven-kill',
    });
  });

  it('includes remote legal defender placements instead of assuming locality', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c', 'd']),
      q: Object.freeze(['a', 'b', 'c', 'd']),
      a: Object.freeze(['q', 'w']),
      b: Object.freeze(['q', 'w']),
      c: Object.freeze(['q', 'w']),
      d: Object.freeze(['q', 'w']),
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
    const adapter = createFourLibertyProofSearchGoAdapter(topology);

    expect(adapter.expand(node).completeness).toEqual({ kind: 'complete' });
    expect(moveKeys(topology, node)).toEqual([
      'place:a',
      'place:b',
      'place:c',
      'place:d',
      'place:r',
      'place:s',
      'pass',
    ]);
  });

  it('fails defender completeness closed on an unknown-root simple-ko branch', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c', 'd']),
      q: Object.freeze(['a', 'b', 'c', 'd']),
      a: Object.freeze(['q', 'w']),
      b: Object.freeze(['q', 'w']),
      c: Object.freeze(['q', 'w']),
      d: Object.freeze(['q', 'w']),
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
    const adapter = createFourLibertyProofSearchGoAdapter(topology);

    expect(adapter.expand(unknownHistory).completeness).toEqual({
      kind: 'incomplete',
      reason: FOUR_LIBERTY_UNKNOWN_ROOT_KO_BOUNDARY,
    });
    expect(moveKeys(topology, unknownHistory)).not.toContain('place:x');

    expect(adapter.expand(knownHistory).completeness).toEqual({ kind: 'complete' });
    expect(moveKeys(topology, knownHistory)).toContain('place:x');
  });

  it('filters attacker suicide through GameEngine without manufacturing a child', () => {
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
    const adapter = createFourLibertyProofSearchGoAdapter(topology);

    expect(adapter.expand(node)).toEqual({
      moves: [],
      completeness: {
        kind: 'incomplete',
        reason: FOUR_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
      },
    });
    expect(searchDeterministicAndOrProof(node, adapter)).toMatchObject({
      outcome: 'unresolved',
      reason: `attacker-move-set-incomplete: ${FOUR_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY}`,
      exploredNodes: 1,
      maxDepth: 1,
    });
  });

  it('delegates exact-three-liberty nodes to the unchanged E2-5 boundary', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c']),
      q: Object.freeze(['a', 'b', 'c', 'q1', 'q2']),
      a: Object.freeze(['q', 'w']),
      b: Object.freeze(['q', 'w']),
      c: Object.freeze(['q', 'w']),
      q1: Object.freeze(['q']),
      q2: Object.freeze(['q']),
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
      'attacker',
    );
    const fourAdapter = createFourLibertyProofSearchGoAdapter(topology);
    const threeAdapter = createThreeLibertyProofSearchGoAdapter(topology);

    expect(fourAdapter.expand(node)).toEqual(threeAdapter.expand(node));
    expect(fourAdapter.expand(node).completeness).toEqual({
      kind: 'incomplete',
      reason: THREE_LIBERTY_ATTACK_MOVE_GENERATION_BOUNDARY,
    });
    expect(searchDeterministicAndOrProof(node, fourAdapter)).toMatchObject({
      outcome: 'proven-kill',
    });
  });

  it('keeps nodes beyond the 3/4-liberty boundary on the E2-4b explicit incomplete fallback', () => {
    const topology = makeTopology({
      w: Object.freeze(['a', 'b', 'c', 'd', 'e']),
      a: Object.freeze(['w']),
      b: Object.freeze(['w']),
      c: Object.freeze(['w']),
      d: Object.freeze(['w']),
      e: Object.freeze(['w']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const expansion = createFourLibertyProofSearchGoAdapter(topology).expand(node);

    expect(expansion).toEqual({
      moves: [],
      completeness: {
        kind: 'incomplete',
        reason: ENDGAME_GO_MOVE_GENERATION_BOUNDARY,
      },
    });
  });
});
