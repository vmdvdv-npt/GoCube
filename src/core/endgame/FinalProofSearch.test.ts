import { describe, expect, it } from 'vitest';
import type { EndgameProposal } from './EndgameClassifier';
import {
  analyzeFinalProofSearch,
  FINAL_PROOF_SEARCH_ALGORITHM,
  type FinalProofSearchOptions,
} from './FinalProofSearch';
import { GameEngine } from '../game/GameEngine';
import type { GameState, PointOccupancy } from '../game/types';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';

class RectangularTopology implements Topology {
  readonly id: string;
  private readonly allPoints: readonly PointId[];

  constructor(
    readonly width: number,
    readonly height: number,
    id = `rect:${width}x${height}`,
  ) {
    this.id = id;
    this.allPoints = Object.freeze(
      Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => `${x},${y}`),
      ).flat(),
    );
  }

  points(): readonly PointId[] {
    return this.allPoints;
  }

  has(point: PointId): boolean {
    return this.allPoints.includes(point);
  }

  neighbors(point: PointId): readonly PointId[] {
    const [xRaw, yRaw] = point.split(',');
    const x = Number(xRaw);
    const y = Number(yRaw);
    const neighbors: PointId[] = [];
    if (x > 0) neighbors.push(`${x - 1},${y}`);
    if (x + 1 < this.width) neighbors.push(`${x + 1},${y}`);
    if (y > 0) neighbors.push(`${x},${y - 1}`);
    if (y + 1 < this.height) neighbors.push(`${x},${y + 1}`);
    return Object.freeze(neighbors);
  }
}

const makeState = (
  topology: Topology,
  occupancyAt: (point: PointId) => PointOccupancy,
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = occupancyAt(point);
  return Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 20,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 3, white: 2 }),
  });
};

const stateFromRows = (rows: readonly string[]) => {
  const topology = new RectangularTopology(rows[0]!.length, rows.length);
  const state = makeState(topology, (point) => {
    const [xRaw, yRaw] = point.split(',');
    const token = rows[Number(yRaw)]![Number(xRaw)]!;
    return token === 'B' ? 'black' : token === 'W' ? 'white' : 'empty';
  });
  return { topology, state } as const;
};

const collectGroups = (
  topology: Topology,
  state: GameState,
): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];
  for (const point of topology.points()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = Object.freeze([...group.points].sort());
    for (const groupPoint of points) visited.add(groupPoint);
    groups.push(points);
  }
  return Object.freeze(groups);
};

const unresolvedProposal = (
  topology: Topology,
  state: GameState,
): EndgameProposal =>
  Object.freeze(
    collectGroups(topology, state).map((points) =>
      Object.freeze({ points, status: 'unresolved' as const }),
    ),
  );

const generousOptions: FinalProofSearchOptions = Object.freeze({
  globalNodeBudget: 2_000,
  wallClockBudgetMs: 5_000,
  tierNodeBudgets: Object.freeze([128, 512]),
  maxRegionPoints: 32,
  maxDepth: 48,
});

const sealedTwoLibertyDeath = () =>
  stateFromRows([
    'BBBBBBB',
    'B.BBBBB',
    'BBBBBBB',
    'BBB.BBB',
    'BBBW.BB',
    'BBBBBBB',
    'BBBBB.B',
  ]);

