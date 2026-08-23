import type { EndgameClassifier, EndgameProposal } from '../EndgameClassifier';
import { GameEngine } from '../../game/GameEngine';
import type { GameState } from '../../game/types';
import {
  CUBE_FACES,
  CubeTopology,
  type CubeFace,
} from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import {
  TORUS_SIZES,
  TorusTopology,
  type TorusSize,
} from '../../topology/TorusTopology';
import {
  ENDGAME_TEST_GENERATOR_VERSION,
  type EndgameGeneratorMetadata,
  type EndgameTestFixture,
  type EndgameTestTopologyDescriptor,
  type LifeDeathPatternName,
  type SekiPatternName,
  type StressPatternName,
  type TopologyStressMode,
} from './EndgameFixture';
import {
  runDifferentialOracle,
  type DifferentialOracleAdapter,
  type DifferentialOracleRunOptions,
  type DifferentialOracleRunResult,
  type OracleResultComparator,
} from './DifferentialOracle';
import {
  generateEndgamePositionFixture,
  generateLegalGameFixture,
  replayGeneratedCommands,
} from './LegalPositionGenerators';
import {
  generateLifeDeathPatternFixture,
  generateSekiPatternFixture,
  replaySyntheticPlacements,
} from './PatternGenerators';
import { generateTopologyStressFixture } from './TopologyStressGenerator';

export type EndgameTestTopology = TorusTopology | CubeTopology;

export type EndgameTestLabRequest =
  | Readonly<{
      kind: 'legal-game';
      topology: EndgameTestTopology;
      seed: string | number;
      maxMoves?: number;
    }>
  | Readonly<{
      kind: 'endgame-position';
      topology: EndgameTestTopology;
      seed: string | number;
      maxMoves?: number;
    }>
  | Readonly<{
      kind: 'life-death-pattern';
      topology: EndgameTestTopology;
      seed: string | number;
      pattern: LifeDeathPatternName;
    }>
  | Readonly<{
      kind: 'seki-pattern';
      topology: EndgameTestTopology;
      seed: string | number;
      pattern: SekiPatternName;
    }>
  | Readonly<{
      kind: 'topology-stress';
      topology: EndgameTestTopology;
      seed: string | number;
      mode: TopologyStressMode;
      pattern: StressPatternName;
    }>;

export const ENDGAME_TEST_LAB_PRESETS = Object.freeze({
  Quick: 8,
  Full: 64,
  Deep: 512,
} as const);
export type EndgameTestLabPreset = keyof typeof ENDGAME_TEST_LAB_PRESETS;

export const endgameTestLabSeeds = (
  baseSeed: string | number,
  preset: EndgameTestLabPreset,
): readonly string[] =>
  Object.freeze(
    Array.from(
      { length: ENDGAME_TEST_LAB_PRESETS[preset] },
      (_, index) => `${String(baseSeed)}:${index}`,
    ),
  );

export const describeEndgameTestTopology = (
  topology: EndgameTestTopology,
): EndgameTestTopologyDescriptor => {
  if (topology instanceof TorusTopology) {
    return Object.freeze({ kind: 'torus', size: topology.size, id: topology.id });
  }
  return Object.freeze({ kind: 'cube', size: topology.size, id: topology.id });
};

const createTopology = (descriptor: EndgameTestTopologyDescriptor): EndgameTestTopology => {
  if (descriptor.kind === 'torus') {
    if (!TORUS_SIZES.includes(descriptor.size as TorusSize)) {
      throw new Error(`Unsupported fixture Torus size: ${descriptor.size}`);
    }
    const topology = new TorusTopology(descriptor.size as TorusSize);
    if (topology.id !== descriptor.id) throw new Error('Fixture topology id does not match descriptor');
    return topology;
  }

  const topology = new CubeTopology(descriptor.size);
  if (topology.id !== descriptor.id) throw new Error('Fixture topology id does not match descriptor');
  return topology;
};

const collectStoneGroups = (
  state: GameState,
  topology: Topology,
): readonly (readonly PointId[])[] => {
  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  const groups: (readonly PointId[])[] = [];

  for (const point of [...topology.points()].sort()) {
    if (visited.has(point) || state.board[point] === 'empty') continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    const points = Object.freeze([...group.points].sort());
    for (const groupPoint of points) visited.add(groupPoint);
    groups.push(points);
  }

  return Object.freeze(groups);
};

