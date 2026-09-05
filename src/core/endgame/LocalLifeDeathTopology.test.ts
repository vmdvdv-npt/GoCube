import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import { cubePointId, cubeStepPoint, CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { proveBensonPassAlive } from './BensonPassAlive';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { readLocalLifeDeath } from './LocalLifeDeathReader';

type PointAt = (row: number, column: number) => PointId;

const makeState = (
  topology: Topology,
  pointAt: PointAt,
  multiFaceTarget = false,
): Readonly<{ state: GameState; targetPoint: PointId }> => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = 'empty';

  const width = multiFaceTarget ? 10 : 9;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const point = pointAt(row, column);
      if (row === 0 || row === 2) {
        board[point] = 'black';
        continue;
      }

      if (multiFaceTarget) {
        if (column === 4 || column === 5) board[point] = 'white';
        else if (column === 0 || column === 2 || column === 7 || column === 9) board[point] = 'black';
      } else {
        if (column === 4) board[point] = 'white';
        else if (column === 0 || column === 2 || column === 6 || column === 8) board[point] = 'black';
      }
    }
  }

  return Object.freeze({
    state: Object.freeze({
      board: Object.freeze(board),
      currentPlayer: 'black' as const,
      moveNumber: 30,
      consecutivePasses: 2,
      phase: 'endgame' as const,
      captures: Object.freeze({ black: 0, white: 0 }),
    }),
    targetPoint: pointAt(1, 4),
  });
};

const targetAt = (
  state: GameState,
  topology: Topology,
  point: PointId,
): EndgameStoneString => {
  const target = buildEndgameStaticGraph(state.board, topology).strings.find((group) =>
    group.points.includes(point),
  );
  if (!target) throw new Error(`Missing target at ${point}`);
  return target;
};

const assertForcedDeath = (
  topology: Topology,
  pointAt: PointAt,
  multiFaceTarget = false,
): void => {
  const { state, targetPoint } = makeState(topology, pointAt, multiFaceTarget);
  const graph = buildEndgameStaticGraph(state.board, topology);
  const blackSafe = proveBensonPassAlive(state.board, topology, graph, 'black');
  expect(blackSafe.aliveGroups.size).toBeGreaterThan(0);

  const target = targetAt(state, topology, targetPoint);
  expect(target.color).toBe('white');
  expect(target.liberties).toHaveLength(2);
  if (multiFaceTarget) expect(target.points).toHaveLength(2);

  const result = readLocalLifeDeath(target, state, topology, {
    maxNodes: 1_500,
    maxZonePoints: 96,
  });
  expect(result.zone.outcome).toBe('bounded');
  expect(result.attackerFirst.outcome).toBe('proved-dead');
  expect(result.defenderFirst.outcome).toBe('proved-dead');
  expect(result.outcome).toBe('proved-dead');
};

const torusPointAt = (size: number, baseRow: number, baseColumn: number): PointAt =>
  (row, column) => `${(baseColumn + column + size) % size},${(baseRow + row + size) % size}`;

const cubeSeamPointAt = (size: number, baseRow: number, startColumn: number): PointAt =>
  (row, column) => {
    let point = cubePointId('front', baseRow + row, startColumn);
    for (let step = 0; step < column; step += 1) point = cubeStepPoint(size, point, 'right');
    return point;
  };

describe('LocalLifeDeathReader topology metamorphic proof safety', () => {
  it('proves the same two-liberty enclosed death in Torus interior and through the wrap seam', () => {
    const topology = new TorusTopology(13);
    assertForcedDeath(topology, torusPointAt(13, 4, 2));
    assertForcedDeath(topology, torusPointAt(13, 4, 9));
  });

  it('proves the same local death on one Cube face and across a real face edge', () => {
    const topology = new CubeTopology(11);
    assertForcedDeath(topology, (row, column) => cubePointId('front', row + 4, column + 1));
    assertForcedDeath(topology, cubeSeamPointAt(11, 4, 6));
  });

  it('tracks crucial stones for a multi-face target group and proves its capture across the Cube seam', () => {
    const topology = new CubeTopology(11);
    const pointAt = cubeSeamPointAt(11, 4, 6);
    const { state, targetPoint } = makeState(topology, pointAt, true);
    const target = targetAt(state, topology, targetPoint);
    expect(target.points).toEqual(expect.arrayContaining([
      cubePointId('front', 5, 10),
      cubePointId('right', 5, 0),
    ]));
    assertForcedDeath(topology, pointAt, true);
  });
});