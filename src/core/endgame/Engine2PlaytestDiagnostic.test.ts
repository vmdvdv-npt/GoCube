import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import {
  GAME_SESSION_SNAPSHOT_VERSION,
  type GameSessionSnapshot,
} from '../persistence/GameSessionSnapshot';
import type { PointId, Topology } from '../topology/Topology';
import { analyzeEngine2PlaytestGroup } from './Engine2PlaytestDiagnostic';

const makeTopology = (
  adjacency: Readonly<Record<PointId, readonly PointId[]>>,
): Topology => {
  const points = Object.freeze(Object.keys(adjacency).sort());
  return Object.freeze({
    id: 'engine2-playtest-diagnostic-fixture',
    points: () => points,
    neighbors: (point: PointId) => adjacency[point] ?? Object.freeze([]),
    has: (point: PointId) => Object.prototype.hasOwnProperty.call(adjacency, point),
  });
};

const makeState = (
  topology: Topology,
  occupied: Readonly<Record<PointId, Exclude<PointOccupancy, 'empty'>>>,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupied[point] ?? 'empty';
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 30,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
};

const snapshotFor = (state: GameState): GameSessionSnapshot =>
  Object.freeze({
    version: GAME_SESSION_SNAPSHOT_VERSION,
    ruleSet: 'chinese',
    komi: 7.5,
    history: Object.freeze([state, state]),
    finalScore: null,
  });

describe('Engine2PlaytestDiagnostic', () => {
  it('runs both first-player proof orders on a real-session snapshot without mutating it', () => {
    const topology = makeTopology({
      w: Object.freeze(['x', 'b']),
      x: Object.freeze(['w', 'b']),
      b: Object.freeze(['w', 'x', 'be']),
      be: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ w: 'white', b: 'black' }));
    const snapshot = snapshotFor(state);
    const before = JSON.stringify(snapshot);

    const first = analyzeEngine2PlaytestGroup(
      snapshot,
      topology,
      'w',
      Object.freeze({ nodeBudget: 64 }),
    );
    const second = analyzeEngine2PlaytestGroup(
      snapshot,
      topology,
      'w',
      Object.freeze({ nodeBudget: 64 }),
    );

    expect(first).toMatchObject({
      verdict: 'proven-dead',
      color: 'white',
      nodeBudget: 64,
      previousBoardKnown: true,
      attackerFirst: { result: { outcome: 'proven-kill' } },
      defenderFirst: { result: { outcome: 'proven-kill' } },
    });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('returns null when the selected real-game point is not a stone group', () => {
    const topology = makeTopology({
      b: Object.freeze(['e']),
      e: Object.freeze(['b']),
    });
    const state = makeState(topology, Object.freeze({ b: 'black' }));

    expect(
      analyzeEngine2PlaytestGroup(
        snapshotFor(state),
        topology,
        'e',
        Object.freeze({ nodeBudget: 32 }),
      ),
    ).toBeNull();
  });
});
