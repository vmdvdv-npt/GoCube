import type { StoneColor } from '../../core/game/types';
import type { PointId } from '../../core/topology/Topology';
import {
  Cube2DGameController,
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

  private appliedMoves = 0;
  private forwardFrontier = 0;
  private inFlight = false;

  constructor(game: AlphaZeroGeneratedGame) {
    if (game.topology !== 'cube') {
      throw new Error(
        `Development Workspace V1 replay supports Cube 2D games; received ${game.topology}.`,
      );
    }

    this.game = game;
    this.controller = new Cube2DGameController({
      size: game.size,
      ruleSet: game.ruleSet,
      komi: game.komi,
    });
    this.assertMetadataMatchesController();
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
      return redone;
    }

    const move = this.game.moves[this.appliedMoves];
    if (!move) return this.current();
    const result = await this.applyGeneratedMove(move);
    this.appliedMoves += 1;
    this.forwardFrontier = Math.max(this.forwardFrontier, this.appliedMoves);
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
