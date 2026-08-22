import { GameEngine } from '../../game/GameEngine';
import type { GameState, PointOccupancy, StoneColor } from '../../game/types';
import { CUBE_FACES, CubeTopology, cubePointId } from '../../topology/CubeTopology';
import type { PointId, Topology } from '../../topology/Topology';
import { TorusTopology } from '../../topology/TorusTopology';
import { DeterministicRandom } from './DeterministicRandom';
import {
  ENDGAME_TEST_GENERATOR_VERSION,
  endgameFixtureId,
  type EndgameTestFixture,
  type EndgameTestTopologyDescriptor,
  type LifeDeathPatternName,
  type SekiPatternName,
  type StressPatternName,
  type SyntheticPlacement,
} from './EndgameFixture';

export interface PatternCell {
  readonly x: number;
  readonly y: number;
  readonly color: StoneColor;
}

export interface PatternDefinition {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly PatternCell[];
  readonly tags: readonly string[];
}

const cells = (...entries: readonly (readonly [number, number, StoneColor])[]): readonly PatternCell[] =>
  Object.freeze(entries.map(([x, y, color]) => Object.freeze({ x, y, color })));

const LIFE_DEATH_PATTERNS: Readonly<Record<LifeDeathPatternName, PatternDefinition>> = Object.freeze({
  'single-eye': Object.freeze({
    width: 3,
    height: 3,
    cells: cells(
      [0, 0, 'black'], [1, 0, 'black'], [2, 0, 'black'],
      [0, 1, 'black'],                   [2, 1, 'black'],
      [0, 2, 'black'], [1, 2, 'black'], [2, 2, 'black'],
    ),
    tags: Object.freeze(['life-death', 'one-eye']),
  }),
  'two-eyes': Object.freeze({
    width: 5,
    height: 3,
    cells: cells(
      [0, 0, 'black'], [1, 0, 'black'], [2, 0, 'black'], [3, 0, 'black'], [4, 0, 'black'],
      [0, 1, 'black'],                   [2, 1, 'black'],                   [4, 1, 'black'],
      [0, 2, 'black'], [1, 2, 'black'], [2, 2, 'black'], [3, 2, 'black'], [4, 2, 'black'],
    ),
    tags: Object.freeze(['life-death', 'two-eyes']),
  }),
  'false-eye': Object.freeze({
    width: 3,
    height: 3,
    cells: cells(
      [0, 0, 'black'], [1, 0, 'black'], [2, 0, 'black'],
      [0, 1, 'black'],                   [2, 1, 'black'],
      [0, 2, 'black'], [1, 2, 'black'], [2, 2, 'white'],
    ),
    tags: Object.freeze(['life-death', 'false-eye']),
  }),
  'atari-group': Object.freeze({
    width: 3,
    height: 3,
    cells: cells(
                        [1, 0, 'white'],
      [0, 1, 'white'], [1, 1, 'black'],
                        [1, 2, 'white'],
    ),
    tags: Object.freeze(['life-death', 'atari']),
  }),
});

const SEKI_PATTERNS: Readonly<Record<SekiPatternName, PatternDefinition>> = Object.freeze({
  'shared-liberties': Object.freeze({
    width: 3,
    height: 3,
    cells: cells(
      [0, 0, 'black'],                   [2, 0, 'white'],
      [0, 1, 'black'],                   [2, 1, 'white'],
      [0, 2, 'black'],                   [2, 2, 'white'],
    ),
    tags: Object.freeze(['seki-like', 'shared-liberties']),
  }),
  'ambiguous-contact': Object.freeze({
    width: 3,
    height: 3,
    cells: cells(
      [0, 0, 'black'], [1, 0, 'black'],
      [0, 1, 'black'],                   [2, 1, 'white'],
                        [1, 2, 'white'], [2, 2, 'white'],
    ),
    tags: Object.freeze(['seki-like', 'ambiguous']),
  }),
});

export const stressPatternDefinition = (name: StressPatternName): PatternDefinition => {
  if (name === 'shared-liberties') return SEKI_PATTERNS[name];
  return LIFE_DEATH_PATTERNS[name];
};

