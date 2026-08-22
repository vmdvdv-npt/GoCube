import {
  CUBE_FACES,
  CubeTopology,
  cubePointId,
  cubeStepPoint,
  type CubeDirection,
  type CubeFace,
} from '../../topology/CubeTopology';
import type { PointId } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import { DeterministicRandom } from './DeterministicRandom';
import {
  ENDGAME_TEST_GENERATOR_VERSION,
  endgameFixtureId,
  type EndgameTestFixture,
  type EndgameTestTopologyDescriptor,
  type StressPatternName,
  type SyntheticPlacement,
  type TopologyStressMode,
} from './EndgameFixture';
import {
  replaySyntheticPlacements,
  stressPatternDefinition,
  type PatternCell,
} from './PatternGenerators';

const freezePlacements = (
  placements: readonly SyntheticPlacement[],
): readonly SyntheticPlacement[] =>
  Object.freeze(
    [...placements]
      .sort((left, right) => (left.point < right.point ? -1 : left.point > right.point ? 1 : 0))
      .map((placement) => Object.freeze({ ...placement })),
  );

const torusStressPoint = (
  topology: TorusTopology,
  anchorX: number,
  anchorY: number,
  cell: PatternCell,
): PointId => `${(anchorX + cell.x) % topology.size},${(anchorY + cell.y) % topology.size}`;

const stepRepeatedly = (
  topology: CubeTopology,
  start: PointId,
  direction: CubeDirection,
  count: number,
): PointId => {
  let point = start;
  for (let index = 0; index < count; index += 1) {
    point = cubeStepPoint(topology.size, point, direction);
  }
  return point;
};

const cubeStressPoint = (
  topology: CubeTopology,
  anchor: PointId,
  cell: PatternCell,
  horizontalDirection: CubeDirection = 'right',
  verticalDirection: CubeDirection = 'bottom',
): PointId => {
  const horizontal = stepRepeatedly(topology, anchor, horizontalDirection, cell.x);
  return stepRepeatedly(topology, horizontal, verticalDirection, cell.y);
};

const assertUniquePlacements = (placements: readonly SyntheticPlacement[]): void => {
  const seen = new Set<PointId>();
  for (const placement of placements) {
    if (seen.has(placement.point)) {
      throw new Error(`Topology stress pattern maps multiple cells to point: ${placement.point}`);
    }
    seen.add(placement.point);
  }
};

const makePlacements = (
  topology: TorusTopology | CubeTopology,
  seed: string,
  mode: TopologyStressMode,
  cells: readonly PatternCell[],
  width: number,
  height: number,
): readonly SyntheticPlacement[] => {
  const random = new DeterministicRandom(seed);

  if (mode === 'torus-seam') {
    if (!(topology instanceof TorusTopology)) {
      throw new Error('torus-seam stress requires TorusTopology');
    }
    if (width > topology.size || height > topology.size) {
      throw new Error(`Stress pattern does not fit Torus ${topology.size}x${topology.size}`);
    }
    const anchorX = topology.size - 1;
    const anchorY = random.integer(topology.size - height + 1);
    const placements = cells.map((cell) => ({
      point: torusStressPoint(topology, anchorX, anchorY, cell),
      color: cell.color,
    }));
    assertUniquePlacements(placements);
    return freezePlacements(placements);
  }

  if (!(topology instanceof CubeTopology)) {
    throw new Error(`${mode} stress requires CubeTopology`);
  }
  if (topology.size < 3 || width > topology.size || height > topology.size) {
    throw new Error(`Cube topology stress requires size >= ${Math.max(3, width, height)}`);
  }

  const last = topology.size - 1;
  if (mode === 'cube-edge') {
    const face: CubeFace = random.pick(CUBE_FACES);
    const anchor = cubePointId(
      face,
      random.integer(topology.size - height + 1),
      last - 1,
    );
    const placements = cells.map((cell) => ({
      point: cubeStressPoint(topology, anchor, cell),
      color: cell.color,
    }));
    assertUniquePlacements(placements);
    return freezePlacements(placements);
  }

  const cornerCandidates: {
    readonly anchor: PointId;
    readonly horizontal: CubeDirection;
    readonly vertical: CubeDirection;
  }[] = [];
  for (const face of CUBE_FACES) {
    cornerCandidates.push(
      { anchor: cubePointId(face, last - 1, last - 1), horizontal: 'right', vertical: 'bottom' },
      { anchor: cubePointId(face, last - 1, 1), horizontal: 'left', vertical: 'bottom' },
      { anchor: cubePointId(face, 1, last - 1), horizontal: 'right', vertical: 'top' },
      { anchor: cubePointId(face, 1, 1), horizontal: 'left', vertical: 'top' },
    );
  }

  const validCandidates: readonly (readonly SyntheticPlacement[])[] = cornerCandidates
    .map((candidate) =>
      cells.map((cell) => ({
        point: cubeStressPoint(
          topology,
          candidate.anchor,
          cell,
          candidate.horizontal,
          candidate.vertical,
        ),
        color: cell.color,
      })),
    )
    .filter((placements) => {
      try {
        assertUniquePlacements(placements);
        replaySyntheticPlacements(topology, placements);
        return true;
      } catch {
        return false;
      }
    });

  if (validCandidates.length === 0) {
    throw new Error('No valid Cube corner embedding found for topology stress pattern');
  }
  return freezePlacements(random.pick(validCandidates));
};

export const generateTopologyStressFixture = (
  topology: TorusTopology | CubeTopology,
  descriptor: EndgameTestTopologyDescriptor,
  seedValue: string | number,
  mode: TopologyStressMode,
  pattern: StressPatternName,
): EndgameTestFixture => {
  const seed = String(seedValue);
  const definition = stressPatternDefinition(pattern);
  const placements = makePlacements(
    topology,
    seed,
    mode,
    definition.cells,
    definition.width,
    definition.height,
  );
  const metadata = Object.freeze({
    kind: 'topology-stress' as const,
    version: ENDGAME_TEST_GENERATOR_VERSION,
    seed,
    options: Object.freeze({ mode, pattern }),
  });

  return Object.freeze({
    fixtureId: endgameFixtureId(descriptor, metadata),
    topology: descriptor,
    state: replaySyntheticPlacements(topology, placements),
    commands: Object.freeze([]),
    placements,
    tags: Object.freeze(['topology-stress', mode, pattern]),
    generator: metadata,
  });
};
