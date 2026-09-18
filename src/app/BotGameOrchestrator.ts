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
  | 'retry-unavailable';

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

const currentState = (controller: BotTurnGameController) => {
  const snapshot = controller.snapshot();
  const state = snapshot.history[snapshot.history.length - 1];
  if (!state) throw new Error('GameSession history must contain a current state');
  return state;
};

const oppositeColor = (color: StoneColor): StoneColor => (color === 'black' ? 'white' : 'black');

export class BotGameOrchestrator {
  readonly humanColor: StoneColor;
  readonly botColor: StoneColor;

  private readonly resolveController: () => BotTurnGameController;
  private readonly botTurnCoordinator: BotTurnCoordinator;
  private readonly inFlightByController = new WeakMap<BotTurnGameController, Promise<BotTurnResult>>();
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

  private async performHumanAction(
    action: (controller: BotTurnGameController) => Promise<BotTurnControllerActionResult>,
  ): Promise<BotTurnControllerActionResult> {
    const controller = this.resolveController();
    const state = currentState(controller);

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

    if (this.failureController === controller) {
      this.failureController = null;
      this.failure = null;
    }

    const pending = this.botTurnCoordinator.playBotTurn();
    this.inFlightByController.set(controller, pending);
    this.publish({ type: 'state-changed', state: 'bot-thinking' });

    try {
      const result = await pending;
      if (result.status === 'applied' && this.resolveController() === controller) {
        this.publish({ type: 'bot-action-accepted', result: result.result });
      }
      return result;
    } catch (error) {
      if (this.resolveController() === controller) {
        const latest = currentState(controller);
        if (latest.phase === 'playing' && latest.currentPlayer === this.botColor) {
          this.failureController = controller;
          this.failure = error;
        }
      }

      if (propagateFailure) throw error;
      return null;
    } finally {
      if (this.inFlightByController.get(controller) === pending) {
        this.inFlightByController.delete(controller);
      }
      if (this.resolveController() === controller) {
        this.publish({ type: 'state-changed', state: this.state() });
      }
    }
  }
}
