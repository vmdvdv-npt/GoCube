import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { searchDeterministicAndOrProof } from './DeterministicAndOrProofSearch';
import { buildEndgameGraph } from './EndgameGraphCore';
import { createEndgameProofSearchNode } from './EndgameProofSearchGoAdapter';
import { createFourLibertyProofSearchGoAdapter } from './FourLibertyProofSearchGoAdapter';
import {
  TACTICAL_EXTENSION_GO_ADAPTER_ALGORITHM,
  TACTICAL_EXTENSION_MOVE_GENERATION_BOUNDARY,
  TACTICAL_EXTENSION_PASS_ALIVE_REASON,
  analyzeTacticalExtensionMoves,
  createTacticalExtensionProofSearchGoAdapter,
} from './TacticalExtensionProofSearchGoAdapter';

const makeTopology = (
  adjacency: Readonly<Record<PointId, readonly PointId[]>>,
): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'e2-8-tactical-fixture',
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

const candidateAt = (
  node: ReturnType<typeof createEndgameProofSearchNode>,
  topology: Topology,
  point: PointId,
) =>
  analyzeTacticalExtensionMoves(node, topology).candidates.find(
    (candidate) => candidate.point === point,
  );

describe('TacticalExtensionProofSearchGoAdapter', () => {
  it('recognizes an authoritative immediate friendly connection without treating the shape itself as fate', () => {
    const topology = makeTopology({
      a: Object.freeze(['x', 'ae']),
      ae: Object.freeze(['a']),
      b: Object.freeze(['x', 'be']),
      be: Object.freeze(['b']),
      x: Object.freeze(['a', 'b', 'xe']),
      xe: Object.freeze(['x']),
    });
    const state = makeState(topology, Object.freeze({ a: 'black', b: 'black' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'black',
      Object.freeze(['a']),
      'defender',
    );
    const candidate = candidateAt(node, topology, 'x');

    expect(candidate?.reasons).toContain('connection');
    expect(candidate?.captured).toEqual([]);
  });

  it('recognizes a cut at the opponent friendly-connection point', () => {
    const topology = makeTopology({
      a: Object.freeze(['x', 'ae']),
      ae: Object.freeze(['a']),
      b: Object.freeze(['x', 'be']),
      be: Object.freeze(['b']),
      x: Object.freeze(['a', 'b', 'xe']),
      xe: Object.freeze(['x']),
    });
    const state = makeState(topology, Object.freeze({ a: 'black', b: 'black' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'black',
      Object.freeze(['a']),
      'attacker',
    );

    expect(candidateAt(node, topology, 'x')?.reasons).toContain('cut');
  });

  it('recognizes an actual counter-capture from authoritative board transition', () => {
    const topology = makeTopology({
      b: Object.freeze(['x', 'w']),
      w: Object.freeze(['b', 'x', 'we']),
      we: Object.freeze(['w']),
      x: Object.freeze(['b', 'w', 'xe']),
      xe: Object.freeze(['x']),
    });
    const state = makeState(
      topology,
      Object.freeze({ b: 'black', w: 'white' }),
    );
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'black',
      Object.freeze(['b']),
      'attacker',
    );
    const candidate = candidateAt(node, topology, 'x');

    expect(candidate?.reasons).toContain('counter-capture');
    expect(candidate?.captured).toEqual(['b']);
  });

  it('recognizes a ladder pressure step only from an exact 2-to-1 liberty transition', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'y']),
      x: Object.freeze(['w', 'xe']),
      xe: Object.freeze(['x']),
      y: Object.freeze(['w', 'ye']),
      ye: Object.freeze(['y']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );

    expect(candidateAt(node, topology, 'x')?.reasons).toContain('ladder-step');
  });

  it('recognizes a net pressure step only from an exact 3+-to-2 liberty transition', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'y', 'z']),
      x: Object.freeze(['w', 'xe']),
      xe: Object.freeze(['x']),
      y: Object.freeze(['w', 'ye']),
      ye: Object.freeze(['y']),
      z: Object.freeze(['w', 'ze']),
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

    expect(candidateAt(node, topology, 'x')?.reasons).toContain('net-step');
  });

  it('recognizes an exact legal snapback sacrifice sequence without ko shortcuts', () => {
    const topology = makeTopology({
      l: Object.freeze(['m', 'w1', 'w2']),
      m: Object.freeze(['l', 'w1', 'w2']),
      w1: Object.freeze(['l', 'm']),
      w2: Object.freeze(['l', 'm']),
    });
    const state = makeState(
      topology,
      Object.freeze({ w1: 'white', w2: 'white' }),
    );
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w1']),
      'attacker',
    );
    const candidate = candidateAt(node, topology, 'm');

    expect(candidate?.reasons).toEqual(
      expect.arrayContaining(['snapback', 'sacrifice']),
    );
    expect(candidate?.resultingOwnLiberties).toBe(1);
  });

  it('adds explicit preparation moves that can hand a 5-lib target to the existing 4-lib proof layer', () => {
    const topology = makeTopology({
      t: Object.freeze(['x1', 'x2', 'x3', 'x4', 'x5']),
      x1: Object.freeze(['t', 'q1']),
      q1: Object.freeze(['x1']),
      x2: Object.freeze(['t', 'q2']),
      q2: Object.freeze(['x2']),
      x3: Object.freeze(['t', 'q3']),
      q3: Object.freeze(['x3']),
      x4: Object.freeze(['t', 'q4']),
      q4: Object.freeze(['x4']),
      x5: Object.freeze(['t', 'q5']),
      q5: Object.freeze(['x5']),
    });
    const state = makeState(topology, Object.freeze({ t: 'white' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['t']),
      'attacker',
    );
    const adapter = createTacticalExtensionProofSearchGoAdapter(topology);
    const expansion = adapter.expand(node);

    expect(candidateAt(node, topology, 'x1')?.reasons).toContain('preparation');
    expect(expansion.moves).toContainEqual({ kind: 'place', point: 'x1' });
    expect(expansion.completeness).toMatchObject({
      kind: 'incomplete',
      reason: expect.stringContaining(TACTICAL_EXTENSION_MOVE_GENERATION_BOUNDARY),
    });
  });

  it('proves survival through an actual connection only after the connected target becomes Benson/pass-alive', () => {
    const topology = makeTopology({
      a: Object.freeze(['x']),
      x: Object.freeze(['a', 'b']),
      b: Object.freeze(['x', 'e1', 'e2']),
      e1: Object.freeze(['b']),
      e2: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ a: 'black', b: 'black' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'black',
      Object.freeze(['a']),
      'defender',
    );
    const adapter = createTacticalExtensionProofSearchGoAdapter(topology);
    const result = searchDeterministicAndOrProof(node, adapter);

    expect(result.outcome).toBe('proven-survival');
    expect(result.principalVariation[0]).toBe('place:x');
    expect(result.reason).toBe('defender-survival-branch');

    const connection = adapter.apply(
      node,
      Object.freeze({ kind: 'place', point: 'x' }),
    );
    expect(adapter.terminal(connection)).toEqual({
      outcome: 'proven-survival',
      reason: TACTICAL_EXTENSION_PASS_ALIVE_REASON,
    });
  });

  it('preserves an already complete exact-4-lib defender move set byte-for-byte', () => {
    const topology = makeTopology({
      t: Object.freeze(['a', 'b', 'c', 'd']),
      a: Object.freeze(['t', 'ae']),
      ae: Object.freeze(['a']),
      b: Object.freeze(['t', 'be']),
      be: Object.freeze(['b']),
      c: Object.freeze(['t', 'ce']),
      ce: Object.freeze(['c']),
      d: Object.freeze(['t', 'de']),
      de: Object.freeze(['d']),
    });
    const state = makeState(topology, Object.freeze({ t: 'black' }));
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'black',
      Object.freeze(['t']),
      'defender',
    );

    expect(createTacticalExtensionProofSearchGoAdapter(topology).expand(node)).toEqual(
      createFourLibertyProofSearchGoAdapter(topology).expand(node),
    );
  });

  it('fails closed on an unknown-root simple-ko tactical point', () => {
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
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'white',
      Object.freeze(['w']),
      'attacker',
    );
    const analysis = analyzeTacticalExtensionMoves(node, topology);

    expect(analysis.koDependentPoints).toContain('x');
    expect(analysis.candidates.some((candidate) => candidate.point === 'x')).toBe(false);
  });

  it('detects a connection through a Torus seam using topology adjacency only', () => {
    const topology = new TorusTopology(9);
    const state = makeState(
      topology,
      Object.freeze({ '8,0': 'black', '1,0': 'black' }),
    );
    const node = createEndgameProofSearchNode(
      topology,
      state,
      'black',
      Object.freeze(['8,0']),
      'defender',
    );

    expect(candidateAt(node, topology, '0,0')?.reasons).toContain('connection');
  });

  it('detects a connection across a Cube face edge without renderer geometry', () => {
    const topology = new CubeTopology(2);
    const state = makeState(
      topology,
      Object.freeze({ 'front:0:0': 'black', 'right:0:0': 'black' }),
    );
    const graph = buildEndgameGraph(state, topology);
    expect(
      graph.friendlyConnections.some(
        (connection) =>
          connection.color === 'black' && connection.point === 'front:0:1',
      ),
    ).toBe(true);

    const node = createEndgameProofSearchNode(
      topology,
      state,
      'black',
      Object.freeze(['front:0:0']),
      'defender',
    );
    expect(candidateAt(node, topology, 'front:0:1')?.reasons).toContain('connection');
  });

  it('is deterministic for identical tactical input', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'y', 'z']),
      x: Object.freeze(['w', 'xe']),
      xe: Object.freeze(['x']),
      y: Object.freeze(['w', 'ye']),
      ye: Object.freeze(['y']),
      z: Object.freeze(['w', 'ze']),
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

    const first = analyzeTacticalExtensionMoves(node, topology);
    const second = analyzeTacticalExtensionMoves(node, topology);
    expect(first).toEqual(second);
    expect(first.algorithm).toBe(TACTICAL_EXTENSION_GO_ADAPTER_ALGORITHM);
  });
});
