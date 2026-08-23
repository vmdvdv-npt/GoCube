import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../game/GameEngine';
import type { GameState } from '../../game/types';
import { LinearHistory } from '../../history/LinearHistory';
import type { PointId, Topology } from '../../topology/Topology';
import {
  createLiveTestTopology,
  EndgameGenerator,
  GameLikeGenerator,
  generateLiveTestCase,
  replayLiveTestCase,
  type LiveTestGeneratedCase,
} from './LiveTestGenerators';

const boardSignature = (generated: LiveTestGeneratedCase): string =>
  Object.entries(generated.state.board)
    .filter(([, occupancy]) => occupancy !== 'empty')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([point, occupancy]) => `${point}=${occupancy}`)
    .join(';');

const replayThroughEngine = (generated: LiveTestGeneratedCase): GameState => {
  const topology = createLiveTestTopology(generated.spec);
  const engine = new GameEngine(topology);
  const history = new LinearHistory(engine.createInitialState());

  for (const command of generated.commands) {
    if (command.type === 'pass') {
      const result = engine.pass(history.current());
      if (!result.ok) throw new Error('Generated Pass was rejected');
      history.push(result.state);
      continue;
    }

    const state = history.current();
    const result = engine.placeStone(
      state,
      command.point,
      state.currentPlayer,
      history.simpleKoContext(),
    );
    if (!result.ok) {
      throw new Error(`Generated move ${command.point} was rejected: ${result.reason}`);
    }
    history.push(result.state);
  }

  return history.current();
};

const qualitySummary = (
  generated: LiveTestGeneratedCase,
): Readonly<{
  stones: number;
  connectedGroups: number;
  contactEdges: number;
  tacticalGroups: number;
}> => {
  const topology = createLiveTestTopology(generated.spec);
  const engine = new GameEngine(topology);
  const state = generated.state;
  const visited = new Set<PointId>();
  let stones = 0;
  let connectedGroups = 0;
  let tacticalGroups = 0;
  let contactEdges = 0;

  for (const point of topology.points()) {
    if (state.board[point] === 'empty') continue;
    stones += 1;
    for (const neighbor of topology.neighbors(point)) {
      if (
        state.board[neighbor] !== 'empty' &&
        state.board[neighbor] !== state.board[point]
      ) {
        contactEdges += 1;
      }
    }

    if (visited.has(point)) continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    for (const member of group.points) visited.add(member);
    if (group.points.length > 1) connectedGroups += 1;
    if (group.liberties.length <= 2) tacticalGroups += 1;
  }

  return Object.freeze({
    stones,
    connectedGroups,
    contactEdges: Math.floor(contactEdges / 2),
    tacticalGroups,
  });
};

const finishWithTwoPasses = (
  topology: Topology,
  state: GameState,
): GameState => {
  const engine = new GameEngine(topology);
  const first = engine.pass(state);
  if (!first.ok) throw new Error('First generated endgame Pass was rejected');
  const second = engine.pass(first.state);
  if (!second.ok) throw new Error('Second generated endgame Pass was rejected');
  return second.state;
};

describe('LiveTestGenerators', () => {
  it.each([
    { generator: 'game-like' as const, topology: 'torus' as const, size: 9 },
    { generator: 'game-like' as const, topology: 'cube' as const, size: 5 },
    { generator: 'endgame' as const, topology: 'torus' as const, size: 9 },
    { generator: 'endgame' as const, topology: 'cube' as const, size: 5 },
  ])('is exactly reproducible for $generator / $topology / $size', (shape) => {
    const spec = { ...shape, seed: '184237' };
    const first = generateLiveTestCase(spec);
    const second = replayLiveTestCase(spec);

    expect(second).toEqual(first);
    expect(replayThroughEngine(first)).toEqual(first.state);
    expect(first.state.phase).toBe('playing');
  });

  it.each([
    { generator: 'game-like' as const, topology: 'torus' as const, size: 9 },
    { generator: 'game-like' as const, topology: 'cube' as const, size: 5 },
    { generator: 'endgame' as const, topology: 'torus' as const, size: 9 },
    { generator: 'endgame' as const, topology: 'cube' as const, size: 5 },
  ])('changes the position when the seed changes for $generator / $topology', (shape) => {
    const first = generateLiveTestCase({ ...shape, seed: '184237' });
    const second = generateLiveTestCase({ ...shape, seed: '184238' });
    expect(boardSignature(second)).not.toBe(boardSignature(first));
  });

  it('exposes GameLikeGenerator and EndgameGenerator as thin consumers of the same API', () => {
    const common = { topology: 'torus' as const, size: 9, seed: 'shared-api' };
    expect(new GameLikeGenerator().generate(common)).toEqual(
      generateLiveTestCase({ ...common, generator: 'game-like' }),
    );
    expect(new EndgameGenerator().generate(common)).toEqual(
      generateLiveTestCase({ ...common, generator: 'endgame' }),
    );
  });

  it.each([
    { topology: 'torus' as const, size: 9, seed: '184237' },
    { topology: 'torus' as const, size: 13, seed: '271828' },
    { topology: 'cube' as const, size: 4, seed: '314159' },
    { topology: 'cube' as const, size: 5, seed: '161803' },
  ])('fixed game-like seeds produce clustered contact play instead of scatter noise', (shape) => {
    const generated = generateLiveTestCase({ ...shape, generator: 'game-like' });
    const summary = qualitySummary(generated);

    expect(summary.stones).toBeGreaterThan(6);
    expect(summary.connectedGroups).toBeGreaterThan(0);
    expect(summary.contactEdges).toBeGreaterThan(0);
    expect(generated.commands.length).toBeGreaterThanOrEqual(summary.stones);
    expect(generated.state.captures.black + generated.state.captures.white + summary.tacticalGroups)
      .toBeGreaterThan(0);
  });

  it.each([
    { topology: 'torus' as const, size: 9 },
    { topology: 'cube' as const, size: 5 },
  ])('generated endgame remains playable and reaches review phase through Pass → Pass', (shape) => {
    const generated = generateLiveTestCase({
      ...shape,
      generator: 'endgame',
      seed: 'endgame-review-184237',
    });
    const finalState = finishWithTwoPasses(createLiveTestTopology(generated.spec), generated.state);

    expect(generated.state.phase).toBe('playing');
    expect(finalState.phase).toBe('endgame');
    expect(finalState.consecutivePasses).toBe(2);
  });
});
