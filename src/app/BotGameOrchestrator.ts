import type { StoneColor } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import {
  BotTurnCoordinator,
  type BotTurnControllerActionResult,
  type BotTurnGameController,
  type BotTurnResult,
} from './BotTurnCoordinator';
import type { AlphaZeroGateway } from './development/AlphaZeroGateway';
import type { AlphaZeroPositionProjectionOptions } from './AlphaZeroPositionProjection';

export type BotGameOrchestratorState =
  | 'human-turn'
  | 'bot-turn'
  | 'bot-thinking'
  | 'endgame'
  | 'finished'
  | 'error';

export type BotGameActionBlockReason =
  | 'bot-thinking'
  | 'not-human-turn'
  | 'not-bot-turn'
  | 'not-playing'
  | 'retry-required'
  | 'retry-unavailable'
  | 'history-operation'
  | 'undo-unavailable'
  | 'redo-unavailable';

export class BotGameActionBlockedError extends Error {
  readonly name = 'BotGameActionBlockedError';

  constructor(
    readonly reasonCode: BotGameActionBlockReason,
    message: string,
  ) {
    super(message);
  }
}

export type BotGamePresentationEvent =
  | Readonly<{ type: 'human-action-accepted'; result: BotTurnControllerActionResult }>
  | Readonly<{ type: 'bot-action-accepted'; result: BotTurnControllerActionResult }>
  | Readonly<{ type: 'state-changed'; state: BotGameOrchestratorState }>;

export interface BotGameOrchestratorOptions extends AlphaZeroPositionProjectionOptions {
  readonly gateway: Pick<AlphaZeroGateway, 'selectMove'>;
  readonly controller: BotTurnGameController | (() => BotTurnGameController);
  readonly humanColor: StoneColor;
  readonly checkpointId: string;
  readonly mctsSimulations: number;
  readonly requestIdFactory?: () => string;
  readonly onPresentationEvent?: (event: BotGamePresentationEvent) => void;
}

type BotHistoryController = BotTurnGameController & Readonly<{
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => Promise<BotTurnControllerActionResult>;
  redo: () => Promise<BotTurnControllerActionResult>;
}>;

type ActiveBotTurn = Readonly<{
  promise: Promise<BotTurnResult>;
}>;

const currentState = (controller: BotTurnGameController) => {
  const snapshot = controller.snapshot();
  const state = snapshot.history[snapshot.history.length - 1];
  if (!state) throw new Error('GameSession history must contain a current state');
  return state;
};

const historyController = (controller: BotTurnGameController): BotHistoryController => {
  const candidate = controller as Partial<BotHistoryController>;
  if (
    typeof candidate.canUndo !== 'function' ||
    typeof candidate.canRedo !== 'function' ||
    typeof candidate.undo !== 'function' ||
    typeof candidate.redo !== 'function'
  ) {
    throw new Error('Bot game controller must expose authoritative GameSession history commands');
  }
  return controller as BotHistoryController;
};

const oppositeColor = (color: StoneColor): StoneColor => (color === 'black' ? 'white' : 'black');

export class BotGameOrchestrator {
  readonly humanColor: StoneColor;
  readonly botColor: StoneColor;

  private readonly resolveController: () => BotTurnGameController;
  private readonly botTurnCoordinator: BotTurnCoordinator;
  private readonly inFlightByController = new WeakMap<BotTurnGameController, ActiveBotTurn>();
  private readonly historyOperationByController = new WeakSet<BotTurnGameController>();
  private failureController: BotTurnGameController | null = null;
  private failure: unknown | null = null;

  constructor(private readonly options: BotGameOrchestratorOptions) {
    this.humanColor = options.humanColor;
    this.botColor = oppositeColor(options.humanColor);
    const controllerSource = options.controller;
    this.resolveController =
      typeof controllerSource === 'function' ? controllerSource : () => controllerSource;

    this.botTurnCoordinator = new BotTurnCoordinator({
      gateway: options.gateway,
      controller: this.resolveController,
      checkpointId: options.checkpointId,
      mctsSimulations: options.mctsSimulations,
      topology: options.topology,
      size: options.size,
      requestIdFactory: options.requestIdFactory,
    });
  }

  state(): BotGameOrchestratorState {
    const controller = this.resolveController();
    const state = currentState(controller);

    if (this.failureController === controller && this.failure !== null) return 'error';
    if (state.phase === 'endgame') return 'endgame';
    if (state.phase === 'finished') return 'finished';
    if (this.inFlightByController.has(controller)) return 'bot-thinking';
    return state.currentPlayer === this.humanColor ? 'human-turn' : 'bot-turn';
  }

  lastError(): unknown | null {
    const controller = this.resolveController();
    return this.failureController === controller ? this.failure : null;
  }

  canUndo(): boolean {
    const controller = this.resolveController();
    if (this.historyOperationByController.has(controller)) return false;
    return this.undoStepsForCurrentHumanDecision(controller) > 0;
  }

