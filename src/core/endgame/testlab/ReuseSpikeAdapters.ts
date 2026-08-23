import type { StoneColor } from '../../game/types';
import type {
  ReuseSpikeSolverAdapter,
  ReuseSpikeSolverResult,
  ReuseSpikeTargetOutcome,
} from './ReuseSpikeBenchmark';
import type { ReuseSpikeCorpusCase } from './ReuseSpikeCorpus';

const targetColor = (problem: ReuseSpikeCorpusCase): StoneColor | undefined => {
  const targetColors = new Set<StoneColor>();

  for (const target of problem.position.targetCoordinates) {
    const stone = problem.position.stones.find(
      ({ row, column }) => row === target.row && column === target.column,
    );
    if (stone) targetColors.add(stone.color);
  }

  return targetColors.size === 1 ? [...targetColors][0] : undefined;
};

const opposite = (color: StoneColor): StoneColor =>
  color === 'black' ? 'white' : 'black';

const playerLabel = (color: StoneColor): 'B' | 'W' =>
  color === 'black' ? 'B' : 'W';

const solutionExists = (move: string | null | undefined): move is string =>
  typeof move === 'string' && move.length > 0;

export interface ReuseSpikeFirstPlayerRunResult {
  /** false means the configured node/time budget ended before proof/disproof. */
  readonly solved: boolean;
  /** Whether the explicitly supplied first player proved its local objective. */
  readonly firstPlayerWins?: boolean;
  readonly koDependent?: boolean;
  readonly move?: string;
  readonly nodes?: number;
  readonly detail?: string;
}

interface FirstPlayerPair {
  readonly attacker: ReuseSpikeFirstPlayerRunResult;
  readonly defender: ReuseSpikeFirstPlayerRunResult;
}

const summedNodes = (pair: FirstPlayerPair): number | undefined =>
  pair.attacker.nodes === undefined || pair.defender.nodes === undefined
    ? undefined
    : pair.attacker.nodes + pair.defender.nodes;

