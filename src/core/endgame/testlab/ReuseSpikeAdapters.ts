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

export interface TsumegoJsSolverLike {
  solve(player: 'B' | 'W'): string | null | undefined;
}

export type TsumegoJsSolverFactory = (sgf: string) => TsumegoJsSolverLike;

/**
 * Adapter for d180cf/tsumego.js without importing that package into production.
 * Two fresh solver instances are queried so the benchmark asks the same target-
 * fate question regardless of which color is marked as the target.
 *
 * If both sides (or neither side) report a solution, we keep the result unknown.
 * That includes ko-sensitive/semantic mismatches that cannot be safely collapsed
 * into a GoCube proof status from the public solve() return value alone.
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
    const attackerWins = solutionExists(attackerMove);
    const defenderWins = solutionExists(defenderMove);

    if (attackerWins && !defenderWins) {
      return { outcome: 'target-captured', move: attackerMove };
    }
    if (defenderWins && !attackerWins) {
      return { outcome: 'target-survives', move: defenderMove };
    }

    return {
      outcome: 'unknown',
      detail: attackerWins
        ? 'attacker and defender both report a solution'
        : 'neither attacker nor defender reports a solution',
    };
  },
});

export interface CameronMartinRunResult {
  /** false means the configured node/time budget ended before proof/disproof. */
  readonly solved: boolean;
  /** Mirrors Puzzle::is_proved() for the side to move when solved. */
  readonly proved?: boolean;
  readonly move?: string;
  readonly nodes?: number;
  readonly detail?: string;
}

export type CameronMartinRunner = (
  problem: ReuseSpikeCorpusCase,
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

    const result = await run(problem);
    if (!result.solved || result.proved === undefined) {
      return {
        outcome: 'unknown',
        ...(result.nodes === undefined ? {} : { nodes: result.nodes }),
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      };
    }

    const sideToMoveIsTarget = problem.position.currentPlayer === target;
    const targetSurvives = result.proved === sideToMoveIsTarget;
    return {
      outcome: targetSurvives ? 'target-survives' : 'target-captured',
      ...(result.nodes === undefined ? {} : { nodes: result.nodes }),
      ...(result.move === undefined ? {} : { move: result.move }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  },
});

export interface RelevanceZoneRunResult {
  readonly winner?: StoneColor;
  readonly koDependent?: boolean;
  readonly move?: string;
  /** RZ result JSON exposes NumSimulations; normalize it as nodes/work units. */
  readonly nodes?: number;
  readonly detail?: string;
}

export type RelevanceZoneRunner = (
  problem: ReuseSpikeCorpusCase,
) => Promise<RelevanceZoneRunResult>;

/**
 * Adapter boundary for the study-LD-RZ executable. Its repository currently has
 * no declared software license, so only black-box result JSON crosses this
 * boundary; implementation code is not copied into GoCube.
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

    const result = await run(problem);
    const outcome: ReuseSpikeTargetOutcome = result.koDependent
      ? 'ko-dependent'
      : result.winner === undefined
        ? 'unknown'
        : result.winner === target
          ? 'target-survives'
          : 'target-captured';

    return {
      outcome,
      ...(result.nodes === undefined ? {} : { nodes: result.nodes }),
      ...(result.move === undefined ? {} : { move: result.move }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  },
});

export interface DarkforestRunResult {
  readonly complete: boolean;
  readonly targetLives?: boolean;
  readonly move?: string;
  readonly nodes?: number;
  readonly detail?: string;
}

export type DarkforestRunner = (
  problem: ReuseSpikeCorpusCase,
) => Promise<DarkforestRunResult>;

/**
 * Adapter boundary for Darkforest's BSD-licensed C tsumego search. A tiny native
 * harness may expose search completion, target fate and search count; the old
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
    if (!targetColor(problem)) {
      return {
        outcome: 'unsupported',
        detail: 'Darkforest adapter requires marked target stones of one color',
      };
    }

    const result = await run(problem);
    const outcome: ReuseSpikeTargetOutcome =
      !result.complete || result.targetLives === undefined
        ? 'unknown'
        : result.targetLives
          ? 'target-survives'
          : 'target-captured';

    return {
      outcome,
      ...(result.nodes === undefined ? {} : { nodes: result.nodes }),
      ...(result.move === undefined ? {} : { move: result.move }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  },
});