const buildSyntheticEndgameState = (
  topology: Topology,
  placements: readonly SyntheticPlacement[],
): GameState => {
  const board: Record<PointId, PointOccupancy> = {};
  for (const point of topology.points()) board[point] = 'empty';

  const seen = new Set<PointId>();
  for (const placement of placements) {
    if (!topology.has(placement.point)) {
      throw new Error(`Synthetic pattern contains unknown point: ${placement.point}`);
    }
    if (seen.has(placement.point)) {
      throw new Error(`Synthetic pattern maps multiple cells to point: ${placement.point}`);
    }
    seen.add(placement.point);
    board[placement.point] = placement.color;
  }

  const state: GameState = Object.freeze({
    board: Object.freeze(board),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
  });

  const engine = new GameEngine(topology);
  const visited = new Set<PointId>();
  for (const placement of placements) {
    if (visited.has(placement.point)) continue;
    const group = engine.groupAt(state, placement.point);
    if (!group) throw new Error(`Synthetic pattern lost stone at point: ${placement.point}`);
    for (const point of group.points) visited.add(point);
    if (group.liberties.length === 0) {
      throw new Error(`Synthetic pattern contains a zero-liberty group at: ${placement.point}`);
    }
  }

  return state;
};

const freezePlacements = (placements: readonly SyntheticPlacement[]): readonly SyntheticPlacement[] =>
  Object.freeze(
    [...placements]
      .sort((left, right) => (left.point < right.point ? -1 : left.point > right.point ? 1 : 0))
      .map((placement) => Object.freeze({ ...placement })),
  );

const localPlacements = (
  topology: TorusTopology | CubeTopology,
  definition: PatternDefinition,
  seed: string,
): readonly SyntheticPlacement[] => {
  const random = new DeterministicRandom(seed);

  if (topology instanceof TorusTopology) {
    if (definition.width > topology.size || definition.height > topology.size) {
      throw new Error(`Pattern does not fit Torus ${topology.size}x${topology.size}`);
    }
    const anchorX = random.integer(topology.size - definition.width + 1);
    const anchorY = random.integer(topology.size - definition.height + 1);
    return freezePlacements(
      definition.cells.map((cell) => ({
        point: `${anchorX + cell.x},${anchorY + cell.y}`,
        color: cell.color,
      })),
    );
  }

  if (definition.width > topology.size || definition.height > topology.size) {
    throw new Error(`Pattern does not fit Cube face ${topology.size}x${topology.size}`);
  }
  const face = random.pick(CUBE_FACES);
  const anchorColumn = random.integer(topology.size - definition.width + 1);
  const anchorRow = random.integer(topology.size - definition.height + 1);
  return freezePlacements(
    definition.cells.map((cell) => ({
      point: cubePointId(face, anchorRow + cell.y, anchorColumn + cell.x),
      color: cell.color,
    })),
  );
};

const fixtureFromPattern = (
  topology: TorusTopology | CubeTopology,
  descriptor: EndgameTestTopologyDescriptor,
  seed: string,
  definition: PatternDefinition,
  metadata: EndgameTestFixture['generator'],
): EndgameTestFixture => {
  const placements = localPlacements(topology, definition, seed);
  return Object.freeze({
    fixtureId: endgameFixtureId(descriptor, metadata),
    topology: descriptor,
    state: buildSyntheticEndgameState(topology, placements),
    commands: Object.freeze([]),
    placements,
    tags: definition.tags,
    generator: metadata,
  });
};

export const generateLifeDeathPatternFixture = (
  topology: TorusTopology | CubeTopology,
  descriptor: EndgameTestTopologyDescriptor,
  seedValue: string | number,
  pattern: LifeDeathPatternName,
): EndgameTestFixture => {
  const seed = String(seedValue);
  const metadata = Object.freeze({
    kind: 'life-death-pattern' as const,
    version: ENDGAME_TEST_GENERATOR_VERSION,
    seed,
    options: Object.freeze({ pattern }),
  });
  return fixtureFromPattern(topology, descriptor, seed, LIFE_DEATH_PATTERNS[pattern], metadata);
};

export const generateSekiPatternFixture = (
  topology: TorusTopology | CubeTopology,
  descriptor: EndgameTestTopologyDescriptor,
  seedValue: string | number,
  pattern: SekiPatternName,
): EndgameTestFixture => {
  const seed = String(seedValue);
  const metadata = Object.freeze({
    kind: 'seki-pattern' as const,
    version: ENDGAME_TEST_GENERATOR_VERSION,
    seed,
    options: Object.freeze({ pattern }),
  });
  return fixtureFromPattern(topology, descriptor, seed, SEKI_PATTERNS[pattern], metadata);
};

export const replaySyntheticPlacements = (
  topology: Topology,
  placements: readonly SyntheticPlacement[],
): GameState => buildSyntheticEndgameState(topology, placements);
