import type { FinalScore } from '../../core/scoring/Scoring';
import { isValidCubeSize, type CubeSize } from '../../core/topology/CubeTopology';
import type { PointId, Topology } from '../../core/topology/Topology';
import { TORUS_SIZES, type TorusSize } from '../../core/topology/TorusTopology';
import type { GameSessionSnapshot } from '../../core/persistence/GameSessionSnapshot';
import type { GameViewModel } from '../../presentation/PresentationModel';
import {
  Cube2DGameController,
  type Cube2DEndgameDecisions,
  type Cube2DGameActionResult,
} from '../Cube2DGameController';
import type {
  SharedEndgameDecisions,
  SharedEndgameGroup,
  SharedGameActionResult,
} from '../GameSessionControllerFacade';
import {
  TorusGameController,
  type TorusGameActionResult,
} from '../TorusGameController';
import type { AlphaZeroGeneratedGame } from './AlphaZeroGateway';

export type DeveloperReplayFinalScoreListener = (score: FinalScore | null) => void;

/**
 * Small application-level boundary used by replay orchestration. It deliberately
 * contains only operations needed to drive the existing GoCube GameSession path.
 */
export interface DeveloperReplayController {
  readonly size: number;
  readonly topology: Topology;

  viewModel(): GameViewModel;
  snapshot(): GameSessionSnapshot;

  placeStone(pointId: PointId): Promise<SharedGameActionResult>;
  pass(): Promise<SharedGameActionResult>;
  undo(): Promise<SharedGameActionResult>;
  redo(): Promise<SharedGameActionResult>;
  canUndo(): boolean;
  canRedo(): boolean;

  endgameReviewReady(): boolean;
  endgameGroups(): readonly SharedEndgameGroup[];
  endgameDecisions(): SharedEndgameDecisions;
  nextUnresolvedEndgameGroupId(): string | null;

  setFinalScoreListener(listener: DeveloperReplayFinalScoreListener | null): void;
  dispose(): void;
}

class DeveloperCube2DGameController extends Cube2DGameController {
  private finalScoreListener: DeveloperReplayFinalScoreListener | null = null;

  setFinalScoreListener(listener: DeveloperReplayFinalScoreListener | null): void {
    this.finalScoreListener = listener;
    listener?.(this.viewModel().finalScore ?? null);
  }

  override async finishEndgame(
    decisions?: Cube2DEndgameDecisions,
  ): Promise<Cube2DGameActionResult> {
    const result = await super.finishEndgame(decisions);
    this.finalScoreListener?.(result.viewModel.finalScore ?? null);
    return result;
  }
}

class DeveloperTorusGameController extends TorusGameController {
  private finalScoreListener: DeveloperReplayFinalScoreListener | null = null;

  setFinalScoreListener(listener: DeveloperReplayFinalScoreListener | null): void {
    this.finalScoreListener = listener;
    listener?.(this.viewModel().finalScore ?? null);
  }

  override async finishEndgame(): Promise<TorusGameActionResult> {
    const result = await super.finishEndgame();
    this.finalScoreListener?.(result.viewModel.finalScore ?? null);
    return result;
  }
}

export type DeveloperReplayControllerBinding =
  | Readonly<{
      topology: 'cube';
      controller: Cube2DGameController & DeveloperReplayController;
    }>
  | Readonly<{
      topology: 'torus';
      controller: TorusGameController & DeveloperReplayController;
    }>;

const cubeSize = (size: number): CubeSize => {
  if (!isValidCubeSize(size)) {
    throw new Error(`Unsupported Cube replay size: ${String(size)}.`);
  }
  return size;
};

const torusSize = (size: number): TorusSize => {
  const supported = TORUS_SIZES.find((candidate) => candidate === size);
  if (supported === undefined) {
    throw new Error(
      `Unsupported Torus replay size: ${String(size)}. Expected one of: ${TORUS_SIZES.join(', ')}.`,
    );
  }
  return supported;
};

/** The only replay-application branch that knows which gameplay controller to create. */
export const createDeveloperReplayController = (
  game: AlphaZeroGeneratedGame,
): DeveloperReplayControllerBinding => {
  if (game.topology === 'cube') {
    const controller = new DeveloperCube2DGameController({
      size: cubeSize(game.size),
      ruleSet: game.ruleSet,
      komi: game.komi,
    });
    return Object.freeze({ topology: 'cube' as const, controller });
  }

  const controller = new DeveloperTorusGameController({
    size: torusSize(game.size),
    ruleSet: game.ruleSet,
    komi: game.komi,
  });
  return Object.freeze({ topology: 'torus' as const, controller });
};
