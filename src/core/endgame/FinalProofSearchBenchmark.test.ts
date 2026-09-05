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
  it('measures automatic-resolution gain, proof tiers, failures and runtime on representative Cube/Torus cases', async () => {
    const lab = new EndgameTestLab();
    const cube4 = new CubeTopology(4);
    const cube7 = new CubeTopology(7);
    const torus9Small = new TorusTopology(9);
    const torus19 = new TorusTopology(19);
    const torus9Many = new TorusTopology(9);
    const cube5Fight = new CubeTopology(5);
    const cases = [
      {
        label: 'cube-4-small',
        topology: cube4,
        fixture: lab.generate({ kind: 'endgame-position', topology: cube4, seed: 'final-proof-bench:cube4', maxMoves: 48 }),
      },
      {
        label: 'cube-7-larger',
        topology: cube7,
        fixture: lab.generate({ kind: 'endgame-position', topology: cube7, seed: 'final-proof-bench:cube7', maxMoves: 96 }),
      },
      {
        label: 'torus-9-small',
        topology: torus9Small,
        fixture: lab.generate({ kind: 'endgame-position', topology: torus9Small, seed: 'final-proof-bench:torus9', maxMoves: 72 }),
      },
      {
        label: 'torus-19-larger',
        topology: torus19,
        fixture: lab.generate({ kind: 'endgame-position', topology: torus19, seed: 'final-proof-bench:torus19', maxMoves: 120 }),
      },
      {
        label: 'torus-9-many-groups',
        topology: torus9Many,
        fixture: lab.generate({ kind: 'endgame-position', topology: torus9Many, seed: 'final-proof-bench:many-groups', maxMoves: 120 }),
      },
      {
        label: 'cube-5-local-fight',
        topology: cube5Fight,
        fixture: lab.generate({ kind: 'life-death-pattern', topology: cube5Fight, seed: 'final-proof-bench:local-fight', pattern: 'atari-group' }),
      },
    ] as const;
    const rows: Array<Record<string, number | string>> = [];

    for (const benchmarkCase of cases) {
      const { fixture, topology } = benchmarkCase;
      const context = Object.freeze({
        state: fixture.state,
        topology,
        groups: collectStoneGroups(topology, fixture.state),
      });
      const staticAnalysis = await analyzeFinalGroupJudge(context);
      const final = await runFinalProofSearch(context, staticAnalysis.proposal);
      const staticResolvedGroups = staticAnalysis.proposal.filter((group) => group.status !== 'unresolved');
      const finalResolvedGroups = final.proposal.filter((group) => group.status !== 'unresolved');
      const dynamicProofGroups = final.proposal.filter((group) => group.evidence?.algorithm === 'final-proof-search-v2');
      const staticResolved = staticResolvedGroups.length;
      const finalResolved = finalResolvedGroups.length;
      const dynamicResolved = finalResolved - staticResolved;
      const staticAlive = staticResolvedGroups.filter((group) => group.status === 'alive').length;
      const staticDead = staticResolvedGroups.filter((group) => group.status === 'dead').length;
      const staticSeki = staticResolvedGroups.filter((group) => group.status === 'seki').length;
      const totalMs = staticAnalysis.diagnostics.totalAnalysisMilliseconds + final.diagnostics.elapsedMilliseconds;
      const diagnostics = final.diagnostics;

      expect(dynamicProofGroups).toHaveLength(diagnostics.resolvedAutomatically);
      expect(dynamicResolved).toBe(diagnostics.resolvedAutomatically);
      expect(
        diagnostics.resolvedByTier.tactical +
        diagnostics.resolvedByTier.localLifeDeath +
        diagnostics.resolvedByTier.semeai +
        diagnostics.resolvedByTier.seki,
      ).toBe(diagnostics.resolvedAutomatically);

      rows.push({
        case: benchmarkCase.label,
        groups: staticAnalysis.diagnostics.groupCount,
        staticMs: Number(staticAnalysis.diagnostics.totalAnalysisMilliseconds.toFixed(2)),
        proofMs: Number(diagnostics.elapsedMilliseconds.toFixed(2)),
        totalMs: Number(totalMs.toFixed(2)),
        staticResolved,
        finalResolved,
        dynamicResolved,
        staticAlive,
        staticDead,
        staticSeki,
        tacticalResolved: diagnostics.resolvedByTier.tactical,
        localLifeDeathResolved: diagnostics.resolvedByTier.localLifeDeath,
        semeaiResolved: diagnostics.resolvedByTier.semeai,
        dynamicSekiResolved: diagnostics.resolvedByTier.seki,
        tacticalNodes: diagnostics.nodesByTier.tactical,
        localLifeDeathNodes: diagnostics.nodesByTier.localLifeDeath,
        semeaiNodes: diagnostics.nodesByTier.semeai,
        dynamicSekiNodes: diagnostics.nodesByTier.seki,
        totalNodes: diagnostics.exploredNodes,
        unresolvedBudget: diagnostics.outcomes.unresolvedBudget,
        unresolvedBoundary: diagnostics.outcomes.unresolvedBoundary,
        koDependent: diagnostics.outcomes.koDependent,
        unresolvedCycle: diagnostics.outcomes.unresolvedCycle,
        unresolvedIncomplete: diagnostics.outcomes.unresolvedIncomplete,
        unresolvedOther: diagnostics.outcomes.unresolvedOther,
        zoneTooLarge: diagnostics.diagnosticFailures.zoneTooLarge,
        zoneOpenBoundary: diagnostics.diagnosticFailures.zoneOpenBoundary,
        zoneWholeTopology: diagnostics.diagnosticFailures.zoneWholeTopology,
        targetIdentityUncertain: diagnostics.diagnosticFailures.targetIdentityUncertain,
        noUsefulLocalCandidate: diagnostics.diagnosticFailures.noUsefulLocalCandidate,
        maxCooperativeSliceMs: Number(diagnostics.maxObservedCooperativeSliceMilliseconds.toFixed(2)),
        stopReason: diagnostics.stopReason,
      });
      expect(totalMs).toBeLessThan(6_000);
    }

    const totals = rows.map((row) => Number(row.totalMs));
    const totalStaticResolved = rows.reduce((sum, row) => sum + Number(row.staticResolved), 0);
    const totalFinalResolved = rows.reduce((sum, row) => sum + Number(row.finalResolved), 0);
    const summary = {
      p50Ms: Number(quantile(totals, 0.5).toFixed(2)),
      p95Ms: Number(quantile(totals, 0.95).toFixed(2)),
      worstMs: Number(Math.max(...totals).toFixed(2)),
      staticResolved: totalStaticResolved,
      finalResolved: totalFinalResolved,
      automaticResolutionGain: totalFinalResolved - totalStaticResolved,
      resolvedByTier: {
        tactical: rows.reduce((sum, row) => sum + Number(row.tacticalResolved), 0),
        localLifeDeath: rows.reduce((sum, row) => sum + Number(row.localLifeDeathResolved), 0),
        semeai: rows.reduce((sum, row) => sum + Number(row.semeaiResolved), 0),
        dynamicSeki: rows.reduce((sum, row) => sum + Number(row.dynamicSekiResolved), 0),
      },
      productionBudget: DEFAULT_FINAL_PROOF_SEARCH_BUDGET,
      rows,
    };
    console.info(`[final-proof-benchmark] ${JSON.stringify(summary)}`);
    expect(summary.finalResolved).toBeGreaterThanOrEqual(summary.staticResolved);
    expect(summary.worstMs).toBeLessThan(6_000);
  }, 45_000);
});
