import { describe, expect, it } from 'vitest';
import { ManualEndgameClassifier } from '../ManualEndgameClassifier';
import { CubeTopology, cubePointId } from '../../topology/CubeTopology';
import { TorusTopology } from '../../topology/TorusTopology';
import { EndgameTestLab } from './EndgameTestLab';
import {
  runDifferentialOracle,
  serializeOracleMismatch,
  type DifferentialOracleAdapter,
  type PlanarOraclePosition,
} from './DifferentialOracle';
import { analyzePlanarLocalNeighborhood } from './PlanarLocalAnalyzer';

describe('Differential oracle infrastructure', () => {
  it('embeds an ordinary Torus local neighborhood into a standard square grid', () => {
    const lab = new EndgameTestLab();
    const topology = new TorusTopology(9);
    const fixture = lab.generate({
      kind: 'legal-game',
      topology,
      seed: 'planar-torus-empty',
      maxMoves: 0,
    });

    const result = analyzePlanarLocalNeighborhood(topology, fixture.state, ['4,4'], {
      radius: 2,
      boardSize: 19,
      margin: 3,
    });

    expect(result.status).toBe('applicable');
    if (result.status !== 'applicable') return;
    expect(result.projection.targetPoints).toEqual(['4,4']);
    expect(result.projection.points).toHaveLength(13);
    expect(new Set(result.projection.points.map(({ row, column }) => `${row},${column}`)).size).toBe(
      result.projection.points.length,
    );
  });

  it('rejects a Cube physical-corner neighborhood instead of pretending it is planar Go', () => {
    const lab = new EndgameTestLab();
    const topology = new CubeTopology(5);
    const fixture = lab.generate({
      kind: 'legal-game',
      topology,
      seed: 'cube-corner-empty',
      maxMoves: 0,
    });

    const result = analyzePlanarLocalNeighborhood(
      topology,
      fixture.state,
      [cubePointId('front', 0, 0)],
      { radius: 1 },
    );

    expect(result).toMatchObject({
      status: 'not-applicable',
      reason: 'non-square-grid-neighborhood',
    });
  });

  it('runs a swappable oracle deterministically on a generated fixture', async () => {
    const lab = new EndgameTestLab();
    const topology = new TorusTopology(9);
    const fixture = lab.generate({
      kind: 'life-death-pattern',
      topology,
      seed: 'oracle-match',
      pattern: 'single-eye',
    });
    const internal = await lab.analyze(fixture, new ManualEndgameClassifier());
    let received: PlanarOraclePosition | undefined;
    const adapter: DifferentialOracleAdapter<{ verdict: string }> = {
      id: 'fake-reference',
      async availability() {
        return { available: true, version: 'test-1' };
      },
      async analyze(position) {
        received = position;
        return { verdict: 'same' };
      },
    };

    const result = await runDifferentialOracle(
      fixture,
      topology,
      internal,
      adapter,
      (_internal, oracle) => oracle.verdict === 'same',
      { targetPoints: [fixture.placements[0]?.point ?? '4,4'], radius: 1 },
    );

    expect(result.status).toBe('match');
    expect(received?.boardSize).toBe(19);
    expect(received?.targetCoordinates).toHaveLength(1);
  });

  it('captures a reproducible mismatch with seed, action trace and both results', async () => {
    const lab = new EndgameTestLab();
    const topology = new TorusTopology(9);
    const fixture = lab.generate({
      kind: 'legal-game',
      topology,
      seed: 'oracle-mismatch-seed',
      maxMoves: 4,
    });
    const internal = await lab.analyze(fixture, new ManualEndgameClassifier());
    const adapter: DifferentialOracleAdapter<{ legal: boolean }> = {
      id: 'independent-rules-engine',
      async availability() {
        return { available: true };
      },
      async analyze() {
        return { legal: false };
      },
    };
    const target = fixture.commands.find((command) => command.type === 'place-stone');
    expect(target?.type).toBe('place-stone');
    if (!target || target.type !== 'place-stone') return;

    const result = await runDifferentialOracle(
      fixture,
      topology,
      internal,
      adapter,
      () => false,
      { targetPoints: [target.point], radius: 1 },
    );

    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') return;
    expect(result.capture.seed).toBe('oracle-mismatch-seed');
    expect(result.capture.fixtureId).toBe(fixture.fixtureId);
    expect(result.capture.actionTrace).toEqual(fixture.commands);
    expect(result.capture.internalResult).toEqual(internal);
    expect(result.capture.oracleResult).toEqual({ legal: false });

    const exported = JSON.parse(serializeOracleMismatch(result.capture)) as {
      seed: string;
      actionTrace: unknown[];
      fixture: { fixtureId: string };
    };
    expect(exported.seed).toBe('oracle-mismatch-seed');
    expect(exported.actionTrace).toEqual(fixture.commands);
    expect(exported.fixture.fixtureId).toBe(fixture.fixtureId);
  });

  it('reports unsupported external-engine setups without failing the primary lab run', async () => {
    const lab = new EndgameTestLab();
    const topology = new TorusTopology(9);
    const fixture = lab.generate({
      kind: 'legal-game',
      topology,
      seed: 'oracle-unavailable',
      maxMoves: 0,
    });
    const internal = await lab.analyze(fixture, new ManualEndgameClassifier());
    let analyzeCalled = false;
    const adapter: DifferentialOracleAdapter = {
      id: 'missing-engine',
      async availability() {
        return { available: false, reason: 'engine executable not configured' };
      },
      async analyze() {
        analyzeCalled = true;
        return {};
      },
    };

    const result = await runDifferentialOracle(
      fixture,
      topology,
      internal,
      adapter,
      () => true,
      { targetPoints: ['4,4'], radius: 1 },
    );

    expect(result).toEqual({
      status: 'unavailable',
      oracleId: 'missing-engine',
      reason: 'engine executable not configured',
    });
    expect(analyzeCalled).toBe(false);
  });

  it('contains oracle execution failures as diagnostics instead of corrupting the fixture result', async () => {
    const lab = new EndgameTestLab();
    const topology = new TorusTopology(9);
    const fixture = lab.generate({
      kind: 'legal-game',
      topology,
      seed: 'oracle-error',
      maxMoves: 0,
    });
    const internal = await lab.analyze(fixture, new ManualEndgameClassifier());
    const adapter: DifferentialOracleAdapter = {
      id: 'broken-engine',
      async availability() {
        return { available: true };
      },
      async analyze() {
        throw new Error('engine crashed');
      },
    };

    const result = await runDifferentialOracle(
      fixture,
      topology,
      internal,
      adapter,
      () => true,
      { targetPoints: ['4,4'], radius: 1 },
    );

    expect(result).toEqual({
      status: 'error',
      oracleId: 'broken-engine',
      reason: 'Oracle analysis failed: engine crashed',
    });
  });
});
