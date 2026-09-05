import { describe, expect, it } from 'vitest';
import {
  analyzeFinalGroupJudge,
  assertFinalGroupJudgeProofConsistency,
  PASS_ALIVE_TERRITORY_DEAD_ALGORITHM,
} from './AssistedEndgameClassifier';
import {
  KATAGO_REFERENCE_COMMIT,
  KATAGO_RULES_VERSION,
  proveBensonPassAlive,
} from './BensonPassAlive';
import { buildEndgameStaticGraph } from './EndgameStaticGraph';
import { buildPassAliveTerritory } from './PassAliveTerritory';
import { GameEngine } from '../game/GameEngine';
import type { GameState, PointOccupancy, StoneColor } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';

class RectangularTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.id = `rect:${width}x${height}`;
    this.allPoints = Object.freeze(
      Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => `${x},${y}`),
      ).flat(),
    );
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  has(point: PointId): boolean {
    return this.allPoints.includes(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    const [xRaw, yRaw] = point.split(',');
    const x = Number(xRaw);
    const y = Number(yRaw);
    const neighbors: PointId[] = [];
    if (x > 0) neighbors.push(`${x - 1},${y}`);
    if (x + 1 < this.width) neighbors.push(`${x + 1},${y}`);
    if (y > 0) neighbors.push(`${x},${y - 1}`);
    if (y + 1 < this.height) neighbors.push(`${x},${y + 1}`);
    return Object.freeze(neighbors);
  }
}

const makeState = (
  topology: Topology,
  occupancyAt: (point: PointId) => PointOccupancy,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupancyAt(point);
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const stateFromRows = (
  rows: readonly string[],
): Readonly<{ topology: RectangularTopology; state: GameState }> => {
  const topology = new RectangularTopology(rows[0]!.length, rows.length);
  const state = makeState(topology, (point) => {
    const [xRaw, yRaw] = point.split(',');
    const token = rows[Number(yRaw)]![Number(xRaw)]!;
    if (token === 'B') return 'black';
    if (token === 'W') return 'white';
    return 'empty';
  });
  return Object.freeze({ topology, state });
};

const collectGroups = (
  topology: Topology,
  state: GameState,
): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];
  for (const point of topology.points()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = Object.freeze([...group.points].sort());
    for (const groupPoint of points) visited.add(groupPoint);
    groups.push(points);
  }
  return Object.freeze(groups);
};

const analyze = async (topology: Topology, state: GameState) =>
  analyzeFinalGroupJudge({
    state,
    topology,
    groups: collectGroups(topology, state),
  });

const groupStatusForColor = (
  proposal: Awaited<ReturnType<typeof analyze>>['proposal'],
  state: GameState,
  color: StoneColor,
) => proposal.find((group) => state.board[group.points[0]!] === color)?.status;

const goldenFixtures = [
  Object.freeze({
    name: 'two-eyes-black-pass-alive',
    kataGoRulesVersion: KATAGO_RULES_VERSION,
    kataGoCommit: KATAGO_REFERENCE_COMMIT,
    board: Object.freeze([
      'BBBBB',
      'B.BBB',
      'BBBBB',
      'BBB.B',
      'BBBBB',
    ]),
    expectedPassAliveColor: 'black' as const,
    expectedPassAliveTerritory: Object.freeze(['1,1', '3,3']),
    expectedClassification: Object.freeze({ black: 'alive' as const }),
  }),
  Object.freeze({
    name: 'opponent-stone-inside-black-pass-alive-territory',
    kataGoRulesVersion: KATAGO_RULES_VERSION,
    kataGoCommit: KATAGO_REFERENCE_COMMIT,
    board: Object.freeze([
      'BBBBB',
      'B.WBB',
      'BBBBB',
      'BBB.B',
      'BBBBB',
    ]),
    expectedPassAliveColor: 'black' as const,
    expectedPassAliveTerritory: Object.freeze(['1,1', '2,1', '3,3']),
    expectedClassification: Object.freeze({
      black: 'alive' as const,
      white: 'dead' as const,
    }),
  }),
  Object.freeze({
    name: 'one-eye-is-not-pass-alive',
    kataGoRulesVersion: KATAGO_RULES_VERSION,
    kataGoCommit: KATAGO_REFERENCE_COMMIT,
    board: Object.freeze([
      'BBBBB',
      'B.BBB',
      'BBBBB',
      'BBBBB',
      'BBBBB',
    ]),
    expectedPassAliveColor: 'black' as const,
    expectedPassAliveTerritory: Object.freeze([]),
    expectedClassification: Object.freeze({ black: 'unresolved' as const }),
  }),
] as const;