  canRedo(): boolean {
    const controller = this.resolveController();
    if (this.historyOperationByController.has(controller)) return false;

    const snapshot = controller.snapshot();
    const state = snapshot.history.at(-1);
    if (!state || state.phase !== 'playing' || state.currentPlayer !== this.humanColor) {
      return false;
    }
    return Boolean(snapshot.redo?.length) && historyController(controller).canRedo();
  }

  async undoHumanTurn(): Promise<BotTurnControllerActionResult> {
    const controller = this.resolveController();
    if (this.historyOperationByController.has(controller)) {
      throw new BotGameActionBlockedError(
        'history-operation',
        'A bot-aware history operation is already in progress',
      );
    }

    const steps = this.undoStepsForCurrentHumanDecision(controller);
    if (steps === 0) {
      throw new BotGameActionBlockedError(
        'undo-unavailable',
        'There is no human decision available to undo',
      );
    }

    const history = historyController(controller);
    this.historyOperationByController.add(controller);
    // The authoritative Undo below mutates GameSession immediately. Releasing the
    // logical request slot lets a later Redo start a fresh request without waiting
    // for a response that is now guaranteed to be stale by position identity.
    this.inFlightByController.delete(controller);
    this.clearFailure(controller);

    try {
      let result: BotTurnControllerActionResult | null = null;
      for (let step = 0; step < steps; step += 1) {
        result = await history.undo();
        if (!result.accepted) {
          throw new BotGameActionBlockedError(
            'undo-unavailable',
            `Authoritative GameSession rejected bot-aware Undo${result.reason ? ` (${result.reason})` : ''}`,
          );
        }
      }

      if (!result) throw new Error('Bot-aware Undo did not execute any history step');
      this.publish({ type: 'state-changed', state: this.state() });
      return result;
    } finally {
      this.historyOperationByController.delete(controller);
    }
  }

  async redoHumanTurn(): Promise<BotTurnControllerActionResult> {
    const controller = this.resolveController();
    if (this.historyOperationByController.has(controller)) {
      throw new BotGameActionBlockedError(
        'history-operation',
        'A bot-aware history operation is already in progress',
      );
    }
    if (!this.canRedo()) {
      throw new BotGameActionBlockedError(
        'redo-unavailable',
        'There is no human decision available to redo',
      );
    }

    const history = historyController(controller);
    this.historyOperationByController.add(controller);
    this.clearFailure(controller);

    try {
      const humanResult = await history.redo();
      if (!humanResult.accepted) return humanResult;
      if (this.resolveController() !== controller) return humanResult;

      const afterHuman = currentState(controller);
      if (afterHuman.phase !== 'playing' || afterHuman.currentPlayer !== this.botColor) {
        this.publish({ type: 'state-changed', state: this.state() });
        return humanResult;
      }

      // When the bot response already exists in GameSession redo-future, restore
      // it directly. AlphaZero must not be called again for an already-played pair.
      if (history.canRedo()) {
        const botResult = await history.redo();
        if (!botResult.accepted) return botResult;
        this.publish({ type: 'state-changed', state: this.state() });
        return botResult;
      }

      // Interrupted/failed turns only have the human state in redo-future. Start
      // the ordinary bot path, but return the restored human state immediately so
      // presentation does not wait for MCTS before showing Redo.
      void this.runBotTurn(controller, false).catch(() => undefined);
      return humanResult;
    } finally {
      this.historyOperationByController.delete(controller);
    }
  }

  async start(): Promise<BotTurnResult | null> {
    const controller = this.resolveController();
    const state = currentState(controller);

    if (state.phase !== 'playing') return null;
    if (state.currentPlayer === this.humanColor) return null;
    if (this.failureController === controller && this.failure !== null) {
      throw new BotGameActionBlockedError(
        'retry-required',
        'The bot turn previously failed; retryBotTurn() is required',
      );
    }

    return this.runBotTurn(controller, true);
  }

  async humanPlaceStone(point: PointId): Promise<BotTurnControllerActionResult> {
    return this.performHumanAction((controller) => controller.placeStone(point));
  }

  async humanPass(): Promise<BotTurnControllerActionResult> {
    return this.performHumanAction((controller) => controller.pass());
  }

  async retryBotTurn(): Promise<BotTurnResult> {
    const controller = this.resolveController();
    if (this.failureController !== controller || this.failure === null) {
      throw new BotGameActionBlockedError('retry-unavailable', 'There is no failed bot turn to retry');
    }

    const state = currentState(controller);
    if (state.phase !== 'playing') {
      throw new BotGameActionBlockedError(
        'not-playing',
        `Bot retry requires playing phase, got ${state.phase}`,
      );
    }
    if (state.currentPlayer !== this.botColor) {
      throw new BotGameActionBlockedError(
        'not-bot-turn',
        `Bot retry requires ${this.botColor} to move, got ${state.currentPlayer}`,
      );
    }

    return this.runBotTurn(controller, true);
  }

