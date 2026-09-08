import { describe, expect, it } from 'vitest';
import rawBoundaryDocument from './fixtures/gocube_product_boundary_fixtures.json';
import {
  parseAlphaZeroProductBoundaryDocument,
} from './AlphaZeroProductBoundary';
import {
  replayAlphaZeroFixture,
} from './AlphaZeroProductBoundaryReplay';
import type { EndgameClassifier, EndgameProposal } from '../endgame/EndgameClassifier';
import { ManualEndgameClassifier } from '../endgame/ManualEndgameClassifier';
import type { GameRepository, SavedGame } from '../persistence/GameRepository';
import type { GameSessionSnapshot } from '../persistence/GameSessionSnapshot';
import { JapaneseScoring } from '../scoring/JapaneseScoring';
import { CubeTopology } from '../topology/CubeTopology';
import { TorusTopology } from '../topology/TorusTopology';
import type { PointId, Topology } from '../topology/Topology';
import type { GameState, PointOccupancy, StoneColor } from '../game/types';
import { GameEngine } from '../game/GameEngine';
import { GameSession, type GameSessionConfig } from '../game/GameSession';

const boundaryFixtures = parseAlphaZeroProductBoundaryDocument(rawBoundaryDocument);

const makeState = (
  topology: Topology,
  black: readonly PointId[] = [],
  white: readonly PointId[] = [],
  currentPlayer: StoneColor = 'black',
): GameState => {
  const engine = new GameEngine(topology);
  const initial = engine.createInitialState();
  const board: Record<PointId, PointOccupancy> = { ...initial.board };
  for (const point of black) board[point] = 'black';
  for (const point of white) board[point] = 'white';
  return Object.freeze({
    ...initial,
    board: Object.freeze(board),
    currentPlayer,
  });
};

const configFor = (
  topology: Topology,
  endgameClassifier: EndgameClassifier = new ManualEndgameClassifier(),
  persistence?: GameSessionConfig['persistence'],
): GameSessionConfig => ({
  endgameClassifier,
  scoringStrategy: new JapaneseScoring(topology),
  boardSize: topology.id.startsWith('cube-') ? Number(topology.id.split('-')[1]?.split('x')[0]) : 9,
  komi: 0.5,
  persistence,
});

class ThrowingClassifier implements EndgameClassifier {
  async analyze(): Promise<EndgameProposal> {
    throw new Error('classifier unavailable');
  }
}

class InvalidProposalClassifier implements EndgameClassifier {
  async analyze(): Promise<EndgameProposal> {
    return Object.freeze([]);
  }
}

class MemoryRepository implements GameRepository<GameSessionSnapshot> {
  private saved: SavedGame<GameSessionSnapshot> | null = null;

  async save(game: SavedGame<GameSessionSnapshot>): Promise<void> {
    this.saved = structuredClone(game);
  }

  async load(id: string): Promise<SavedGame<GameSessionSnapshot> | null> {
    return this.saved?.id === id ? structuredClone(this.saved) : null;
  }

  async remove(): Promise<void> {
    this.saved = null;
  }
}