const combinedDetail = (pair: FirstPlayerPair): string | undefined => {
  const parts = [
    pair.attacker.detail ? `attacker-first: ${pair.attacker.detail}` : undefined,
    pair.defender.detail ? `defender-first: ${pair.defender.detail}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join('; ');
};

/**
 * Normalize the exact same two questions for every solver:
 *
 * 1. can the attacker force its objective when moving first?
 * 2. can the defender force its objective when moving first?
 *
 * This keeps the benchmark independent of each upstream API. Both sides winning
 * with first move is a critical/unsettled position, not an ambiguous error.
 */
const combineFirstPlayerRuns = (pair: FirstPlayerPair): ReuseSpikeSolverResult => {
  const nodes = summedNodes(pair);
  const detail = combinedDetail(pair);

  if (pair.attacker.koDependent || pair.defender.koDependent) {
    return {
      outcome: 'ko-dependent',
      ...(nodes === undefined ? {} : { nodes }),
      ...(detail === undefined ? {} : { detail }),
    };
  }

  if (
    !pair.attacker.solved ||
    !pair.defender.solved ||
    pair.attacker.firstPlayerWins === undefined ||
    pair.defender.firstPlayerWins === undefined
  ) {
    return {
      outcome: 'unknown',
      ...(nodes === undefined ? {} : { nodes }),
      ...(detail === undefined ? {} : { detail }),
    };
  }

  const attackerWins = pair.attacker.firstPlayerWins;
  const defenderWins = pair.defender.firstPlayerWins;
  let outcome: ReuseSpikeTargetOutcome;
  let move: string | undefined;

  if (attackerWins && defenderWins) {
    outcome = 'critical';
  } else if (attackerWins) {
    outcome = 'target-captured';
    move = pair.attacker.move;
  } else if (defenderWins) {
    outcome = 'target-survives';
    move = pair.defender.move;
  } else {
    // Could be seki, ko semantics the adapter cannot observe, or solver limits.
    // Never promote "neither side proved" to seki automatically.
    outcome = 'unknown';
  }

  return {
    outcome,
    ...(nodes === undefined ? {} : { nodes }),
    ...(move === undefined ? {} : { move }),
    ...(detail === undefined ? {} : { detail }),
  };
};

export interface TsumegoJsSolverLike {
  solve(player: 'B' | 'W'): string | null | undefined;
}

export type TsumegoJsSolverFactory = (sgf: string) => TsumegoJsSolverLike;

/**
 * Adapter for d180cf/tsumego.js without importing that package into production.
 * Fresh solver instances answer attacker-first and defender-first independently.
 */
export const createTsumegoJsReuseSpikeAdapter = (
  revision: string,
  createSolver: TsumegoJsSolverFactory,
): ReuseSpikeSolverAdapter => ({
  id: 'tsumego-js',
  revision,
  async solve(problem) {
    const target = targetColor(problem);
    if (!target) {
      return {
        outcome: 'unsupported',
        detail: 'tsumego.js adapter requires marked target stones of one color',
      };
    }

    const defender = playerLabel(target);
    const attacker = playerLabel(opposite(target));
    const attackerMove = createSolver(problem.sgf).solve(attacker);
    const defenderMove = createSolver(problem.sgf).solve(defender);

    return combineFirstPlayerRuns({
      attacker: {
        solved: true,
        firstPlayerWins: solutionExists(attackerMove),
        ...(solutionExists(attackerMove) ? { move: attackerMove } : {}),
      },
      defender: {
        solved: true,
        firstPlayerWins: solutionExists(defenderMove),
        ...(solutionExists(defenderMove) ? { move: defenderMove } : {}),
      },
    });
  },
});

export type CameronMartinRunResult = ReuseSpikeFirstPlayerRunResult;

export type CameronMartinRunner = (
  problem: ReuseSpikeCorpusCase,
  firstPlayer: StoneColor,
) => Promise<CameronMartinRunResult>;

/**
 * The upstream Rust crate has no redistributable license declaration and no
 * batch solve CLI, so Work 1 keeps native process/build plumbing outside this
 * repository. The injected runner is a black-box evaluator only.
 */
export const createCameronMartinReuseSpikeAdapter = (
  revision: string,
  run: CameronMartinRunner,
): ReuseSpikeSolverAdapter => ({
  id: 'cameron-martin',
  revision,
  async solve(problem) {
    const target = targetColor(problem);
    if (!target) {
      return {
        outcome: 'unsupported',
        detail: 'Cameron-Martin adapter requires marked target stones of one color',
      };
    }

    const attacker = opposite(target);
    return combineFirstPlayerRuns({
      attacker: await run(problem, attacker),
      defender: await run(problem, target),
    });
  },
});

export type RelevanceZoneRunResult = ReuseSpikeFirstPlayerRunResult;

export type RelevanceZoneRunner = (
  problem: ReuseSpikeCorpusCase,
  firstPlayer: StoneColor,
) => Promise<RelevanceZoneRunResult>;

/**
 * Adapter boundary for the study-LD-RZ executable. Its repository currently has
 * no declared software license, so only black-box result JSON crosses this
 * boundary; implementation code is not copied into GoCube. The bridge maps
 * upstream NumSimulations to nodes/work units before returning this result.
 */
export const createRelevanceZoneReuseSpikeAdapter = (
  revision: string,
  run: RelevanceZoneRunner,
): ReuseSpikeSolverAdapter => ({
  id: 'relevance-zone',
  revision,
  async solve(problem) {
    const target = targetColor(problem);
    if (!target) {
      return {
        outcome: 'unsupported',
        detail: 'Relevance-Zone adapter requires marked target stones of one color',
      };
    }

    const attacker = opposite(target);
    return combineFirstPlayerRuns({
      attacker: await run(problem, attacker),
      defender: await run(problem, target),
    });
  },
});

export type DarkforestRunResult = ReuseSpikeFirstPlayerRunResult;

export type DarkforestRunner = (
  problem: ReuseSpikeCorpusCase,
  firstPlayer: StoneColor,
) => Promise<DarkforestRunResult>;

/**
 * Adapter boundary for Darkforest's BSD-licensed C tsumego search. A tiny native
 * harness may expose first-player proof/disproof and search count; the old
 * Darkforest Board/Region implementation itself is deliberately not a GoCube
 * dependency.
 */
export const createDarkforestReuseSpikeAdapter = (
  revision: string,
  run: DarkforestRunner,
): ReuseSpikeSolverAdapter => ({
  id: 'darkforest',
  revision,
  async solve(problem): Promise<ReuseSpikeSolverResult> {
    const target = targetColor(problem);
    if (!target) {
      return {
        outcome: 'unsupported',
        detail: 'Darkforest adapter requires marked target stones of one color',
      };
    }

    const attacker = opposite(target);
    return combineFirstPlayerRuns({
      attacker: await run(problem, attacker),
      defender: await run(problem, target),
    });
  },
});