  private publish(event: BotGamePresentationEvent): void {
    try {
      this.options.onPresentationEvent?.(event);
    } catch {
      // Presentation observers must never alter accepted gameplay semantics.
    }
  }

  private clearFailure(controller: BotTurnGameController): void {
    if (this.failureController !== controller) return;
    this.failureController = null;
    this.failure = null;
  }

  private undoStepsForCurrentHumanDecision(controller: BotTurnGameController): 0 | 1 | 2 {
    const history = controller.snapshot().history;
    const lastActionOwner = history.at(-2)?.currentPlayer;
    if (lastActionOwner === this.humanColor) return 1;

    const previousActionOwner = history.at(-3)?.currentPlayer;
    if (lastActionOwner === this.botColor && previousActionOwner === this.humanColor) {
      return 2;
    }
    return 0;
  }

  private async performHumanAction(
    action: (controller: BotTurnGameController) => Promise<BotTurnControllerActionResult>,
  ): Promise<BotTurnControllerActionResult> {
    const controller = this.resolveController();
    const state = currentState(controller);

    if (this.historyOperationByController.has(controller)) {
      throw new BotGameActionBlockedError(
        'history-operation',
        'Human input is blocked while a history operation is in progress',
      );
    }
    if (this.inFlightByController.has(controller)) {
      throw new BotGameActionBlockedError(
        'bot-thinking',
        'Human input is blocked while the bot is thinking',
      );
    }
    if (state.phase !== 'playing') {
      throw new BotGameActionBlockedError(
        'not-playing',
        `Human input requires playing phase, got ${state.phase}`,
      );
    }
    if (state.currentPlayer !== this.humanColor) {
      throw new BotGameActionBlockedError(
        'not-human-turn',
        `Human input requires ${this.humanColor} to move, got ${state.currentPlayer}`,
      );
    }

    const result = await action(controller);
    if (!result.accepted) return result;

    // Publish the real authoritative human action result immediately so the
    // presentation can render it before the following MCTS request completes.
    this.publish({ type: 'human-action-accepted', result });

    if (this.resolveController() !== controller) return result;

    const latest = currentState(controller);
    if (latest.phase !== 'playing' || latest.currentPlayer !== this.botColor) return result;

    // Preserve the established headless contract: awaiting humanPlaceStone/
    // humanPass waits until the automatically-following bot turn has settled.
    // Presentation does not wait because it consumes the event published above.
    await this.runBotTurn(controller, false);
    return result;
  }

  private async runBotTurn(
    controller: BotTurnGameController,
    propagateFailure: true,
  ): Promise<BotTurnResult>;
  private async runBotTurn(
    controller: BotTurnGameController,
    propagateFailure: false,
  ): Promise<BotTurnResult | null>;
  private async runBotTurn(
    controller: BotTurnGameController,
    propagateFailure: boolean,
  ): Promise<BotTurnResult | null> {
    if (this.resolveController() !== controller) return null;

    if (this.inFlightByController.has(controller)) {
      throw new BotGameActionBlockedError(
        'bot-thinking',
        'A bot request is already in flight for this game',
      );
    }

    const state = currentState(controller);
    if (state.phase !== 'playing') {
      throw new BotGameActionBlockedError(
        'not-playing',
        `Bot turn requires playing phase, got ${state.phase}`,
      );
    }
    if (state.currentPlayer !== this.botColor) {
      throw new BotGameActionBlockedError(
        'not-bot-turn',
        `Bot turn requires ${this.botColor} to move, got ${state.currentPlayer}`,
      );
    }

    this.clearFailure(controller);

    const pendingPromise = this.botTurnCoordinator.playBotTurn();
    const activeTurn = Object.freeze({ promise: pendingPromise });
    this.inFlightByController.set(controller, activeTurn);
    this.publish({ type: 'state-changed', state: 'bot-thinking' });

    try {
      const result = await pendingPromise;
      if (
        result.status === 'applied' &&
        this.resolveController() === controller &&
        this.inFlightByController.get(controller) === activeTurn
      ) {
        this.publish({ type: 'bot-action-accepted', result: result.result });
      }
      return result;
    } catch (error) {
      if (
        this.resolveController() === controller &&
        this.inFlightByController.get(controller) === activeTurn
      ) {
        const latest = currentState(controller);
        if (latest.phase === 'playing' && latest.currentPlayer === this.botColor) {
          this.failureController = controller;
          this.failure = error;
        }
      }

      if (propagateFailure) throw error;
      return null;
    } finally {
      if (this.inFlightByController.get(controller) === activeTurn) {
        this.inFlightByController.delete(controller);
        if (this.resolveController() === controller) {
          this.publish({ type: 'state-changed', state: this.state() });
        }
      }
    }
  }
}
