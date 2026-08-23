import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import { buildEndgameGraph } from './EndgameGraphCore';
import { TACTICAL_READER_ALGORITHM } from './TacticalReader';

class CorridorTopology implements Topology {
  readonly id = 'tactical-integration-corridor';
  private readonly allPoints = Object.freeze(['a', 'w1', 'w2', 'b', 'c'] as const);
  private readonly adjacency: Readonly<Record<PointId, readonly PointId[]>> = Object.freeze({
    a: Object.freeze(['w1']),
    w1: Object.freeze(['a', 'w2', 'c']),
    w2: Object.freeze(['w1', 'b']),
    b: Object.freeze(['w2']),
    c: Object.freeze(['w1']),
  });

  points(): readonly PointId[] {
    return this.allPoints;
  }

  neighbors(point: PointId): readonly PointId[] {
    const neighbors = this.adjacency[point];
    if (!neighbors) throw new Error(`Unknown corridor point: ${point}`);
    return neighbors;
  }

  has(point: PointId): boolean {
    return this.allPoints.includes(point as (typeof this.allPoints)[number]);
  }
}

const makeState = (topology: Topology): GameState => {
  const stones: Readonly<Partial<Record<PointId, PointOccupancy>>> = Object.freeze({
    w1: 'white',
    w2: 'white',
    c: 'black',
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
  it('promotes a bounded non-ko two-liberty forced capture to automatic dead', async () => {
    const topology = new CorridorTopology();
    const state = makeState(topology);
    const graph = buildEndgameGraph(state.board, topology);

    const result = await new AssistedEndgameClassifier().analyze({
      state,
      topology,
      groups: Object.freeze(graph.strings.map((group) => group.points)),
    });
    const target = result.find((proposal) => proposal.points.includes('w1'));

    expect(target).toMatchObject({
      points: ['w1', 'w2'],
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