describe('Final Proof Search', () => {
  it('proves a two-liberty target dead in both first-player orders', async () => {
    const { topology, state } = sealedTwoLibertyDeath();
    const baseline = unresolvedProposal(topology, state);
    const analysis = await analyzeFinalProofSearch(
      { state, topology, groups: collectGroups(topology, state) },
      baseline,
      generousOptions,
    );

    const white = analysis.proposal.find(
      (group) => state.board[group.points[0]!] === 'white',
    );
    expect(white?.status).toBe('dead');
    expect(white?.evidence?.algorithm).toBe(FINAL_PROOF_SEARCH_ALGORITHM);
    expect(white?.evidence?.proofReason).toBe('forced-kill-in-both-first-player-orders');
    const orders = white?.evidence?.firstPlayerOrders as
      | { attackerFirst?: { outcome?: string }; defenderFirst?: { outcome?: string } }
      | undefined;
    expect(orders?.attackerFirst?.outcome).toBe('kill');
    expect(orders?.defenderFirst?.outcome).toBe('kill');
  });

  it('accepts Benson/pass-alive only as a direct life terminal, not failure to kill', async () => {
    const { topology, state } = stateFromRows([
      'BBBBB',
      'B.BBB',
      'BBBBB',
      'BBB.B',
      'BBBBB',
    ]);
    const baseline = unresolvedProposal(topology, state);
    const analysis = await analyzeFinalProofSearch(
      { state, topology, groups: collectGroups(topology, state) },
      baseline,
      generousOptions,
    );

    expect(analysis.proposal).toHaveLength(1);
    expect(analysis.proposal[0]?.status).toBe('alive');
    expect(analysis.proposal[0]?.evidence?.proofReason).toBe(
      'formal-survival-in-both-first-player-orders',
    );
  });

  it('never turns budget exhaustion into alive, dead, or seki', async () => {
    const { topology, state } = sealedTwoLibertyDeath();
    const tinyBudget: FinalProofSearchOptions = Object.freeze({
      globalNodeBudget: 1,
      wallClockBudgetMs: 5_000,
      tierNodeBudgets: Object.freeze([1]),
      maxRegionPoints: 32,
      maxDepth: 48,
    });
    const analysis = await analyzeFinalProofSearch(
      { state, topology, groups: collectGroups(topology, state) },
      unresolvedProposal(topology, state),
      tinyBudget,
    );
    const white = analysis.proposal.find(
      (group) => state.board[group.points[0]!] === 'white',
    );

    expect(white?.status).toBe('unresolved');
    expect(white?.evidence?.outcome).toBe('UNKNOWN_BUDGET');
    expect(analysis.diagnostics.unresolvedBudget).toBeGreaterThan(0);
  });

  it('returns UNKNOWN_BOUNDARY when a target cannot be certified local', async () => {
    const topology = new TorusTopology(9);
    const state = makeState(topology, (point) => (point === '0,0' ? 'black' : 'empty'));
    const options: FinalProofSearchOptions = Object.freeze({
      ...generousOptions,
      maxRegionPoints: 8,
    });
    const analysis = await analyzeFinalProofSearch(
      { state, topology, groups: collectGroups(topology, state) },
      unresolvedProposal(topology, state),
      options,
    );

    expect(analysis.proposal[0]?.status).toBe('unresolved');
    expect(analysis.proposal[0]?.evidence?.outcome).toBe('UNKNOWN_BOUNDARY');
    expect(analysis.diagnostics.unresolvedBoundary).toBe(1);
  });

  it('does not mutate the authoritative final position, captures, or phase', async () => {
    const { topology, state } = sealedTwoLibertyDeath();
    const before = JSON.stringify(state);
    await analyzeFinalProofSearch(
      { state, topology, groups: collectGroups(topology, state) },
      unresolvedProposal(topology, state),
      generousOptions,
    );

    expect(JSON.stringify(state)).toBe(before);
    expect(state.phase).toBe('endgame');
    expect(state.captures).toEqual({ black: 3, white: 2 });
  });

  it('reports monotonic progress and completes automatically', async () => {
    const { topology, state } = sealedTwoLibertyDeath();
    const progress: { completedRegions: number; nodesExplored: number; phase: string }[] = [];
    await analyzeFinalProofSearch(
      { state, topology, groups: collectGroups(topology, state) },
      unresolvedProposal(topology, state),
      generousOptions,
      (update) => progress.push(update),
    );

    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)?.phase).toBe('complete');
    for (let index = 1; index < progress.length; index += 1) {
      expect(progress[index]!.completedRegions).toBeGreaterThanOrEqual(
        progress[index - 1]!.completedRegions,
      );
      expect(progress[index]!.nodesExplored).toBeGreaterThanOrEqual(
        progress[index - 1]!.nodesExplored,
      );
    }
  });
});
