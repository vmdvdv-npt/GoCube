import { GameEngine } from '../../game/GameEngine';
import type { GameState } from '../../game/types';
import { LinearHistory } from '../../history/LinearHistory';
import type { PointId, Topology } from '../../topology/Topology';
import { DeterministicRandom } from './DeterministicRandom';
import type { GeneratedGameCommand } from './EndgameFixture';

export const GAME_LIKE_GENERATOR_VERSION = 1 as const;

export interface GameLikeGeneratedSequence {
  readonly state: GameState;
  readonly commands: readonly GeneratedGameCommand[];
  readonly requestedMoves: number;
}

const PROFILE = Object.freeze({
  targetDensityMin: 0.27,
  targetDensityRange: 0.2,
  focusLimit: 24,
  explorationLimit: 10,
  contactWeight: 8,
  threatenedWeight: 13,
});

const groupKey = (points: readonly PointId[]): string => [...points].sort().join('|');

const collectCandidatePoints = (
  topology: Topology,
  engine: GameEngine,
  state: GameState,
  random: DeterministicRandom,
): readonly PointId[] => {
  const empty = topology.points().filter((point) => state.board[point] === 'empty');
  if (empty.length <= PROFILE.focusLimit + PROFILE.explorationLimit) {
    return random.shuffle(empty);
  }

  const focused = new Set<PointId>();
  const visitedGroups = new Set<PointId>();

  for (const point of topology.points()) {
    if (state.board[point] === 'empty') continue;

    for (const neighbor of topology.neighbors(point)) {
      if (state.board[neighbor] === 'empty') focused.add(neighbor);
    }

    if (visitedGroups.has(point)) continue;
    const group = engine.groupAt(state, point);
    if (!group) continue;
    for (const groupPoint of group.points) visitedGroups.add(groupPoint);
    if (group.liberties.length <= 3) {
      for (const liberty of group.liberties) focused.add(liberty);
    }
  }

  const focusedSample = random.shuffle([...focused]).slice(0, PROFILE.focusLimit);
  const explorationSample = random
    .shuffle(empty.filter((point) => !focused.has(point)))
    .slice(0, PROFILE.explorationLimit);

  return Object.freeze([...new Set([...focusedSample, ...explorationSample])]);
};

const scoreCandidate = (
  topology: Topology,
  engine: GameEngine,
  state: GameState,
  point: PointId,
  acceptedState: GameState,
  capturedCount: number,
  random: DeterministicRandom,
): number => {
  const friendlyGroups = new Map<string, number>();
  const enemyGroups = new Map<string, number>();
  let friendlyNeighbors = 0;
  let enemyNeighbors = 0;

  for (const neighbor of topology.neighbors(point)) {
    const occupancy = state.board[neighbor];
    if (occupancy === 'empty') continue;
    const group = engine.groupAt(state, neighbor);
    if (!group) continue;
    const key = groupKey(group.points);
    if (occupancy === state.currentPlayer) {
      friendlyNeighbors += 1;
      friendlyGroups.set(key, group.liberties.length);
    } else {
      enemyNeighbors += 1;
      enemyGroups.set(key, group.liberties.length);
    }
  }

  let score = random.next() * 5;
  score += capturedCount * 70;
  score += (friendlyNeighbors + enemyNeighbors) * PROFILE.contactWeight;
  score += Math.max(0, friendlyGroups.size - 1) * 18;
  score += Math.max(0, enemyGroups.size - 1) * 14;

  for (const liberties of enemyGroups.values()) {
    if (liberties === 1) score += PROFILE.threatenedWeight * 2.2;
    else if (liberties === 2) score += PROFILE.threatenedWeight;
    else if (liberties === 3) score += PROFILE.threatenedWeight * 0.3;
  }
  for (const liberties of friendlyGroups.values()) {
    if (liberties === 1) score += PROFILE.threatenedWeight * 1.7;
    else if (liberties === 2) score += PROFILE.threatenedWeight * 0.8;
  }

  const ownGroup = engine.groupAt(acceptedState, point);
  const ownLiberties = ownGroup?.liberties.length ?? 0;
  if (ownLiberties <= 1 && capturedCount === 0) score -= 18;
  else if (ownLiberties === 2) score += 5;
  else if (ownLiberties === 3) score += 8;
  else score += 4;

  const localOccupancy = friendlyNeighbors + enemyNeighbors;
  if (state.moveNumber < 4) {
    score += localOccupancy === 0 ? 15 : 3;
  } else if (localOccupancy === 0) {
    score -= PROFILE.contactWeight * 0.65;
  }

  return score;
};

const requestedMoveCount = (
  topology: Topology,
  seed: number,
): number => {
  const random = new DeterministicRandom(`${GAME_LIKE_GENERATOR_VERSION}|${topology.id}|${seed}|density`);
  const density = PROFILE.targetDensityMin + random.next() * PROFILE.targetDensityRange;
  return Math.max(4, Math.min(256, Math.floor(topology.points().length * density)));
};

/**
 * Seeded pseudo-game generator. Every accepted placement passes through the
 * real GameEngine with a real LinearHistory SimpleKoContext; no occupancy is
 * written directly. Candidate scoring deliberately favors local shape,
 * connection/cut pressure, atari defense/attack and captures while preserving
 * occasional tenuki/exploration.
 */
export const generateGameLikeSequence = (
  topology: Topology,
  seed: number,
): GameLikeGeneratedSequence => {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error(`Game-like seed must be uint32, got ${String(seed)}`);
  }

  const engine = new GameEngine(topology);
  const history = new LinearHistory(engine.createInitialState());
  const random = new DeterministicRandom(
    `${GAME_LIKE_GENERATOR_VERSION}|${topology.id}|${seed}`,
  );
  const maxMoves = requestedMoveCount(topology, seed);
  const commands: GeneratedGameCommand[] = [];

  for (let move = 0; move < maxMoves; move += 1) {
    const state = history.current();
    const candidates = collectCandidatePoints(topology, engine, state, random);
    let best: Readonly<{ point: PointId; state: GameState; score: number }> | null = null;

    for (const point of [...candidates].sort()) {
      const result = engine.placeStone(
        state,
        point,
        state.currentPlayer,
        history.simpleKoContext(),
      );
      if (!result.ok) continue;
      const score = scoreCandidate(
        topology,
        engine,
        state,
        point,
        result.state,
        result.captured.length,
        random,
      );
      if (!best || score > best.score) {
        best = Object.freeze({ point, state: result.state, score });
      }
    }

    // A small candidate sample can theoretically miss every legal point. Fall
    // back to a deterministic full-board search without weakening legality.
    if (!best) {
      for (const point of random.shuffle(topology.points())) {
        if (state.board[point] !== 'empty') continue;
        const result = engine.placeStone(
          state,
          point,
          state.currentPlayer,
          history.simpleKoContext(),
        );
        if (!result.ok) continue;
        best = Object.freeze({ point, state: result.state, score: 0 });
        break;
      }
    }

    if (!best) break;
    history.push(best.state);
    commands.push(Object.freeze({ type: 'place-stone', point: best.point }));
  }

  return Object.freeze({
    state: history.current(),
    commands: Object.freeze(commands),
    requestedMoves: maxMoves,
  });
};
