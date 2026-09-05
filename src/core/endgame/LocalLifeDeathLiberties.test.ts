import { describe, expect, it } from 'vitest';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { buildEndgameStaticGraph, type EndgameStoneString } from './EndgameStaticGraph';
import { readLocalLifeDeath } from './LocalLifeDeathReader';

class GraphTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];
  private readonly adjacency: ReadonlyMap<PointId, readonly PointId[]>;

  constructor(id: string, edges: readonly (readonly [PointId, PointId])[]) {
    this.id = id;
    const map = new Map<PointId, Set<PointId>>();
    for (const [a, b] of edges) {
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
    this.allPoints = Object.freeze([...map.keys()].sort());
    this.adjacency = new Map([...map].map(([point, values]) => [point, Object.freeze([...values].sort())] as const));
  }
  points(): readonly PointId[] { return this.allPoints; }
  neighbors(point: PointId): readonly PointId[] {
    const result = this.adjacency.get(point);
    if (!result) throw new Error(`Unknown point: ${point}`);
    return result;
  }
  has(point: PointId): boolean { return this.adjacency.has(point); }
}

const enclosedPocket = (libertyCount: number): Readonly<{ topology: Topology; state: GameState; target: EndgameStoneString }> => {
  const liberties = Array.from({ length: libertyCount }, (_, index) => `l${index + 1}`);
  const edges: Array<readonly [PointId, PointId]> = [
    ['B', 'eye1'], ['B', 'eye2'], ['B', 'outside'], ['outside', 'far'],
  ];
  for (const liberty of liberties) {
    edges.push(['t', liberty], [liberty, 'B']);
  }
  const topology = new GraphTopology(`enclosed-${libertyCount}-liberties`, edges);
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = 'empty';
  board.t = 'white';
  board.B = 'black';
  const state: GameState = Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 20,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });
  const target = buildEndgameStaticGraph(state.board, topology).strings.find((group) => group.points.includes('t'));
  if (!target) throw new Error('Missing target');
  return Object.freeze({ topology, state, target });
};

describe('LocalLifeDeathReader enclosed liberty corpus', () => {
  for (const libertyCount of [1, 2, 3, 4] as const) {
    it(`proves forced death with ${libertyCount} initial liberties for both first-player orders`, () => {
      const { topology, state, target } = enclosedPocket(libertyCount);
      expect(target.liberties).toHaveLength(libertyCount);
      const result = readLocalLifeDeath(target, state, topology, {
        maxNodes: 10_000,
        maxZonePoints: 96,
      });
      expect(result.zone.outcome).toBe('bounded');
      expect(result.attackerFirst.outcome).toBe('proved-dead');
      expect(result.defenderFirst.outcome).toBe('proved-dead');
      expect(result.outcome).toBe('proved-dead');
    });
  }
});