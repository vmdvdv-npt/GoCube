import type { StoneColor } from '../core/game/types';
import type { PointId } from '../core/topology/Topology';
import type { CubeSize } from '../core/topology/CubeTopology';
import type { TorusSize } from '../core/topology/TorusTopology';
import {
  BotGameOrchestrator,
  type BotGameOrchestratorState,
  type BotGamePresentationEvent,
} from './BotGameOrchestrator';
import { Cube2DGameController } from './Cube2DGameController';
import type { ActiveGame, NewGameSettings } from './GameApplication';
import type { SharedGameActionResult } from './GameSessionControllerFacade';
import { TorusGameController } from './TorusGameController';
import type { AlphaZeroGateway } from './development/AlphaZeroGateway';

export const createEphemeralGame = (settings: NewGameSettings): ActiveGame =>
  settings.gameMode === 'cube-2d'
    ? Object.freeze({
        gameMode: 'cube-2d' as const,
        controller: new Cube2DGameController({
          size: settings.size as CubeSize,
          ruleSet: settings.ruleSet,
          komi: settings.komi,
        }),
      })
    : Object.freeze({
        gameMode: 'torus-2d' as const,
        controller: new TorusGameController({
          size: settings.size as TorusSize,
          ruleSet: settings.ruleSet,
          komi: settings.komi,
        }),
      });

export type BotRuntimeEvent = BotGamePresentationEvent;

export interface BotRuntime {
  orchestrator: BotGameOrchestrator;
  controller: ActiveGame['controller'];
  presentationController: ActiveGame['controller'];
  state(): BotGameOrchestratorState;
}

type PendingHumanPresentation = Readonly<{
  resolve: (result: SharedGameActionResult) => void;
  reject: (error: unknown) => void;
}>;

export const createBotRuntime = (options: {
  activeGame: ActiveGame;
  gateway: AlphaZeroGateway;
  humanColor: StoneColor;
  checkpointId: string;
  mctsSimulations: number;
  onEvent: (event: BotRuntimeEvent) => void;
}): BotRuntime => {
  const { activeGame, gateway, humanColor, checkpointId, mctsSimulations, onEvent } = options;
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

  const presentationController = new Proxy(controller as object, {
    get(target, property, receiver) {
      if (property === 'placeStone') {
        return (point: PointId) =>
          runHumanPresentationAction(() => orchestrator.humanPlaceStone(point));
      }
      if (property === 'pass') {
        return () => runHumanPresentationAction(() => orchestrator.humanPass());
      }
      if (property === 'canUndo' || property === 'canRedo') return () => false;
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as ActiveGame['controller'];

  return {
    orchestrator,
    controller,
    presentationController,
    state: () => orchestrator.state(),
  };
};
