import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/GameEngine';
import type { GameState, PointOccupancy, StoneColor } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import { EndgameTestLab } from './testlab/EndgameTestLab';

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

const collectStoneGroups = (
  topology: Topology,
  state: GameState,
): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];

  for (const point of [...topology.points()].sort()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = Object.freeze([...group.points].sort());
    for (const groupPoint of points) visited.add(groupPoint);
    groups.push(points);
  }

  return Object.freeze(groups);
};

const analyzeState = async (topology: Topology, state: GameState) =>
  new AssistedEndgameClassifier().analyze({
    state,
    topology,
    groups: collectStoneGroups(topology, state),
  });

const proposalForColor = (
  result: Awaited<ReturnType<typeof analyzeState>>,
  state: GameState,
  color: StoneColor,
) => result.find((proposal) => state.board[proposal.points[0]!] === color);

describe('AssistedEndgameClassifier automatic alive/dead core', () => {
  it('proves the deterministic two-eye fixture alive on Torus and Cube', async () => {
    const lab = new EndgameTestLab();
    const classifier = new AssistedEndgameClassifier();

    for (const topology of [new TorusTopology(9), new CubeTopology(5)]) {
      const fixture = lab.generate({
        kind: 'life-death-pattern',
        topology,
        seed: '0.3.04-two-eyes',
        pattern: 'two-eyes',
      });
      const result = await lab.analyze(fixture, classifier);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        status: 'alive',
        source: 'automatic',
        evidence: {
          algorithm: 'benson-pass-alive-v1',
          proof: 'two-vital-regions',
        },
      });
      expect(result[0]?.evidence?.vitalRegions).toHaveLength(2);
    }
  });

  it('proves a sealed single-liberty group dead only behind pass-alive boundary groups', async () => {
    const cases: readonly Readonly<{
      topology: Topology;
      target: readonly PointId[];
      liberty: PointId;
      opponentEyes: readonly PointId[];
    }>[] = [
      Object.freeze({
        topology: new TorusTopology(9),
        target: Object.freeze(['4,4', '5,4']),
        liberty: '3,4',
        opponentEyes: Object.freeze(['0,0', '2,2']),
      }),
      Object.freeze({
        topology: new CubeTopology(5),
        target: Object.freeze(['front:2:2', 'front:2:3']),
        liberty: 'front:2:1',
        opponentEyes: Object.freeze(['back:2:2', 'top:2:2']),
      }),
    ];

    for (const { topology, target, liberty, opponentEyes } of cases) {
      const targetSet = new Set(target);
      const empty = new Set([liberty, ...opponentEyes]);
      const state = makeState(topology, (point) => {
        if (targetSet.has(point)) return 'black';
        if (empty.has(point)) return 'empty';
        return 'white';
      });
      const result = await analyzeState(topology, state);
      const dead = proposalForColor(result, state, 'black');
      const alive = proposalForColor(result, state, 'white');

      expect(dead).toMatchObject({
        points: [...target].sort(),
        status: 'dead',
        source: 'automatic',
        evidence: {
          algorithm: 'sealed-single-liberty-dead-v1',
          candidate: 'single-liberty',
          proof: 'sealed-liberty-with-pass-alive-boundary',
          liberty,
        },
      });
      expect(dead?.evidence?.boundaryAliveGroups).toHaveLength(1);
      expect(alive).toMatchObject({
        status: 'alive',
        source: 'automatic',
        evidence: { algorithm: 'benson-pass-alive-v1' },
      });
    }
  });

  it('keeps one-eye, false-eye and seki-like fixtures unresolved on both topologies', async () => {
    const lab = new EndgameTestLab();
    const classifier = new AssistedEndgameClassifier();

    for (const topology of [new TorusTopology(9), new CubeTopology(5)]) {
      const fixtures = [
        lab.generate({
          kind: 'life-death-pattern',
          topology,
          seed: '0.3.04-single-eye',
          pattern: 'single-eye',
        }),
        lab.generate({
          kind: 'life-death-pattern',
          topology,
          seed: '0.3.04-false-eye',
          pattern: 'false-eye',
        }),
        lab.generate({
          kind: 'seki-pattern',
          topology,
          seed: '0.3.04-shared-liberties',
          pattern: 'shared-liberties',
        }),
      ];

      for (const fixture of fixtures) {
        const result = await lab.analyze(fixture, classifier);
        expect(result.length).toBeGreaterThan(0);
        expect(result.every((proposal) => proposal.status === 'unresolved')).toBe(true);
      }
    }
  });

  it('keeps an atari candidate unresolved when filling its liberty can escape', async () => {
    const lab = new EndgameTestLab();
    const classifier = new AssistedEndgameClassifier();

    for (const topology of [new TorusTopology(9), new CubeTopology(5)]) {
      const fixture = lab.generate({
        kind: 'life-death-pattern',
        topology,
        seed: '0.3.05-open-atari',
        pattern: 'atari-group',
      });
      const result = await lab.analyze(fixture, classifier);
      const target = result.find(
        (proposal) => fixture.state.board[proposal.points[0]!] === 'black',
      );

      expect(target?.status).toBe('unresolved');
      expect(target?.source).toBeUndefined();
    }
  });

  it('proves a one-liberty target dead tactically even when its boundary is not pass-alive', async () => {
    const topology = new TorusTopology(9);
    const target = new Set<PointId>(['4,4', '5,4']);
    const liberty = '3,4';
    const white = new Set<PointId>();

    for (const point of target) {
      for (const neighbor of topology.neighbors(point)) {
        if (!target.has(neighbor) && neighbor !== liberty) white.add(neighbor);
      }
    }
    for (const neighbor of topology.neighbors(liberty)) {
      if (!target.has(neighbor)) white.add(neighbor);
    }

    const state = makeState(topology, (point) => {
      if (target.has(point)) return 'black';
      if (white.has(point)) return 'white';
      return 'empty';
    });
    const result = await analyzeState(topology, state);
    const dead = proposalForColor(result, state, 'black');

    expect(dead).toMatchObject({
      points: [...target].sort(),
      status: 'dead',
      source: 'automatic',
      evidence: {
        algorithm: 'one-liberty-tactical-reader-v1',
        attackPoints: [liberty],
        attackerFirst: { result: 'kill' },
        defenderFirst: { result: 'forced-kill' },
        outcome: 'proven-dead',
      },
    });
  });

  it('uses the actual Torus seams and Cube face graph in positive alive proofs', async () => {
    const cases: readonly Readonly<{ topology: Topology; eyes: readonly PointId[] }>[] = [
      Object.freeze({
        topology: new TorusTopology(9),
        eyes: Object.freeze(['0,0', '4,4']),
      }),
      Object.freeze({
        topology: new CubeTopology(5),
        eyes: Object.freeze(['front:2:2', 'back:2:2']),
      }),
    ];

    for (const { topology, eyes } of cases) {
      const eyeSet = new Set(eyes);
      const state = makeState(topology, (point) => (eyeSet.has(point) ? 'empty' : 'black'));
      const groups = collectStoneGroups(topology, state);

      expect(groups).toHaveLength(1);
      const result = await analyzeState(topology, state);
      expect(result).toHaveLength(1);
      expect(result[0]?.status).toBe('alive');
      expect(result[0]?.source).toBe('automatic');
      expect(result[0]?.evidence?.vitalRegions).toHaveLength(2);
    }
  });

  it('runs the Benson fixed point until dependent eye regions and groups are eliminated', async () => {
    const points = ['a', 'b', 'r1', 'r2', 'x'] as const;
    const adjacency: Readonly<Record<string, readonly PointId[]>> = {
      a: ['r1', 'r2'],
      b: ['r2', 'x'],
      r1: ['a'],
      r2: ['a', 'b', 'x'],
      x: ['b', 'r2'],
    };
    const topology: Topology = {
      id: 'benson-fixed-point-test',
      points: () => points,
      has: (point) => points.includes(point as (typeof points)[number]),
      neighbors: (point) => adjacency[point] ?? [],
    };
    const state = makeState(topology, (point) => (point === 'a' || point === 'b' ? 'black' : 'empty'));

    const result = await analyzeState(topology, state);

    expect(result).toEqual([
      { points: ['a'], status: 'unresolved' },
      { points: ['b'], status: 'unresolved' },
    ]);
  });

  it('refuses automatic proof for a partial stone-group analysis context', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, (point) =>
      point === '0,0' || point === '4,4' ? 'black' : 'empty',
    );

    const result = await new AssistedEndgameClassifier().analyze({
      state,
      topology,
      groups: Object.freeze([Object.freeze(['0,0'])]),
    });

    expect(result).toEqual([{ points: ['0,0'], status: 'unresolved' }]);
  });
});