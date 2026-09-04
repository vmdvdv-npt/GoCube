import type { EndgameClassification } from '../../core/endgame/EndgameClassifier';
import type { StoneColor } from '../../core/game/types';
import { ChineseScoring } from '../../core/scoring/ChineseScoring';
import { JapaneseScoring } from '../../core/scoring/JapaneseScoring';
import type { FinalScore } from '../../core/scoring/Scoring';
import type { PointId } from '../../core/topology/Topology';
import {
  Cube2DGameController,
  type Cube2DEndgameDecisions,
  type Cube2DGameActionResult,
} from '../Cube2DGameController';
import type {
  AlphaZeroAction,
  AlphaZeroGeneratedGame,
  AlphaZeroGeneratedMove,
} from './AlphaZeroGateway';

const emptyActionResult = (controller: Cube2DGameController): Cube2DGameActionResult =>
  Object.freeze({
    accepted: true,
    reason: null,
    captured: Object.freeze([]),
    viewModel: controller.viewModel(),
  });

const actionLabel = (action: AlphaZeroAction): string =>
  action.type === 'pass' ? 'pass' : action.pointId;

const samePointSet = (left: readonly PointId[], right: readonly PointId[]): boolean => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((point) => rightSet.has(point));
};

type FinalScoreListener = (score: FinalScore | null) => void;

class DeveloperCube2DGameController extends Cube2DGameController {
  private finalScoreListener: FinalScoreListener | null = null;

