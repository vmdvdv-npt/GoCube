import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import { buildEndgameGraph } from './EndgameGraphCore';
import { TACTICAL_READER_ALGORITHM } from './TacticalReader';

class GridTopology implements Topology {
  readonly id = 'tactical-integration-grid-3';
  private readonly allPoints: readonly PointId[];
  private readonly pointSet: ReadonlySet<PointId>;

  constructor() {
    const points: PointId[] = [];
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) points.push(`${x},${y}`);
    }
    this.allPoints = Object.freeze(points);
    this.pointSet = new Set(points);
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  neighbors(point: PointId): readonly PointId[] {
    if (!this.has(point)) throw new Error(`Unknown grid point: ${point}`);
    const [x, y] = point.split(',').map(Number) as [number, number];
    return Object.freeze(
      [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]
        .filter(
          ([nextX, nextY]) =>
            nextX >= 0 && nextY >= 0 && nextX < 3 && nextY < 3,
        )
        .map(([nextX, nextY]) => `${nextX},${nextY}`),
    );
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
  }
}

const makeState = (topology: Topology): GameState => {
  const stones: Readonly<Partial<Record<PointId, PointOccupancy>>> = Object.freeze({
    '0,0': 'white',
    '1,1': 'black',
    '2,0': 'black',
    '0,2': 'black',
  });
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

describe('TacticalReader classifier integration', () => {
  it('promotes a bounded two-liberty forced capture to automatic dead', async () => {
    const topology = new GridTopology();
    const state = makeState(topology);
    const graph = buildEndgameGraph(state.board, topology);

    const result = await new AssistedEndgameClassifier().analyze({
      state,
      topology,
      groups: Object.freeze(graph.strings.map((group) => group.points)),
    });
    const target = result.find((proposal) => proposal.points.includes('0,0'));

    expect(target).toMatchObject({
      points: ['0,0'],
      status: 'dead',
      source: 'automatic',
      evidence: {
        algorithm: TACTICAL_READER_ALGORITHM,
        proof: 'forced-capture-both-first-player-orders',
      },
    });
    expect(target?.evidence?.attackerFirst).toMatchObject({ outcome: 'proved-kill' });
    expect(target?.evidence?.defenderFirst).toMatchObject({ outcome: 'proved-kill' });
  });
});