describe('KataGo-style Final Group Judge V1 conformance', () => {
  for (const fixture of goldenFixtures) {
    it(fixture.name, async () => {
      const { topology, state } = stateFromRows(fixture.board);
      const graph = buildEndgameStaticGraph(state.board, topology);
      const black = proveBensonPassAlive(state.board, topology, graph, 'black');
      const white = proveBensonPassAlive(state.board, topology, graph, 'white');
      const territory = buildPassAliveTerritory(graph, black, white);
      const analysis = await analyze(topology, state);

      expect(fixture.kataGoRulesVersion).toBe(3);
      expect(fixture.kataGoCommit).toBe(
        'f6bc4b19a1686caa2d088b56251e8c11c8be6d51',
      );

      const expectedColorResult =
        fixture.expectedPassAliveColor === 'black' ? black : white;
      if (fixture.expectedClassification.black === 'alive') {
        expect(expectedColorResult.aliveGroups.size).toBeGreaterThan(0);
      } else {
        expect(expectedColorResult.aliveGroups.size).toBe(0);
      }

      expect([...territory.black].sort()).toEqual(
        [...fixture.expectedPassAliveTerritory].sort(),
      );

      expect(groupStatusForColor(analysis.proposal, state, 'black')).toBe(
        fixture.expectedClassification.black,
      );
      if ('white' in fixture.expectedClassification) {
        expect(groupStatusForColor(analysis.proposal, state, 'white')).toBe(
          fixture.expectedClassification.white,
        );
      }

      if (fixture.name.includes('opponent-stone')) {
        const whiteProposal = analysis.proposal.find(
          (group) => state.board[group.points[0]!] === 'white',
        );
        expect(whiteProposal?.status).toBe('dead');
        expect(
          whiteProposal?.evidence?.algorithm === PASS_ALIVE_TERRITORY_DEAD_ALGORITHM ||
            whiteProposal?.evidence?.algorithm === 'sealed-single-liberty-dead-v1',
        ).toBe(true);
      }
    });
  }

  it('proves connected multi-chain Benson life when two chains share two vital regions', async () => {
    const points = ['b1', 'b2', 'e1', 'e2'] as const;
    const adjacency: Readonly<Record<string, readonly PointId[]>> = {
      b1: ['e1', 'e2'],
      b2: ['e1', 'e2'],
      e1: ['b1', 'b2'],
      e2: ['b1', 'b2'],
    };
    const topology: Topology = {
      id: 'multi-chain-benson',
      points: () => points,
      has: (point) => points.includes(point as (typeof points)[number]),
      neighbors: (point) => adjacency[point] ?? [],
    };
    const state = makeState(topology, (point) =>
      point === 'b1' || point === 'b2' ? 'black' : 'empty',
    );

    const analysis = await analyze(topology, state);
    expect(analysis.proposal).toHaveLength(2);
    expect(analysis.proposal.every((group) => group.status === 'alive')).toBe(true);
  });

  it('does not run automatic life/death proof during normal play', async () => {
    const { topology, state: endgameState } = stateFromRows([
      'BBBBB',
      'B.BBB',
      'BBBBB',
      'BBB.B',
      'BBBBB',
    ]);
    const playingState: GameState = Object.freeze({
      ...endgameState,
      consecutivePasses: 0,
      phase: 'playing',
    });
    const analysis = await analyzeFinalGroupJudge({
      state: playingState,
      topology,
      groups: collectGroups(topology, playingState),
    });
    expect(analysis.proposal).toHaveLength(1);
    expect(analysis.proposal[0]?.status).toBe('unresolved');
    expect(analysis.diagnostics.bensonIterations).toBe(0);
  });

  it('keeps failed static proofs unresolved and never infers the opposite status', async () => {
    const { topology, state } = stateFromRows([
      'BBBBB',
      'B.BBB',
      'BBBBB',
      'BBBBB',
      'BBBBB',
    ]);
    const analysis = await analyze(topology, state);

    expect(groupStatusForColor(analysis.proposal, state, 'black')).toBe('unresolved');
    expect(analysis.diagnostics.counts).toEqual({
      alive: 0,
      dead: 0,
      seki: 0,
      unresolved: 1,
    });
  });

  it('treats contradictory proof claims as a correctness error', () => {
    expect(() =>
      assertFinalGroupJudgeProofConsistency('group-x', ['alive', 'dead']),
    ).toThrow(/correctness error/i);
    expect(() =>
      assertFinalGroupJudgeProofConsistency('group-x', ['dead', 'dead']),
    ).not.toThrow();
  });
});

