import type { StoneColor } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import {
  BotGameOrchestrator,
  type BotGameOrchestratorState,
  type BotGamePresentationEvent,
} from './BotGameOrchestrator';
import type { ActiveGame } from './GameApplication';
import type { GameInteractionBoundary } from './GameInteractionBoundary';
import type { SharedGameActionResult } from './GameSessionControllerFacade';
import type { AlphaZeroGateway } from './development/AlphaZeroGateway';

export type BotRuntimeEvent = BotGamePresentationEvent;

export interface BotRuntime {
  readonly identity: number;
  readonly orchestrator: BotGameOrchestrator;
  readonly controller: ActiveGame['controller'];
  readonly interaction: GameInteractionBoundary;
  state(): BotGameOrchestratorState;
}

type PendingHumanPresentation = Readonly<{
  resolve: (result: SharedGameActionResult) => void;
  reject: (error: unknown) => void;
}>;

export const createBotRuntime = (options: {
  identity: number;
  activeGame: ActiveGame;
  gateway: AlphaZeroGateway;
  humanColor: StoneColor;
  checkpointId: string;
  mctsSimulations: number;
  onEvent: (event: BotRuntimeEvent) => void;
}): BotRuntime => {
  const {
    identity,
    activeGame,
    gateway,
    humanColor,
    checkpointId,
    mctsSimulations,
    onEvent,
  } = options;
  const controller = activeGame.controller;
  let pendingHumanPresentation: PendingHumanPresentation | null = null;

  const orchestrator = new BotGameOrchestrator({
    controller,
    gateway,
    humanColor,
    checkpointId,
    mctsSimulations,
    topology: activeGame.gameMode === 'cube-2d' ? 'cube' : 'torus',
    size: controller.size,
    onPresentationEvent: (event) => {
      if (event.type === 'human-action-accepted' && pendingHumanPresentation) {
        const pending = pendingHumanPresentation;
        pendingHumanPresentation = null;
        pending.resolve(event.result);
      }
      onEvent(event);
    },
  });

  const runHumanPresentationAction = (
    action: () => Promise<SharedGameActionResult>,
  ): Promise<SharedGameActionResult> =>
    new Promise((resolve, reject) => {
      if (pendingHumanPresentation) {
        reject(new Error('A human presentation action is already in flight'));
        return;
      }

      pendingHumanPresentation = Object.freeze({ resolve, reject });
      void action()
        .then((result) => {
          if (!pendingHumanPresentation) return;
          const pending = pendingHumanPresentation;
          pendingHumanPresentation = null;
          pending.resolve(result);
        })
        .catch((error: unknown) => {
          if (!pendingHumanPresentation) return;
          const pending = pendingHumanPresentation;
          pendingHumanPresentation = null;
          pending.reject(error);
        });
    });

  const interaction: GameInteractionBoundary = Object.freeze({
    placeStone: (point: PointId) =>
      runHumanPresentationAction(() => orchestrator.humanPlaceStone(point)),
    pass: () => runHumanPresentationAction(() => orchestrator.humanPass()),
    undo: () => orchestrator.undoHumanTurn(),
    redo: () => orchestrator.redoHumanTurn(),
    canUndo: () => orchestrator.canUndo(),
    canRedo: () => orchestrator.canRedo(),
  });

  return Object.freeze({
    identity,
    orchestrator,
    controller,
    interaction,
    state: () => orchestrator.state(),
  });
};
