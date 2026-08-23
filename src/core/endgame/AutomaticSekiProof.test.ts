import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/GameEngine';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import {
  generateSekiCandidates,
  verifySekiCandidate,
  type SekiAnalysisGroup,
} from './AutomaticSekiProof';
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

describe('AutomaticSekiProof', () => {
  it('proves a closed two-shared-liberty mutual life as seki on Torus and Cube', async () => {
    const torus = new TorusTopology(9);
    const torusLiberties = Object.freeze(['3,0', '3,1'] as const);
    const torusState = makeState(torus, (point) => {
      if (torusLiberties.includes(point as (typeof torusLiberties)[number])) return 'empty';
      const x = Number(point.split(',')[0]);
      return x <= 3 ? 'black' : 'white';
    });

    const cube = new CubeTopology(5);
    const cubeLiberties = Object.freeze(['front:2:2', 'front:3:2'] as const);
    const cubeWhite = new Set<PointId>(['front:2:3', 'front:3:3']);
    const cubeState = makeState(cube, (point) => {
      if (cubeLiberties.includes(point as (typeof cubeLiberties)[number])) return 'empty';
      return cubeWhite.has(point) ? 'white' : 'black';
    });

    for (const { topology, state, liberties } of [
      { topology: torus, state: torusState, liberties: torusLiberties },
      { topology: cube, state: cubeState, liberties: cubeLiberties },
    ] as const) {
      expect(collectStoneGroups(topology, state)).toHaveLength(2);
      const result = await analyzeState(topology, state);

      expect(result).toHaveLength(2);
      expect(result.every((proposal) => proposal.status === 'seki')).toBe(true);
      expect(result.every((proposal) => proposal.source === 'automatic')).toBe(true);
      for (const proposal of result) {
        expect(proposal.evidence).toMatchObject({
          algorithm: 'closed-mutual-two-liberties-seki-v1',
          candidate: 'two-shared-liberties',
          proof: 'closed-mutual-capture',
          sharedLiberties: [...liberties].sort(),
        });
        expect(proposal.evidence?.groups).toHaveLength(2);
      }
    }
  });

  it('keeps open curated seki-like fixtures unresolved on both topologies', async () => {
    const lab = new EndgameTestLab();
    const classifier = new AssistedEndgameClassifier();

    for (const topology of [new TorusTopology(9), new CubeTopology(5)]) {
      for (const pattern of ['shared-liberties', 'ambiguous-contact'] as const) {
        const fixture = lab.generate({
          kind: 'seki-pattern',
          topology,
          seed: `0.3.06-${pattern}`,
          pattern,
        });
        const result = await lab.analyze(fixture, classifier);

        expect(result.length).toBeGreaterThan(0);
        expect(result.every((proposal) => proposal.status === 'unresolved')).toBe(true);
      }
    }
  });

  it('keeps topology-sensitive shared-liberty stress embeddings unresolved', async () => {
    const lab = new EndgameTestLab();
    const classifier = new AssistedEndgameClassifier();
    const fixtures = [
      lab.generate({
        kind: 'topology-stress',
        topology: new TorusTopology(9),
        seed: '0.3.06-torus-seam',
        mode: 'torus-seam',
        pattern: 'shared-liberties',
      }),
      lab.generate({
        kind: 'topology-stress',
        topology: new CubeTopology(5),
        seed: '0.3.06-cube-edge',
        mode: 'cube-edge',
        pattern: 'shared-liberties',
      }),
      lab.generate({
        kind: 'topology-stress',
        topology: new CubeTopology(5),
        seed: '0.3.06-cube-corner',
        mode: 'cube-corner',
        pattern: 'shared-liberties',
      }),
    ];

    for (const fixture of fixtures) {
      const result = await lab.analyze(fixture, classifier);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((proposal) => proposal.status === 'unresolved')).toBe(true);
    }
  });

  it('rejects a two-liberty pair when a shared liberty touches a third group', () => {
    const points = ['black', 'white', 'third', 'x', 'y'] as const;
    const adjacency: Readonly<Record<string, readonly PointId[]>> = Object.freeze({
      black: Object.freeze(['x', 'y']),
      white: Object.freeze(['x', 'y']),
      third: Object.freeze(['x']),
      x: Object.freeze(['black', 'white', 'third']),
      y: Object.freeze(['black', 'white']),
    });
    const topology: Topology = {
      id: 'seki-third-group-test',
      points: () => points,
      has: (point) => points.includes(point as (typeof points)[number]),
      neighbors: (point) => adjacency[point] ?? [],
    };
    const state = makeState(topology, (point) => {
      if (point === 'black' || point === 'third') return 'black';
      if (point === 'white') return 'white';
      return 'empty';
    });
    const groups = new Map<string, SekiAnalysisGroup>([
      [
        'black',
        Object.freeze({
          key: 'black',
          points: Object.freeze(['black']),
          color: 'black',
          liberties: Object.freeze(['x', 'y']),
        }),
      ],
      [
        'white',
        Object.freeze({
          key: 'white',
          points: Object.freeze(['white']),
          color: 'white',
          liberties: Object.freeze(['x', 'y']),
        }),
      ],
      [
        'third',
        Object.freeze({
          key: 'third',
          points: Object.freeze(['third']),
          color: 'black',
          liberties: Object.freeze(['x']),
        }),
      ],
    ]);
    const pointOwner = new Map<PointId, string>([
      ['black', 'black'],
      ['white', 'white'],
      ['third', 'third'],
    ]);
    const candidates = generateSekiCandidates(groups, new Set());

    expect(candidates).toHaveLength(1);
    expect(
      verifySekiCandidate(candidates[0]!, {
        state,
        topology,
        groups,
        pointOwner,
      }),
    ).toEqual({ proven: false, reason: 'shared-liberty-touches-third-group' });
  });
});
