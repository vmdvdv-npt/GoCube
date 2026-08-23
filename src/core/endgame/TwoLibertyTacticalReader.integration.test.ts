import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology, cubeStepPoint } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { readTwoLibertyTactics } from './TwoLibertyTacticalReader';

const makeState = (
  topology: Topology,
  target: PointId,
  liberties: readonly PointId[],
): GameState => {
  const empty = new Set<PointId>(liberties);
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) {
    board[point] = point === target ? 'white' : empty.has(point) ? 'empty' : 'black';
  }

  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 40,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const readTarget = (
  topology: Topology,
  state: GameState,
  target: PointId,
) => {
  const graph = buildEndgameGraph(state, topology);
  const targetGroupKey = graph.pointOwner.get(target);
  if (!targetGroupKey) throw new Error(`Missing target group at ${target}`);
  return readTwoLibertyTactics(state, topology, graph, targetGroupKey);
};

describe('TwoLibertyTacticalReader topology integration', () => {
  it('proves the same fully surrounded two-liberty kill across a Torus seam and a Cube edge', () => {
    const cube = new CubeTopology(5);
    const cubeTarget = 'front:0:2';
    const cases: readonly Readonly<{
      name: string;
      topology: Topology;
      target: PointId;
      liberties: readonly PointId[];
    }>[] = [
      Object.freeze({
        name: 'torus seam',
        topology: new TorusTopology(9),
        target: '0,0',
        liberties: Object.freeze(['8,0', '1,0']),
      }),
      Object.freeze({
        name: 'cube edge',
        topology: cube,
        target: cubeTarget,
        liberties: Object.freeze([
          cubeStepPoint(cube.size, cubeTarget, 'top'),
          cubeStepPoint(cube.size, cubeTarget, 'bottom'),
        ]),
      }),
    ];

    for (const { name, topology, target, liberties } of cases) {
      expect(topology.neighbors(target), name).toEqual(expect.arrayContaining([...liberties]));
      const state = makeState(topology, target, liberties);
      const result = readTarget(topology, state, target);

      expect(result?.algorithm, name).toBe('two-liberty-exhaustive-reader-v2');
      expect(result?.attackPoints, name).toEqual([...liberties].sort());
      expect(result?.attackerFirst.result, name).toBe('forced-kill');
      expect(result?.defenderFirst.result, name).toBe('forced-kill');
      expect(result?.defenderFirst.examinedPlacements, name).toBe(2);
      expect(result?.defenderFirst.legalPlacements, name).toBe(2);
      expect(result?.outcome, name).toBe('proven-dead');
    }
  });

  it('is deterministic across repeated reads of the same graph position', () => {
    const topology = new TorusTopology(9);
    const target = '0,0';
    const state = makeState(topology, target, Object.freeze(['8,0', '1,0']));

    const first = readTarget(topology, state, target);
    const second = readTarget(topology, state, target);

    expect(second).toEqual(first);
  });
});
