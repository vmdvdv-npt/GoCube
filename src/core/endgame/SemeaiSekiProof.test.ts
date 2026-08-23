import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph } from './EndgameGraphCore';
import {
  SEMEAI_SEKI_ALGORITHM,
  SEMEAI_SEKI_CLOSED_MUTUAL_CAPTURE_CERTIFICATE,
  analyzeSemeaiSeki,
} from './SemeaiSekiProof';

const makeTopology = (
  adjacency: Readonly<Record<PointId, readonly PointId[]>>,
): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'e2-9-semeai-seki-fixture',
    points: () => points,
    neighbors: (point: PointId) => adjacency[point] ?? Object.freeze([]),
    has: (point: PointId) => Object.prototype.hasOwnProperty.call(adjacency, point),
  });
};

const makeState = (
  topology: Topology,
  occupied: Readonly<Record<PointId, Exclude<PointOccupancy, 'empty'>>>,
  currentPlayer: 'black' | 'white' = 'black',
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupied[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer,
    moveNumber: 50,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const pairKeys = (
  state: GameState,
  topology: Topology,
  leftPoint: PointId,
  rightPoint: PointId,
): readonly [string, string] => {
  const graph = buildEndgameGraph(state, topology);
  return Object.freeze([
    graph.pointOwner.get(leftPoint)!,
    graph.pointOwner.get(rightPoint)!,
  ]);
};

describe('SemeaiSekiProof', () => {
  it('records shared and exclusive liberties without turning arithmetic into fate', () => {
    const topology = makeTopology({
      b: Object.freeze(['x', 'be']),
      be: Object.freeze(['b', 'ba']),
      ba: Object.freeze(['be']),
      w: Object.freeze(['x', 'we']),
      we: Object.freeze(['w', 'wa']),
      wa: Object.freeze(['we']),
      x: Object.freeze(['b', 'w']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }));
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');
    const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
      includeKillProofs: false,
    })!;

    expect(analysis.sharedLiberties).toEqual(['x']);
    expect(analysis.groups[0]?.exclusiveLiberties).toEqual(['be']);
    expect(analysis.groups[1]?.exclusiveLiberties).toEqual(['we']);
    expect(analysis.seki.status).toBe('unresolved');
  });

  it('exposes one-wave approach points as candidates only', () => {
    const topology = makeTopology({
      b: Object.freeze(['x', 'be']),
      be: Object.freeze(['b', 'approach']),
      approach: Object.freeze(['be']),
      w: Object.freeze(['x']),
      x: Object.freeze(['b', 'w']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }));
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');
    const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
      includeKillProofs: false,
    })!;

    expect(analysis.groups[0]?.approachPoints).toEqual(['approach']);
    expect(analysis.seki).toMatchObject({
      status: 'unresolved',
      reason: 'not-exactly-two-shared-liberties',
    });
  });

  it('proves closed two-shared-liberty seki through authoritative mutual-capture sequences', () => {
    const topology = makeTopology({
      b: Object.freeze(['w', 'x', 'y']),
      w: Object.freeze(['b', 'x', 'y']),
      x: Object.freeze(['b', 'w', 'y']),
      y: Object.freeze(['b', 'w', 'x']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }));
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');
    const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey)!;

    expect(analysis.seki.status).toBe('proven-seki');
    if (analysis.seki.status !== 'proven-seki') throw new Error('expected seki proof');
    expect(analysis.seki.evidence.certificate).toBe(
      SEMEAI_SEKI_CLOSED_MUTUAL_CAPTURE_CERTIFICATE,
    );
    expect(analysis.seki.evidence.sharedLiberties).toEqual(['x', 'y']);
    expect(analysis.seki.evidence.initiations).toHaveLength(4);
    expect(
      analysis.seki.evidence.initiations.every(
        (entry) => entry.result === 'refuted-by-capture',
      ),
    ).toBe(true);
    expect(analysis.killProofsExamined).toBe(false);
  });

  it('rejects seki when either group has an exclusive liberty', () => {
    const topology = makeTopology({
      b: Object.freeze(['w', 'x', 'y', 'be']),
      be: Object.freeze(['b']),
      w: Object.freeze(['b', 'x', 'y']),
      x: Object.freeze(['b', 'w', 'y']),
      y: Object.freeze(['b', 'w', 'x']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }));
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');

    expect(
      analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
        includeKillProofs: false,
      })?.seki,
    ).toEqual({ status: 'unresolved', reason: 'exclusive-liberties-present' });
  });

  it('rejects the positive seki certificate when a shared liberty touches a third group', () => {
    const topology = makeTopology({
      b: Object.freeze(['w', 'x', 'y']),
      w: Object.freeze(['b', 'x', 'y']),
      x: Object.freeze(['b', 'w', 'y', 't']),
      y: Object.freeze(['b', 'w', 'x']),
      t: Object.freeze(['x', 'te']),
      te: Object.freeze(['t']),
    });
    const state = makeState(
      topology,
      Object.freeze({ b: 'black', w: 'white', t: 'black' }),
    );
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');

    expect(
      analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
        includeKillProofs: false,
      })?.seki,
    ).toEqual({ status: 'unresolved', reason: 'third-group-boundary' });
  });

  it('does not infer seki from two failed or incomplete kill searches', () => {
    const topology = makeTopology({
      b: Object.freeze(['x', 'b1', 'b2', 'b3', 'b4']),
      b1: Object.freeze(['b']),
      b2: Object.freeze(['b']),
      b3: Object.freeze(['b']),
      b4: Object.freeze(['b']),
      w: Object.freeze(['x', 'w1', 'w2', 'w3', 'w4']),
      w1: Object.freeze(['w']),
      w2: Object.freeze(['w']),
      w3: Object.freeze(['w']),
      w4: Object.freeze(['w']),
      x: Object.freeze(['b', 'w']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }));
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');
    const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
      nodeBudget: 1,
    })!;

    expect(analysis.killProofs).toHaveLength(2);
    expect(analysis.killProofs.every((proof) => proof.result.outcome !== 'proven-kill')).toBe(
      true,
    );
    expect(analysis.seki.status).toBe('unresolved');
  });

  it('reports a positive semeai kill proof when the side to move can capture the opposing one-liberty group', () => {
    const topology = makeTopology({
      b: Object.freeze(['x', 'be']),
      be: Object.freeze(['b']),
      w: Object.freeze(['x']),
      x: Object.freeze(['b', 'w']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }), 'black');
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');
    const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey)!;
    const whiteProof = analysis.killProofs.find((proof) => proof.targetColor === 'white');

    expect(whiteProof?.rootRole).toBe('attacker');
    expect(whiteProof?.result.outcome).toBe('proven-kill');
  });

  it('maps actual side to move to attacker/defender roles independently for both targets', () => {
    const topology = makeTopology({
      b: Object.freeze(['x', 'be']),
      be: Object.freeze(['b']),
      w: Object.freeze(['x', 'we']),
      we: Object.freeze(['w']),
      x: Object.freeze(['b', 'w']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }), 'white');
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');
    const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
      nodeBudget: 1,
    })!;

    expect(
      analysis.killProofs.find((proof) => proof.targetColor === 'black')?.rootRole,
    ).toBe('attacker');
    expect(
      analysis.killProofs.find((proof) => proof.targetColor === 'white')?.rootRole,
    ).toBe('defender');
  });

  it('finds a shared semeai liberty across a Torus seam using topology adjacency only', () => {
    const topology = new TorusTopology(9);
    const state = makeState(
      topology,
      Object.freeze({ '8,0': 'black', '1,0': 'white' }),
    );
    const [blackKey, whiteKey] = pairKeys(state, topology, '8,0', '1,0');
    const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
      includeKillProofs: false,
    });

    expect(analysis?.sharedLiberties).toContain('0,0');
  });

  it('finds a shared semeai liberty across a Cube face edge without renderer geometry', () => {
    const topology = new CubeTopology(2);
    const state = makeState(
      topology,
      Object.freeze({ 'front:0:0': 'black', 'right:0:0': 'white' }),
    );
    const [blackKey, whiteKey] = pairKeys(
      state,
      topology,
      'front:0:0',
      'right:0:0',
    );
    const analysis = analyzeSemeaiSeki(state, topology, blackKey, whiteKey, {
      includeKillProofs: false,
    });

    expect(analysis?.sharedLiberties).toContain('front:0:1');
  });

  it('is deterministic for identical semeai/seki input', () => {
    const topology = makeTopology({
      b: Object.freeze(['w', 'x', 'y']),
      w: Object.freeze(['b', 'x', 'y']),
      x: Object.freeze(['b', 'w', 'y']),
      y: Object.freeze(['b', 'w', 'x']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black', w: 'white' }));
    const [blackKey, whiteKey] = pairKeys(state, topology, 'b', 'w');

    const first = analyzeSemeaiSeki(state, topology, blackKey, whiteKey);
    const second = analyzeSemeaiSeki(state, topology, blackKey, whiteKey);
    expect(first).toEqual(second);
    expect(first?.algorithm).toBe(SEMEAI_SEKI_ALGORITHM);
  });
});
