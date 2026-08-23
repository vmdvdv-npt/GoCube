import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/GameEngine';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameGraph, type EndgameStoneString } from './EndgameGraphCore';
import {
  TACTICAL_READER_ALGORITHM,
  readTacticalCapture,
  verifyTacticalDead,
} from './TacticalReader';

class GridTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];
  private readonly pointSet: ReadonlySet<PointId>;

  constructor(private readonly size: number) {
    this.id = `grid-${size}`;
    const points: PointId[] = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) points.push(`${x},${y}`);
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
    const candidates = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const;
    return Object.freeze(
      candidates
        .filter(
          ([nextX, nextY]) =>
            nextX >= 0 && nextY >= 0 && nextX < this.size && nextY < this.size,
        )
        .map(([nextX, nextY]) => `${nextX},${nextY}`),
    );
  }

  has(point: PointId): boolean {
    return this.pointSet.has(point);
  }
}

const makeState = (
  topology: Topology,
  stones: Readonly<Partial<Record<PointId, PointOccupancy>>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = stones[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black' as const,
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame' as const,
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

describe('TacticalReader', () => {
  it('proves an immediate capture even when the defender receives the first local move', () => {
    const topology = new GridTopology(3);
    const state = makeState(topology, {
      '0,0': 'white',
      '0,1': 'black',
      '1,1': 'black',
      '2,0': 'black',
    });
    const target = targetAt(state, topology, '0,0');

    const result = verifyTacticalDead(target, state, topology);

    expect(result.proven).toBe(true);
    if (!result.proven) return;
    expect(result.evidence.algorithm).toBe(TACTICAL_READER_ALGORITHM);
    expect(result.evidence.attackerFirst.principalVariation).toEqual(['1,0']);
    expect(result.evidence.defenderFirst.outcome).toBe('proved-kill');
  });

  it('does not call an atari dead when the defender can extend into open space', () => {
    const topology = new GridTopology(3);
    const state = makeState(topology, {
      '1,1': 'white',
      '0,1': 'black',
      '1,0': 'black',
      '2,1': 'black',
    });
    const target = targetAt(state, topology, '1,1');

    const defenderFirst = readTacticalCapture(target, state, topology, {
      firstPlayer: 'defender',
    });

    expect(defenderFirst.outcome).not.toBe('proved-kill');
    expect(defenderFirst.principalVariation[0]).toBe('1,2');
    expect(verifyTacticalDead(target, state, topology).proven).toBe(false);
  });

  it('proves a short forced capture that needs more than an immediate atari', () => {
    const topology = new GridTopology(3);
    const state = makeState(topology, {
      '0,0': 'white',
      '1,1': 'black',
      '2,0': 'black',
      '0,2': 'black',
    });
    const target = targetAt(state, topology, '0,0');

    const result = verifyTacticalDead(target, state, topology);

    expect(result.proven).toBe(true);
    if (!result.proven) return;
    expect(result.evidence.attackerFirst.principalVariation.length).toBeGreaterThanOrEqual(2);
    expect(result.evidence.attackerFirst.principalVariation.length).toBeLessThanOrEqual(4);
    expect(result.evidence.defenderFirst.outcome).toBe('proved-kill');
  });

  it('reads a ladder as a repeated forced-atari sequence', () => {
    const topology = new GridTopology(5);
    const state = makeState(topology, {
      '1,1': 'white',
      '0,0': 'black',
      '0,1': 'black',
      '1,0': 'black',
      '2,0': 'black',
      '3,0': 'black',
      '4,0': 'black',
    });
    const target = targetAt(state, topology, '1,1');

    const result = readTacticalCapture(target, state, topology, { firstPlayer: 'attacker' });

    expect(result.outcome).toBe('proved-kill');
    expect(result.principalVariation).toEqual([
      '1,2',
      '2,1',
      '2,2',
      '3,1',
      '3,2',
      '4,1',
      '4,2',
    ]);
  });

  it('finds a short net move outside the target current liberties', () => {
    const topology = new GridTopology(4);
    const state = makeState(topology, {
      '0,0': 'white',
      '1,0': 'black',
      '2,0': 'white',
      '3,0': 'white',
      '0,1': 'black',
      '1,1': 'white',
      '2,1': 'white',
      '2,2': 'black',
      '3,2': 'black',
      '0,3': 'black',
      '1,3': 'black',
      '2,3': 'black',
    });
    const target = targetAt(state, topology, '2,0');

    const result = readTacticalCapture(target, state, topology, { firstPlayer: 'attacker' });

    expect(target.liberties).toEqual(['1,2', '3,1']);
    expect(result.outcome).toBe('proved-kill');
    expect(result.principalVariation[0]).toBe('0,2');
    expect(target.liberties).not.toContain(result.principalVariation[0]);
  });

  it('handles snapback by allowing the defender to capture the sacrificial attacker stone', () => {
    const topology = new GridTopology(4);
    const state = makeState(topology, {
      '0,0': 'white',
      '3,0': 'black',
      '0,1': 'white',
      '1,1': 'black',
      '3,1': 'white',
      '2,2': 'black',
      '3,2': 'black',
      '0,3': 'white',
      '1,3': 'white',
      '2,3': 'black',
      '3,3': 'black',
    });
    const target = targetAt(state, topology, '0,3');

    const result = readTacticalCapture(target, state, topology, { firstPlayer: 'attacker' });

    expect(result.outcome).toBe('proved-kill');
    expect(result.principalVariation).toEqual(['0,2', '1,2', '0,2']);

    const engine = new GameEngine(topology);
    const first = engine.placeStone(asPlaying(state), '0,2', 'black');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const reply = engine.placeStone(first.state, '1,2', 'white', {
      previousBoard: state.board,
    });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.state.board['0,2']).toBe('empty');
  });

  it('considers a legal counter-capture defense instead of falsely proving death', () => {
    const topology = new GridTopology(5);
    const state = makeState(topology, {
      '2,2': 'white',
      '0,2': 'white',
      '1,1': 'white',
      '1,2': 'black',
      '2,1': 'black',
      '3,2': 'black',
    });
    const target = targetAt(state, topology, '2,2');

    const defenderFirst = readTacticalCapture(target, state, topology, {
      firstPlayer: 'defender',
    });

    expect(defenderFirst.principalVariation[0]).toBe('1,3');
    expect(defenderFirst.outcome).not.toBe('proved-kill');
    expect(verifyTacticalDead(target, state, topology).proven).toBe(false);
  });

  it('fails closed for a target that already has an open escape boundary', () => {
    const topology = new GridTopology(5);
    const state = makeState(topology, { '2,2': 'white' });
    const target = targetAt(state, topology, '2,2');

    const result = readTacticalCapture(target, state, topology, { firstPlayer: 'attacker' });

    expect(result.outcome).toBe('unknown-boundary');
    expect(verifyTacticalDead(target, state, topology).proven).toBe(false);
  });
});