const closedSekiTopology = (withEscape: boolean): Topology => {
  const points = withEscape ? ['b', 'w', 'x', 'y', 'z'] : ['b', 'w', 'x', 'y'];
  const adjacency: Record<string, readonly PointId[]> = {
    b: ['x', 'y'],
    w: ['x', 'y'],
    x: withEscape ? ['b', 'w', 'y', 'z'] : ['b', 'w', 'y'],
    y: ['b', 'w', 'x'],
    z: ['x'],
  };
  return {
    id: withEscape ? 'strict-seki-open' : 'strict-seki-closed',
    points: () => Object.freeze([...points]),
    has: (point) => points.includes(point),
    neighbors: (point) => adjacency[point] ?? [],
  };
};

describe('strict seki boundary', () => {
  it('classifies the closed mutual two-liberty certificate as seki', async () => {
    const topology = closedSekiTopology(false);
    const state = makeState(topology, (point) =>
      point === 'b' ? 'black' : point === 'w' ? 'white' : 'empty',
    );
    const analysis = await analyze(topology, state);
    expect(analysis.proposal.map((group) => group.status)).toEqual(['seki', 'seki']);
  });

  it('leaves a seki-like shape unresolved when the strict certificate fails', async () => {
    const topology = closedSekiTopology(true);
    const state = makeState(topology, (point) =>
      point === 'b' ? 'black' : point === 'w' ? 'white' : 'empty',
    );
    const analysis = await analyze(topology, state);
    expect(analysis.proposal.every((group) => group.status === 'unresolved')).toBe(true);
  });
});

const torusEyeCase = (
  eyePoints: readonly PointId[],
): Readonly<{ topology: TorusTopology; state: GameState }> => {
  const topology = new TorusTopology(5);
  const empties = new Set<PointId>([...eyePoints, '2,2']);
  return Object.freeze({
    topology,
    state: makeState(topology, (point) => (empties.has(point) ? 'empty' : 'black')),
  });
};

describe('topology correctness', () => {
  const torusCases = [
    ['horizontal wraparound', ['0,0', '4,0']],
    ['vertical wraparound', ['0,0', '0,4']],
    ['two-direction wraparound', ['0,0', '4,0', '0,4', '4,4']],
  ] as const;

  for (const [name, eyePoints] of torusCases) {
    it(`handles Torus ${name}`, async () => {
      const { topology, state } = torusEyeCase(eyePoints);
      const analysis = await analyze(topology, state);
      expect(analysis.proposal).toHaveLength(1);
      expect(analysis.proposal[0]?.status).toBe('alive');
      for (const point of eyePoints) {
        expect(analysis.passAliveTerritory.ownerByPoint.get(point)).toBe('black');
      }
    });
  }

  it('has no artificial exterior region on Torus', () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, () => 'empty');
    const graph = buildEndgameStaticGraph(state.board, topology);
    expect(graph.emptyRegions).toHaveLength(1);
    expect(graph.emptyRegions[0]?.points).toHaveLength(81);
  });

  it('handles a Cube eye and territory region crossing a face seam near a cube vertex', async () => {
    const topology = new CubeTopology(4);
    let chosen:
      | Readonly<{ seam: readonly [PointId, PointId]; secondEye: PointId; state: GameState }>
      | undefined;

    for (const point of topology.points()) {
      const pointFace = point.split(':')[0];
      for (const neighbor of topology.neighbors(point)) {
        if (neighbor.split(':')[0] === pointFace) continue;
        for (const secondEye of topology.points()) {
          if (
            secondEye === point ||
            secondEye === neighbor ||
            topology.neighbors(point).includes(secondEye) ||
            topology.neighbors(neighbor).includes(secondEye)
          ) {
            continue;
          }
          const empties = new Set<PointId>([point, neighbor, secondEye]);
          const state = makeState(topology, (candidate) =>
            empties.has(candidate) ? 'empty' : 'black',
          );
          const graph = buildEndgameStaticGraph(state.board, topology);
          if (graph.strings.length === 1 && graph.emptyRegions.length === 2) {
            chosen = Object.freeze({
              seam: Object.freeze([point, neighbor]) as readonly [PointId, PointId],
              secondEye,
              state,
            });
            break;
          }
        }
        if (chosen) break;
      }
      if (chosen) break;
    }

    expect(chosen).toBeDefined();
    const analysis = await analyze(topology, chosen!.state);
    expect(analysis.proposal).toHaveLength(1);
    expect(analysis.proposal[0]?.status).toBe('alive');
    expect(
      new Set(analysis.proposal[0]!.points.map((point) => point.split(':')[0])).size,
    ).toBeGreaterThan(1);
    for (const point of chosen!.seam) {
      expect(analysis.passAliveTerritory.ownerByPoint.get(point)).toBe('black');
    }
  });
});
