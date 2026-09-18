import type { StoneColor } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import type { PointId } from '../core/topology/Topology';
import type { SharedGameActionResult } from './GameSessionControllerFacade';
import { projectGameSessionToAlphaZeroPosition, type AlphaZeroPositionProjectionOptions } from './AlphaZeroPositionProjection';
import type { AlphaZeroAction, AlphaZeroGateway, AlphaZeroSelectedMove } from './development/AlphaZeroGateway';

export type BotTurnControllerActionResult = SharedGameActionResult;
export interface BotTurnGameController { snapshot(): GameSessionSnapshot; placeStone(point: PointId): Promise<BotTurnControllerActionResult>; pass(): Promise<BotTurnControllerActionResult>; }
export interface BotTurnCoordinatorOptions extends AlphaZeroPositionProjectionOptions { readonly gateway: Pick<AlphaZeroGateway, 'selectMove'>; readonly controller: () => BotTurnGameController; readonly checkpointId: string; readonly mctsSimulations: number; readonly requestIdFactory?: () => string; }
export type BotTurnResult = Readonly<{ status: 'applied'; requestId: string; action: AlphaZeroAction; result: BotTurnControllerActionResult }> | Readonly<{ status: 'stale'; requestId: string }>;
export type BotTurnCompatibilityReason = 'wrong-color' | 'action-rejected';
export class BotTurnCompatibilityError extends Error { readonly name = 'BotTurnCompatibilityError'; constructor(readonly reasonCode: BotTurnCompatibilityReason, readonly requestId: string, message: string) { super(message); } }
export class BotTurnUnavailableError extends Error { readonly name = 'BotTurnUnavailableError'; }
type PositionIdentity = Readonly<{ controller: BotTurnGameController; sessionRevision: number; moveNumber: number; currentPlayer: StoneColor }>;
const currentState = (snapshot: GameSessionSnapshot) => { const state = snapshot.history.at(-1); if (!state) throw new Error('GameSession history must contain a current state'); return state; };
const sessionRevision = (snapshot: GameSessionSnapshot): number => snapshot.sessionRevision ?? 0;
const defaultRequestIdFactory = (): string => globalThis.crypto.randomUUID();

export class BotTurnCoordinator {
  private readonly requestIdFactory: () => string;
  constructor(private readonly options: BotTurnCoordinatorOptions) {
    if (options.checkpointId.trim().length === 0) throw new Error('Bot checkpointId must be non-empty');
    if (!Number.isSafeInteger(options.mctsSimulations) || options.mctsSimulations <= 0) throw new Error(`Bot MCTS simulations must be a positive safe integer, got ${String(options.mctsSimulations)}`);
    this.requestIdFactory = options.requestIdFactory ?? defaultRequestIdFactory;
  }
  async playBotTurn(): Promise<BotTurnResult> {
    const controller = this.options.controller(); const snapshot = controller.snapshot(); const state = currentState(snapshot);
    if (state.phase !== 'playing') throw new BotTurnUnavailableError(`Bot move requires playing phase, got ${state.phase}`);
    const identity: PositionIdentity = Object.freeze({ controller, sessionRevision: sessionRevision(snapshot), moveNumber: state.moveNumber, currentPlayer: state.currentPlayer });
    const requestId = this.requestIdFactory(); if (!requestId) throw new Error('Bot requestId must be non-empty');
    const response = await this.options.gateway.selectMove(Object.freeze({ requestId, checkpointId: this.options.checkpointId, mctsSimulations: this.options.mctsSimulations, position: projectGameSessionToAlphaZeroPosition(snapshot, this.options) }));
    const currentController = this.options.controller(); const latestSnapshot = currentController.snapshot(); const latestState = currentState(latestSnapshot);
    if (!this.matchesPositionIdentity(identity, currentController, latestSnapshot)) return Object.freeze({ status: 'stale' as const, requestId });
    this.assertResponseColor(response, latestState.currentPlayer, requestId);
    const result = response.action.type === 'place' ? await currentController.placeStone(response.action.pointId) : await currentController.pass();
    if (!result.accepted) throw new BotTurnCompatibilityError('action-rejected', requestId, `GoCube rejected AlphaZero ${this.describeAction(response.action)}${result.reason ? ` (${result.reason})` : ''}`);
    return Object.freeze({ status: 'applied' as const, requestId, action: response.action, result });
  }
  private matchesPositionIdentity(expected: PositionIdentity, controller: BotTurnGameController, snapshot: GameSessionSnapshot): boolean { const state = currentState(snapshot); return controller === expected.controller && sessionRevision(snapshot) === expected.sessionRevision && state.moveNumber === expected.moveNumber && state.currentPlayer === expected.currentPlayer && state.phase === 'playing'; }
  private assertResponseColor(response: AlphaZeroSelectedMove, currentPlayer: StoneColor, requestId: string): void { if (response.color !== currentPlayer) throw new BotTurnCompatibilityError('wrong-color', requestId, `AlphaZero returned ${response.color} for ${currentPlayer} turn`); }
  private describeAction(action: AlphaZeroAction): string { return action.type === 'place' ? `place(${action.pointId})` : 'pass'; }
}
