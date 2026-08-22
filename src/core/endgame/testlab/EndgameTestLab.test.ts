import { describe, expect, it } from 'vitest';
import { ManualEndgameClassifier } from '../ManualEndgameClassifier';
import { CubeTopology } from '../../topology/CubeTopology';
import { TorusTopology } from '../../topology/TorusTopology';
import { DeterministicRandom } from './DeterministicRandom';
import {
  ENDGAME_TEST_LAB_PRESETS,
  EndgameTestLab,
  cubeFixtureFaces,
  endgameTestLabSeeds,
} from './EndgameTestLab';

describe('Deterministic Endgame Test Lab', () => {
  it('uses a stable seeded PRNG', () => {
    const first = new DeterministicRandom('stable-seed');
    const second = new DeterministicRandom('stable-seed');
    const different = new DeterministicRandom('different-seed');

    const firstSequence = Array.from({ length: 8 }, () => first.nextUint32());
    const secondSequence = Array.from({ length: 8 }, () => second.nextUint32());
    const differentSequence = Array.from({ length: 8 }, () => different.nextUint32());

    expect(secondSequence).toEqual(firstSequence);
    expect(differentSequence).not.toEqual(firstSequence);
  });

  it('generates and replays legal Torus games only through domain commands', () => {
    const lab = new EndgameTestLab();
    const request = {
      kind: 'legal-game' as const,
      topology: new TorusTopology(9),
      seed: 'legal-torus-17',
      maxMoves: 48,
    };

    const first = lab.generate(request);
    const second = lab.generate({ ...request, topology: new TorusTopology(9) });

    expect(second).toEqual(first);
    expect(first.generator).toEqual({
      kind: 'legal-game',
      version: 1,
      seed: 'legal-torus-17',
      options: { maxMoves: 48 },
    });
    expect(first.commands.length).toBeGreaterThan(0);
    expect(first.commands.every((command) => command.type === 'place-stone')).toBe(true);
    expect(first.placements).toEqual([]);
    expect(lab.replayState(first)).toEqual(first.state);
    expect(lab.replay(first)).toEqual(first);
  });

  it('generates reproducible Cube endgame positions by finishing a legal simulation with two Passes', () => {
    const lab = new EndgameTestLab();
    const fixture = lab.generate({
      kind: 'endgame-position',
      topology: new CubeTopology(4),
      seed: 'cube-endgame-4',
      maxMoves: 36,
    });

    expect(fixture.state.phase).toBe('endgame');
    expect(fixture.state.consecutivePasses).toBe(2);
    expect(fixture.commands.slice(-2)).toEqual([{ type: 'pass' }, { type: 'pass' }]);
    expect(fixture.placements).toEqual([]);
    expect(lab.replayState(fixture)).toEqual(fixture.state);
    expect(lab.replay(fixture)).toEqual(fixture);
  });

  it('builds curated life/death and seki-like fixtures as validated test-only synthetic states', () => {
    const lab = new EndgameTestLab();
    const life = lab.generate({
      kind: 'life-death-pattern',
      topology: new CubeTopology(5),
      seed: 'two-eyes-cube',
      pattern: 'two-eyes',
    });
    const seki = lab.generate({
      kind: 'seki-pattern',
      topology: new TorusTopology(9),
      seed: 'shared-liberties-torus',
      pattern: 'shared-liberties',
    });

    expect(life.state.phase).toBe('endgame');
    expect(life.commands).toEqual([]);
    expect(life.placements.length).toBe(13);
    expect(cubeFixtureFaces(life)).toHaveLength(1);
    expect(lab.replayState(life)).toEqual(life.state);
    expect(lab.replay(life)).toEqual(life);

    expect(seki.state.phase).toBe('endgame');
    expect(seki.commands).toEqual([]);
    expect(seki.placements.length).toBe(6);
    expect(lab.replayState(seki)).toEqual(seki.state);
    expect(lab.replay(seki)).toEqual(seki);
  });

  it('moves applicable patterns across a Torus seam with deterministic replay', () => {
    const lab = new EndgameTestLab();
    const fixture = lab.generate({
      kind: 'topology-stress',
      topology: new TorusTopology(9),
      seed: 'torus-seam-case',
      mode: 'torus-seam',
      pattern: 'single-eye',
    });
    const xCoordinates = new Set(
      fixture.placements.map((placement) => Number(placement.point.split(',')[0])),
    );

    expect(xCoordinates.has(8)).toBe(true);
    expect(xCoordinates.has(0)).toBe(true);
    expect(fixture.tags).toContain('torus-seam');
    expect(lab.replay(fixture)).toEqual(fixture);
  });

  it('moves patterns across Cube edges and physical corner regions without duplicate PointIds', () => {
    const lab = new EndgameTestLab();
    const edge = lab.generate({
      kind: 'topology-stress',
      topology: new CubeTopology(5),
      seed: 'cube-edge-case',
      mode: 'cube-edge',
      pattern: 'false-eye',
    });
    const corner = lab.generate({
      kind: 'topology-stress',
      topology: new CubeTopology(5),
      seed: 'cube-corner-case',
      mode: 'cube-corner',
      pattern: 'shared-liberties',
    });

    expect(cubeFixtureFaces(edge).length).toBeGreaterThanOrEqual(2);
    expect(cubeFixtureFaces(corner).length).toBeGreaterThanOrEqual(3);
    expect(new Set(edge.placements.map((placement) => placement.point)).size).toBe(
      edge.placements.length,
    );
    expect(new Set(corner.placements.map((placement) => placement.point)).size).toBe(
      corner.placements.length,
    );
    expect(lab.replay(edge)).toEqual(edge);
    expect(lab.replay(corner)).toEqual(corner);
  });

  it('keeps Cube edge/corner stress embeddings valid across a fixed-seed sweep', () => {
    const lab = new EndgameTestLab();
    const patterns = ['single-eye', 'false-eye', 'shared-liberties'] as const;
    const modes = ['cube-edge', 'cube-corner'] as const;

    for (let seedIndex = 0; seedIndex < 24; seedIndex += 1) {
      for (const pattern of patterns) {
        for (const mode of modes) {
          const fixture = lab.generate({
            kind: 'topology-stress',
            topology: new CubeTopology(5),
            seed: `cube-stress-${seedIndex}`,
            mode,
            pattern,
          });

          expect(new Set(fixture.placements.map((placement) => placement.point)).size).toBe(
            fixture.placements.length,
          );
          expect(cubeFixtureFaces(fixture).length).toBeGreaterThanOrEqual(
            mode === 'cube-corner' ? 3 : 2,
          );
          expect(lab.replay(fixture)).toEqual(fixture);
        }
      }
    }
  });

  it('runs the current classifier headlessly against generated fixtures', async () => {
    const lab = new EndgameTestLab();
    const fixture = lab.generate({
      kind: 'life-death-pattern',
      topology: new TorusTopology(9),
      seed: 'classifier-case',
      pattern: 'single-eye',
    });

    const proposal = await lab.analyze(fixture, new ManualEndgameClassifier());

    expect(proposal.length).toBeGreaterThan(0);
    expect(proposal.every((group) => group.status === 'unresolved')).toBe(true);
    expect(proposal.flatMap((group) => group.points).sort()).toEqual(
      fixture.placements.map((placement) => placement.point).sort(),
    );
  });

  it('provides stable Quick, Full and Deep seed batches without running them implicitly', () => {
    expect(ENDGAME_TEST_LAB_PRESETS).toEqual({ Quick: 8, Full: 64, Deep: 512 });
    expect(endgameTestLabSeeds('batch', 'Quick')).toEqual(
      Array.from({ length: 8 }, (_, index) => `batch:${index}`),
    );
    expect(endgameTestLabSeeds('batch', 'Full')).toHaveLength(64);
    expect(endgameTestLabSeeds('batch', 'Deep')).toHaveLength(512);
  });

  it('replays an empty legal simulation as a playing state instead of treating it as synthetic', () => {
    const lab = new EndgameTestLab();
    const fixture = lab.generate({
      kind: 'legal-game',
      topology: new TorusTopology(9),
      seed: 'empty-legal',
      maxMoves: 0,
    });

    expect(fixture.commands).toEqual([]);
    expect(fixture.placements).toEqual([]);
    expect(fixture.state.phase).toBe('playing');
    expect(lab.replayState(fixture)).toEqual(fixture.state);
  });
});
