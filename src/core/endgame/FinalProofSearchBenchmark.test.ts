import { describe, expect, it } from 'vitest';
import { GameEngine } from '../game/GameEngine';
import type { GameState } from '../game/types';
import { CubeTopology } from '../topology/CubeTopology';
import type { PointId, Topology } from '../topology/Topology';
import { TorusTopology } from '../topology/TorusTopology';
import { analyzeFinalGroupJudge } from './AssistedEndgameClassifier';
import { DEFAULT_FINAL_PROOF_SEARCH_BUDGET, runFinalProofSearch } from './FinalProofSearch';
import { EndgameTestLab } from './testlab/EndgameTestLab';

const collectStoneGroups = (topology: Topology, state: GameState): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];
  for (const point of [...topology.points()].sort()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = Object.freeze([...group.points].sort());
    for (const stone of points) visited.add(stone);
    groups.push(points);
  }
  return Object.freeze(groups);
};

const quantile = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0;
};

describe('Final Proof Search representative benchmark', () => {
  it('measures Cube/Torus small+large, many-group and local-fight cases', async () => {
    const lab = new EndgameTestLab();
    const fixtures = [
      lab.generate({ kind: 'endgame-position', topology: new CubeTopology(4), seed: 'final-proof-bench:cube4', maxMoves: 48 }),
      lab.generate({ kind: 'endgame-position', topology: new CubeTopology(7), seed: 'final-proof-bench:cube7', maxMoves: 96 }),
      lab.generate({ kind: 'endgame-position', topology: new TorusTopology(9), seed: 'final-proof-bench:torus9', maxMoves: 72 }),
      lab.generate({ kind: 'endgame-position', topology: new TorusTopology(19), seed: 'final-proof-bench:torus19', maxMoves: 120 }),
      lab.generate({ kind: 'endgame-position', topology: new TorusTopology(9), seed: 'final-proof-bench:many-groups', maxMoves: 120 }),
      lab.generate({ kind: 'life-death-pattern', topology: new CubeTopology(5), seed: 'final-proof-bench:local-fight', pattern: 'atari-group' }),
    ] as const;
    const labels = ['cube-4-small', 'cube-7-larger', 'torus-9-small', 'torus-19-larger', 'torus-9-many-groups', 'cube-5-local-fight'] as const;
    const rows: Array<Record<string, number | string>> = [];

    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index]!;
      const context = Object.freeze({
        state: fixture.state,
        topology: fixture.topology,
        groups: collectStoneGroups(fixture.topology, fixture.state),
      });
      const staticAnalysis = await analyzeFinalGroupJudge(context);
      const final = await runFinalProofSearch(context, staticAnalysis.proposal);
      const staticResolved = staticAnalysis.proposal.filter((group) => group.status !== 'unresolved').length;
      const totalMs = staticAnalysis.diagnostics.totalAnalysisMilliseconds + final.diagnostics.elapsedMilliseconds;
      rows.push({
        case: labels[index]!,
        groups: staticAnalysis.diagnostics.groupCount,
        staticMs: Number(staticAnalysis.diagnostics.totalAnalysisMilliseconds.toFixed(2)),
        proofMs: Number(final.diagnostics.elapsedMilliseconds.toFixed(2)),
        totalMs: Number(totalMs.toFixed(2)),
        staticResolved,
        proofResolved: final.diagnostics.resolvedAutomatically,
        nodes: final.diagnostics.exploredNodes,
        unresolvedBudget: final.diagnostics.outcomes.unresolvedBudget,
        unresolvedBoundary: final.diagnostics.outcomes.unresolvedBoundary,
        koDependent: final.diagnostics.outcomes.koDependent,
        stopReason: final.diagnostics.stopReason,
      });
      expect(totalMs).toBeLessThan(6_000);
    }

    const totals = rows.map((row) => Number(row.totalMs));
    const summary = {
      p50Ms: Number(quantile(totals, 0.5).toFixed(2)),
      p95Ms: Number(quantile(totals, 0.95).toFixed(2)),
      worstMs: Number(Math.max(...totals).toFixed(2)),
      productionBudget: DEFAULT_FINAL_PROOF_SEARCH_BUDGET,
      rows,
    };
    console.info(`[final-proof-benchmark] ${JSON.stringify(summary)}`);
    expect(summary.worstMs).toBeLessThan(6_000);
  }, 45_000);
});