const requestFromMetadata = (
  topology: EndgameTestTopology,
  metadata: EndgameGeneratorMetadata,
): EndgameTestLabRequest => {
  if (metadata.version !== ENDGAME_TEST_GENERATOR_VERSION) {
    throw new Error(`Unsupported generator version: ${metadata.version}`);
  }

  switch (metadata.kind) {
    case 'legal-game':
      return Object.freeze({
        kind: metadata.kind,
        topology,
        seed: metadata.seed,
        maxMoves: metadata.options.maxMoves,
      });
    case 'endgame-position':
      return Object.freeze({
        kind: metadata.kind,
        topology,
        seed: metadata.seed,
        maxMoves: metadata.options.maxMoves,
      });
    case 'life-death-pattern':
      return Object.freeze({
        kind: metadata.kind,
        topology,
        seed: metadata.seed,
        pattern: metadata.options.pattern,
      });
    case 'seki-pattern':
      return Object.freeze({
        kind: metadata.kind,
        topology,
        seed: metadata.seed,
        pattern: metadata.options.pattern,
      });
    case 'topology-stress':
      return Object.freeze({
        kind: metadata.kind,
        topology,
        seed: metadata.seed,
        mode: metadata.options.mode,
        pattern: metadata.options.pattern,
      });
  }
};

export class EndgameTestLab {
  generate(request: EndgameTestLabRequest): EndgameTestFixture {
    const descriptor = describeEndgameTestTopology(request.topology);

    switch (request.kind) {
      case 'legal-game':
        return generateLegalGameFixture(request.topology, descriptor, {
          seed: request.seed,
          maxMoves: request.maxMoves,
        });
      case 'endgame-position':
        return generateEndgamePositionFixture(request.topology, descriptor, {
          seed: request.seed,
          maxMoves: request.maxMoves,
        });
      case 'life-death-pattern':
        return generateLifeDeathPatternFixture(
          request.topology,
          descriptor,
          request.seed,
          request.pattern,
        );
      case 'seki-pattern':
        return generateSekiPatternFixture(
          request.topology,
          descriptor,
          request.seed,
          request.pattern,
        );
      case 'topology-stress':
        return generateTopologyStressFixture(
          request.topology,
          descriptor,
          request.seed,
          request.mode,
          request.pattern,
        );
    }
  }

  replay(fixture: EndgameTestFixture): EndgameTestFixture {
    const topology = createTopology(fixture.topology);
    return this.generate(requestFromMetadata(topology, fixture.generator));
  }

  replayState(fixture: EndgameTestFixture): GameState {
    const topology = createTopology(fixture.topology);
    if (fixture.generator.kind === 'legal-game' || fixture.generator.kind === 'endgame-position') {
      return replayGeneratedCommands(topology, fixture.commands);
    }
    return replaySyntheticPlacements(topology, fixture.placements);
  }

  async analyze(
    fixture: EndgameTestFixture,
    classifier: EndgameClassifier,
  ): Promise<EndgameProposal> {
    const topology = createTopology(fixture.topology);
    const groups = collectStoneGroups(fixture.state, topology);
    return classifier.analyze(Object.freeze({ state: fixture.state, topology, groups }));
  }

  async compareWithOracle<TResult>(
    fixture: EndgameTestFixture,
    classifier: EndgameClassifier,
    adapter: DifferentialOracleAdapter<TResult>,
    comparator: OracleResultComparator<TResult>,
    options: DifferentialOracleRunOptions,
  ): Promise<DifferentialOracleRunResult<TResult>> {
    const topology = createTopology(fixture.topology);
    const groups = collectStoneGroups(fixture.state, topology);
    const internalResult = await classifier.analyze(
      Object.freeze({ state: fixture.state, topology, groups }),
    );
    return runDifferentialOracle(
      fixture,
      topology,
      internalResult,
      adapter,
      comparator,
      options,
    );
  }
}

export const cubeFixtureFaces = (fixture: EndgameTestFixture): readonly CubeFace[] => {
  if (fixture.topology.kind !== 'cube') return Object.freeze([]);
  const faceSet = new Set<CubeFace>();
  for (const placement of fixture.placements) {
    const face = placement.point.split(':')[0];
    if (CUBE_FACES.includes(face as CubeFace)) faceSet.add(face as CubeFace);
  }
  return Object.freeze([...faceSet].sort());
};
