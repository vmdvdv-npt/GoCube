import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { buildEndgameGraph } from './EndgameGraphCore';
import { readOneLibertyTactics } from './OneLibertyTacticalReader';

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

const firstGroupOfColor = (
  state: GameState,
  topology: Topology,
  color: 'black' | 'white',
) => {
  const graph = buildEndgameGraph(state, topology);
  const target = [...graph.groups.values()].find((group) => group.color === color && group.liberties.length === 1);
  if (!target) throw new Error(`Missing one-liberty ${color} target`);
  return { graph, target };
};

describe('OneLibertyTacticalReader topology integration', () => {
  it('keeps the deterministic open-atari escape unresolved on Torus and Cube', () => {
    const cases: readonly Readonly<{
      topology: Topology;
      target: PointId;
      liberty: PointId;
      extraLiberties: readonly PointId[];
    }>[] = [
      Object.freeze({
        topology: new TorusTopology(9),
        target: '0,0',
        liberty: '1,0',
        extraLiberties: Object.freeze(['2,0', '1,1']),
      }),
      Object.freeze({
        topology: new CubeTopology(5),
        target: 'front:2:2',
        liberty: 'front:2:1',
        extraLiberties: Object.freeze(['front:2:0', 'front:1:1']),
      }),
    ];

    for (const { topology, target, liberty, extraLiberties } of cases) {
      const allowedEmpty = new Set<PointId>([liberty, ...extraLiberties]);
      const state = makeState(topology, (point) => {
        if (point === target) return 'black';
        if (allowedEmpty.has(point)) return 'empty';
        return 'white';
      });
      const { graph, target: group } = firstGroupOfColor(state, topology, 'black');
      const result = readOneLibertyTactics(state, topology, graph, group.key);

      expect(result?.attackerFirst.result).toBe('kill');
      expect(result?.defenderFirst.result).toBe('escape');
      expect(result?.outcome).toBe('critical');
    }
  });
});
