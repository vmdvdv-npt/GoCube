import { describe, expect, it } from 'vitest';
import { ManualEndgameClassifier } from '../ManualEndgameClassifier';
import { TorusTopology } from '../../topology/TorusTopology';
import type { DifferentialOracleAdapter } from './DifferentialOracle';
import { EndgameTestLab } from './EndgameTestLab';

describe('EndgameTestLab oracle orchestration', () => {
  it('replays the classifier/oracle boundary through the lab without making the oracle authoritative', async () => {
    const lab = new EndgameTestLab();
    const fixture = lab.generate({
      kind: 'life-death-pattern',
      topology: new TorusTopology(9),
      seed: 'lab-oracle-orchestration',
      pattern: 'single-eye',
    });
    const target = fixture.placements[0]?.point;
    expect(target).toBeDefined();
    if (!target) return;

    const adapter: DifferentialOracleAdapter<{ readonly diagnostic: 'candidate-only' }> = {
      id: 'test-diagnostic-oracle',
      async availability() {
        return { available: true, version: 'test' };
      },
      async analyze() {
        return { diagnostic: 'candidate-only' };
      },
    };

    const result = await lab.compareWithOracle(
      fixture,
      new ManualEndgameClassifier(),
      adapter,
      (_internal, oracle) => oracle.diagnostic === 'candidate-only',
      { targetPoints: [target], radius: 1 },
    );

    expect(result.status).toBe('match');
    if (result.status !== 'match') return;
    expect(result.oracleId).toBe('test-diagnostic-oracle');
    expect(result.internalResult.every((group) => group.status === 'unresolved')).toBe(true);
    expect(result.oracleResult).toEqual({ diagnostic: 'candidate-only' });
  });
});