  setFinalScoreListener(listener: FinalScoreListener | null): void {
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

export class DeveloperReplayCompatibilityError extends Error {
  constructor(
    readonly moveNumber: number,
    readonly expectedColor: StoneColor,
    readonly action: AlphaZeroAction,
    readonly reason: string,
  ) {
    super(
      `Compatibility failure at move ${moveNumber}: expected ${expectedColor}, action ${actionLabel(action)} — ${reason}`,
    );
    this.name = 'DeveloperReplayCompatibilityError';
  }
}

export class DeveloperReplaySession {
  readonly controller: Cube2DGameController;
  readonly game: AlphaZeroGeneratedGame;

  private readonly developmentController: DeveloperCube2DGameController;
  private appliedMoves = 0;
  private forwardFrontier = 0;
  private inFlight = false;
  private finalScoreListener: FinalScoreListener | null = null;

  constructor(game: AlphaZeroGeneratedGame) {
    if (game.topology !== 'cube') {
      throw new Error(
        `Development Workspace V1 replay supports Cube 2D games; received ${game.topology}.`,
      );
    }

    this.game = game;
    this.developmentController = new DeveloperCube2DGameController({
      size: game.size,
      ruleSet: game.ruleSet,
      komi: game.komi,
    });
    this.controller = this.developmentController;
    this.assertMetadataMatchesController();
  }

  setFinalScoreListener(listener: FinalScoreListener | null): void {
    this.finalScoreListener = listener;
    this.developmentController.setFinalScoreListener(
      listener
        ? (score) => listener(score ?? this.diagnosticScore())
        : null,
    );
  }

  /**
   * Independently score the replay with GoCube's own assisted classifier.
   * This never imports AlphaZero's cleanup classification. If GoCube still has
   * unresolved groups, the diagnostic intentionally remains null.
   */
  diagnosticScore(): FinalScore | null {
    const viewModel = this.controller.viewModel();
    if (viewModel.finalScore) return viewModel.finalScore;
    if (viewModel.phase !== 'endgame') return null;
    if (this.controller.nextUnresolvedEndgameGroupId() !== null) return null;

    const decisions = this.controller.endgameDecisions();
    const classification: EndgameClassification = Object.freeze(
      this.controller.endgameGroups().map((group) => {
        const status = decisions[group.id];
        if (!status) {
          throw new Error(`GoCube diagnostic classification is missing group ${group.id}.`);
        }
        return Object.freeze({
          points: Object.freeze([...group.points]),
          status,
          source: 'automatic' as const,
        });
      }),
    );

    const snapshot = this.controller.snapshot();
    const state = snapshot.history[snapshot.history.length - 1];
    if (!state || state.phase !== 'endgame') return null;

    const scorer = this.game.ruleSet === 'chinese'
      ? new ChineseScoring(this.controller.topology)
      : new JapaneseScoring(this.controller.topology);
    return scorer.score(state, classification, this.game.komi);
  }

  get position(): number {
    return this.appliedMoves;
  }

  get totalMoves(): number {
    return this.game.moves.length;
  }

  get canPrevious(): boolean {
    return this.appliedMoves > 0 && this.controller.canUndo();
  }

  get canNext(): boolean {
    return this.appliedMoves < this.totalMoves;
  }

  current(): Cube2DGameActionResult {
    return emptyActionResult(this.controller);
  }

  async previous(): Promise<Cube2DGameActionResult> {
    return this.serial(async () => {
      if (!this.canPrevious) return this.current();
      const result = await this.controller.undo();
      if (!result.accepted) {
        throw new Error(`Developer replay Undo failed: ${String(result.reason ?? 'unknown reason')}`);
      }
      this.appliedMoves -= 1;
      this.notifyDiagnosticScore();
      return result;
    });
  }

  async next(): Promise<Cube2DGameActionResult> {
    return this.serial(() => this.nextInternal());
  }

  async seek(targetMove: number): Promise<Cube2DGameActionResult> {
    if (!Number.isSafeInteger(targetMove) || targetMove < 0 || targetMove > this.totalMoves) {
      throw new RangeError(`Replay target must be an integer between 0 and ${this.totalMoves}.`);
    }

    return this.serial(async () => {
      let result = this.current();
      while (this.appliedMoves > targetMove) {
        const undo = await this.controller.undo();
        if (!undo.accepted) {
          throw new Error(`Developer replay Undo failed: ${String(undo.reason ?? 'unknown reason')}`);
        }
        this.appliedMoves -= 1;
        result = undo;
      }
      while (this.appliedMoves < targetMove) {
        result = await this.nextInternal();
      }
      this.notifyDiagnosticScore();
      return result;
    });
  }

  async jumpToStart(): Promise<Cube2DGameActionResult> {
    return this.seek(0);
  }

  async jumpToEnd(): Promise<Cube2DGameActionResult> {
    return this.seek(this.totalMoves);
  }

  private async nextInternal(): Promise<Cube2DGameActionResult> {
    if (!this.canNext) return this.current();

    if (this.appliedMoves < this.forwardFrontier) {
      if (!this.controller.canRedo()) {
        throw new Error('Developer replay future history is unavailable for Redo.');
      }
      const redone = await this.controller.redo();
      if (!redone.accepted) {
        throw new Error(`Developer replay Redo failed: ${String(redone.reason ?? 'unknown reason')}`);
      }
      this.appliedMoves += 1;
      this.notifyDiagnosticScore();
      return redone;
    }

    const move = this.game.moves[this.appliedMoves];
    if (!move) return this.current();
    const result = await this.applyGeneratedMove(move);
    this.appliedMoves += 1;
    this.forwardFrontier = Math.max(this.forwardFrontier, this.appliedMoves);
    this.notifyDiagnosticScore();
    return result;
  }

  private async applyGeneratedMove(move: AlphaZeroGeneratedMove): Promise<Cube2DGameActionResult> {
    const currentPlayer = this.controller.viewModel().currentPlayer;
    if (currentPlayer !== move.color) {
      throw new DeveloperReplayCompatibilityError(
        move.moveNumber,
        move.color,
        move.action,
        `GoCube current player is ${currentPlayer}.`,
      );
    }

    const result =
      move.action.type === 'pass'
        ? await this.controller.pass()
        : await this.controller.placeStone(move.action.pointId);

    if (!result.accepted) {
      throw new DeveloperReplayCompatibilityError(
        move.moveNumber,
        move.color,
        move.action,
        `GoCube rejected the move: ${String(result.reason ?? 'unknown reason')}.`,
      );
    }

    if (move.captured && !samePointSet(move.captured, result.captured)) {
      throw new DeveloperReplayCompatibilityError(
        move.moveNumber,
        move.color,
        move.action,
        `captured mismatch (AlphaZero: [${move.captured.join(', ')}], GoCube: [${result.captured.join(', ')}]).`,
      );
    }

    return result;
  }

  private notifyDiagnosticScore(): void {
    this.finalScoreListener?.(this.diagnosticScore());
  }

  private assertMetadataMatchesController(): void {
    const snapshot = this.controller.snapshot();
    if (
      snapshot.boardSize !== this.game.size ||
      snapshot.ruleSet !== this.game.ruleSet ||
      snapshot.komi !== this.game.komi
    ) {
      throw new Error(
        `Generated game metadata does not match developer session: cube ${this.game.size} / ${this.game.ruleSet} / komi ${this.game.komi}.`,
      );
    }
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    if (this.inFlight) throw new Error('Developer replay operation already in progress.');
    this.inFlight = true;
    try {
      return await operation();
    } finally {
      this.inFlight = false;
    }
  }
}
