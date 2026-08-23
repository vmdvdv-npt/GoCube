import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/GameEngine';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { AssistedEndgameClassifier } from './AssistedEndgameClassifier';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import { readTacticalCapture, verifyTacticalDead } from './TacticalReader';

class GridTopology implements Topology {
  readonly id = 'tactical-ko-grid-3';
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
    '1,0': 'white',
    '0,1': 'white',
    '2,0': 'black',
    '1,1': 'black',
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

const targetAt = (
  state: GameState,
  topology: Topology,
  point: PointId,
): EndgameStoneString => {
  const target = buildEndgameGraph(state.board, topology).strings.find((group) =>
    group.points.includes(point),
  );
  if (!target) throw new Error(`No target group at ${point}`);
  return target;
};

const asPlaying = (state: GameState): GameState =>
  Object.freeze({ ...state, phase: 'playing' as const, consecutivePasses: 0 });

describe('TacticalReader ko hardening', () => {
  it('returns KO_DEPENDENT when the restoring recapture is not on the attacker move point', () => {
    const topology = new GridTopology();
    const state = makeState(topology);
    const target = targetAt(state, topology, '1,0');

    const engine = new GameEngine(topology);
    const capture = engine.placeStone(asPlaying(state), '0,0', 'black');
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    expect(capture.state.board['1,0']).toBe('empty');

    const restoringRecapture = engine.placeStone(capture.state, '1,0', 'white', {
      previousBoard: state.board,
    });
    expect(restoringRecapture).toMatchObject({ ok: false, reason: 'repetition' });

    const attackerFirst = readTacticalCapture(target, state, topology, {
      firstPlayer: 'attacker',
    });
    expect(attackerFirst.outcome).toBe('ko-dependent');
    expect(attackerFirst.principalVariation[0]).toBe('0,0');

    const verification = verifyTacticalDead(target, state, topology);
    expect(verification.proven).toBe(false);
  });

  it('does not promote the ko-dependent target to automatic dead in classifier integration', async () => {
    const topology = new GridTopology();
    const state = makeState(topology);
    const graph = buildEndgameGraph(state.board, topology);

    const result = await new AssistedEndgameClassifier().analyze({
      state,
      topology,
      groups: Object.freeze(graph.strings.map((group) => group.points)),
    });
    const target = result.find((proposal) => proposal.points.includes('1,0'));

    expect(target).toBeDefined();
    expect(target?.status).not.toBe('dead');
  });
});