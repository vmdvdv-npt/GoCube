import type { StoneColor } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import {
  BotTurnCoordinator,
  type BotTurnControllerActionResult,
  type BotTurnGameController,
  type BotTurnResult,
} from './BotTurnCoordinator';
import type {
  AlphaZeroGateway,
} from './development/AlphaZeroGateway';
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

export interface BotGameOrchestratorOptions extends AlphaZeroPositionProjectionOptions {
  readonly gateway: Pick<AlphaZeroGateway, 'selectMove'>;
  /**
   * A direct controller is sufficient for one fixed game. A resolver supports
   * the application-owned active-game identity and lets stale protection prove
   * that a replaced session must not receive an old AlphaZero response.
   */
  readonly controller: BotTurnGameController | (() => BotTurnGameController);
  readonly humanColor: StoneColor;
  readonly checkpointId: string;
  readonly mctsSimulations: number;
  readonly requestIdFactory?: () => string;
}

const currentState = (controller: BotTurnGameController) => {
  const snapshot = controller.snapshot();
  const state = snapshot.history[snapshot.history.length - 1];
  if (!state) throw new Error('GameSession history must contain a current state');
  return state;
};

const oppositeColor = (color: StoneColor): StoneColor => (color === 'black' ? 'white' : 'black');

/**
 * Owns the application lifecycle of one human-vs-bot game while delegating a
 * single AlphaZero proposal to BotTurnCoordinator. It stores no board or move
 * history: every bot request is rebuilt from the authoritative GameSession.
 */
export class BotGameOrchestrator {
  readonly humanColor: StoneColor;
  readonly botColor: StoneColor;

  private readonly resolveController: () => BotTurnGameController;
  private readonly botTurnCoordinator: BotTurnCoordinator;
  private readonly inFlightByController = new WeakMap<BotTurnGameController, Promise<BotTurnResult>>();
  private failureController: BotTurnGameController | null = null;
  private failure: unknown | null = null;

  constructor(options: BotGameOrchestratorOptions) {
    this.humanColor = options.humanColor;
    this.botColor = oppositeColor(options.humanColor);
    this.resolveController =
      typeof options.controller === 'function' ? options.controller : () => options.controller;

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

  /**
   * Starts bot ownership when the current authoritative turn belongs to it.
   * In particular, human=White causes Black to move before control reaches the
   * human. Human=Black starts immediately in human-turn and performs no I/O.
   */
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

  /** Re-runs a failed bot turn from the current authoritative GameSession history. */
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

    // The action belonged to the old game. Do not start a request for a newly
    // installed controller/session if the application replaced it meanwhile.
    if (this.resolveController() !== controller) return result;

    const latest = currentState(controller);
    if (latest.phase !== 'playing' || latest.currentPlayer !== this.botColor) return result;

    // The human action is already authoritative. A bot failure is reflected in
    // orchestrator state and must never turn that accepted human action into a
    // rollback or fallback Pass.
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

    try {
      return await pending;
    } catch (error) {
      // A failure from an obsolete request must not put a replacement game into
      // error. For the still-current game, keep the authoritative position and
      // make retry explicitly available.
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
    }
  }
}