describe('AlphaZero product-boundary contract', () => {
  it('fails closed on unknown schema, duplicate mappings and non-consecutive boundary snapshots', () => {
    const unknownSchema = structuredClone(rawBoundaryDocument);
    unknownSchema.schema = 'unknown-product-boundary-v0';
    expect(() => parseAlphaZeroProductBoundaryDocument(unknownSchema)).toThrow(/unsupported schema/);

    const duplicateMapping = structuredClone(rawBoundaryDocument);
    duplicateMapping.fixtures[0]!.topology_contract.point_mapping[1] =
      duplicateMapping.fixtures[0]!.topology_contract.point_mapping[0]!;
    expect(() => parseAlphaZeroProductBoundaryDocument(duplicateMapping)).toThrow(/action index is not canonical|duplicate AlphaZero PointId/);

    const wrongPassCount = structuredClone(rawBoundaryDocument);
    wrongPassCount.fixtures[0]!.after_second_pass.consecutive_passes = 3;
    expect(() => parseAlphaZeroProductBoundaryDocument(wrongPassCount)).toThrow(/must equal 2/);
  });

  it('fails closed on a tampered provenance source repository', () => {
    const tampered = structuredClone(rawBoundaryDocument);
    tampered.fixtures[0]!.provenance.source_repo = 'some-other/repository';

    expect(() => parseAlphaZeroProductBoundaryDocument(tampered)).toThrow(
      /source_repo|source repository|unsupported/i,
    );
  });

  it('fails closed on a tampered V1 provenance status', () => {
    const tampered = structuredClone(rawBoundaryDocument);
    tampered.fixtures[0]!.provenance.v1_status = 'unverified';

    expect(() => parseAlphaZeroProductBoundaryDocument(tampered)).toThrow(
      /verified|v1_status|provenance/i,
    );
  });

  it('fails closed when duplicate V1 provenance IDs disagree', () => {
    const tampered = structuredClone(rawBoundaryDocument);
    tampered.fixtures[0]!.source_verification_id = 'different-v1-fixture';

    expect(() => parseAlphaZeroProductBoundaryDocument(tampered)).toThrow(
      /source verification IDs disagree|v1_fixture_id|source_verification_id/i,
    );
  });

  it('parses the generated corpus and proves every Cube4 PointId mapping/adjacency entry', () => {
    expect(boundaryFixtures).toHaveLength(24);
    const cube = boundaryFixtures.filter((fixture) => fixture.topology === 'cube');
    const torus = boundaryFixtures.filter((fixture) => fixture.topology === 'torus');
    expect(cube).toHaveLength(21);
    expect(torus).toHaveLength(3);

    const topology = cube[0]!.topologyContract;
    expect(topology.pointMapping).toHaveLength(96);
    expect(new Set(topology.pointMapping.map((entry) => entry.alphaZeroPointId)).size).toBe(96);
    expect(new Set(topology.pointMapping.map((entry) => entry.productPointId)).size).toBe(96);
    expect(Object.values(topology.adjacency).reduce((count, points) => count + points.length, 0)).toBe(384);
    expect(cube.every((fixture) => fixture.provenance.f0ContractId === 'gocube-f0-integrated-freeze-v1')).toBe(true);
  });

  it('replays all verified Cube and Torus fixtures through GameSession/GameEngine', async () => {
    for (const fixture of boundaryFixtures) {
      const topology = fixture.topology === 'cube'
        ? new CubeTopology(fixture.size)
        : new TorusTopology(fixture.size as 9 | 13 | 19);
      const result = await replayAlphaZeroFixture(new GameEngine(topology), fixture);
      expect(result.secondPassState.phase, fixture.fixtureId).toBe('endgame');
      expect(result.secondPassState.captures, fixture.fixtureId).toEqual(fixture.afterSecondPass.captures);
    }
  });

  it('reaches the V1-verified final score through the product manual lifecycle', async () => {
    const scoreFixtures = boundaryFixtures.filter((candidate) => candidate.expectedFinalScore !== null);
    expect(scoreFixtures).toHaveLength(2);
    expect(scoreFixtures.some((fixture) => fixture.fixtureId === 'cube4_nonempty_two_eye_score_001')).toBe(true);

    for (const fixture of scoreFixtures) {
      const topology = fixture.topology === 'cube'
        ? new CubeTopology(fixture.size)
        : new TorusTopology(fixture.size as 9 | 13 | 19);
      const replay = await replayAlphaZeroFixture(new GameEngine(topology), fixture);
      const expectedGroups = fixture.expectedEndgameClassification;
      const review = replay.session.endgameReview();
      expect(review?.groups).toHaveLength(expectedGroups.length);

      for (const expectedGroup of expectedGroups) {
        const actualGroup = review?.groups.find((group) =>
          group.points.length === expectedGroup.points.length &&
          group.points.every((point) => expectedGroup.points.includes(point)),
        );
        expect(actualGroup, fixture.fixtureId).toBeDefined();
        await replay.session.setEndgameReviewDecision(expectedGroup.points, expectedGroup.status);
      }

      await replay.session.finishEndgameReview();
      const score = replay.session.finalScore();
      expect(score, fixture.fixtureId).not.toBeNull();
      if (!score || !fixture.expectedFinalScore) continue;

      expect({
        rule_set: score.ruleSet,
        black: score.black,
        white: score.white,
        komi: score.komi,
        territory: score.territory,
        stones_on_board: score.stonesOnBoard,
        captures: [score.captures.black, score.captures.white],
        prisoners: score.prisoners ? [score.prisoners.black, score.prisoners.white] : null,
        dead_stones: score.deadStones,
        winner: score.winner,
        margin: score.margin,
      }).toMatchObject(fixture.expectedFinalScore);
    }
  });

  it('rejects occupied, suicide, simple-ko and unknown-point actions without mutation', async () => {
    const topology = new CubeTopology(4);
    const occupiedSession = new GameSession(new GameEngine(topology), configFor(topology));
    expect((await occupiedSession.execute({ type: 'place-stone', point: 'front:0:0' })).ok).toBe(true);
    const occupiedBefore = occupiedSession.state();
    expect(await occupiedSession.execute({ type: 'place-stone', point: 'front:0:0' })).toMatchObject({ ok: false, reason: 'occupied' });
    expect(occupiedSession.state()).toBe(occupiedBefore);

    const suicideSession = new GameSession(
      new GameEngine(topology),
      configFor(topology),
      makeState(topology, ['top:3:1', 'front:0:2', 'front:1:1', 'front:0:0'], [], 'white'),
    );
    const suicideBefore = suicideSession.state();
    expect(await suicideSession.execute({ type: 'place-stone', point: 'front:0:1' })).toMatchObject({ ok: false, reason: 'suicide' });
    expect(suicideSession.state()).toBe(suicideBefore);

    const koSession = new GameSession(
      new GameEngine(topology),
      configFor(topology),
      makeState(
        topology,
        ['front:1:0', 'left:0:3', 'top:3:0'],
        ['front:0:0', 'front:0:2', 'front:1:1', 'top:3:1'],
      ),
    );
    expect((await koSession.execute({ type: 'place-stone', point: 'front:0:1' })).ok).toBe(true);
    const koBefore = koSession.state();
    expect(await koSession.execute({ type: 'place-stone', point: 'front:0:0' })).toMatchObject({ ok: false, reason: 'repetition' });
    expect(koSession.state()).toBe(koBefore);

    const invalidSession = new GameSession(new GameEngine(topology), configFor(topology));
    const invalidBefore = invalidSession.state();
    expect(() => invalidSession.queryPlaceStone('not-a-point')).toThrow(/Unknown point/);
    expect(invalidSession.state()).toBe(invalidBefore);
  });

  it.each([
    ['classifier exception', new ThrowingClassifier()],
    ['invalid proposal', new InvalidProposalClassifier()],
  ])('keeps the accepted second Pass and exposes unresolved manual review on %s', async (_label, classifier) => {
    const topology = new CubeTopology(4);
    const session = new GameSession(
      new GameEngine(topology),
      configFor(topology, classifier),
      makeState(topology, ['front:0:0'], ['back:0:0']),
    );
    await session.execute({ type: 'pass' });
    const secondPass = await session.execute({ type: 'pass' });
    expect(secondPass.ok).toBe(true);
    expect(session.state()).toMatchObject({ phase: 'endgame', consecutivePasses: 2 });
    expect(session.finalScore()).toBeNull();
    expect(session.endgameReview()?.groups.every((group) => group.proposal.status === 'unresolved')).toBe(true);
    expect(session.endgameReview()?.groups).toHaveLength(2);

    for (const group of session.endgameReview()?.groups ?? []) {
      await session.setEndgameReviewDecision(group.points, 'alive');
    }
    await session.finishEndgameReview();
    expect(session.state().phase).toBe('finished');
  });

  it('round-trips an endgame result through repository persistence and rejects a tampered score', async () => {
    const topology = new CubeTopology(4);
    const repository = new MemoryRepository();
    const config = configFor(topology, new ManualEndgameClassifier(), {
      repository,
      gameId: 'v2-fixture',
      now: () => '2026-09-08T00:00:00.000Z',
    });
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, config);
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    await session.finishEndgameReview();

    const snapshot = session.snapshot();
    const restored = await GameSession.load(engine, config);
    expect(restored?.state()).toEqual(session.state());
    expect(restored?.snapshot().endgameClassification).toEqual(snapshot.endgameClassification);
    expect(restored?.finalScore()).toEqual(session.finalScore());

    const tampered = {
      ...snapshot,
      finalScore: { ...snapshot.finalScore!, black: snapshot.finalScore!.black + 1 },
    };
    expect(() => GameSession.fromSnapshot(engine, config, tampered)).toThrow(/fresh scoring|recomputed score/);
  });

  it('rejects partial and non-stone endgame groups at the restore boundary', async () => {
    const topology = new CubeTopology(4);
    const engine = new GameEngine(topology);
    const session = new GameSession(engine, configFor(topology));
    await session.execute({ type: 'place-stone', point: 'front:0:0' });
    await session.execute({ type: 'place-stone', point: 'front:3:3' });
    await session.execute({ type: 'place-stone', point: 'front:0:1' });
    await session.execute({ type: 'place-stone', point: 'front:3:2' });
    await session.execute({ type: 'pass' });
    await session.execute({ type: 'pass' });
    const validSnapshot = session.snapshot();
    const partial = {
      ...validSnapshot,
      endgameReview: { groups: [{ points: ['front:0:0'], proposal: { status: 'unresolved' as const }, userDecision: null }] },
    };
    expect(() => GameSession.fromSnapshot(engine, configFor(topology), partial)).toThrow(/complete stone group|authoritative stone groups|logical stone groups/);

    const nonStone = {
      ...validSnapshot,
      endgameReview: { groups: [{ points: ['front:0:2'], proposal: { status: 'unresolved' as const }, userDecision: null }] },
    };
    expect(() => GameSession.fromSnapshot(engine, configFor(topology), nonStone)).toThrow(/non-stone|occupied|not a stone|logical stone groups/);
  });
});
