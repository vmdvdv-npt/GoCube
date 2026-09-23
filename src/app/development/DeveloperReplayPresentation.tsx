import { useEffect, useMemo } from 'react';
import type { PointId } from '../../core/topology/Topology';
import type { AnimationMode } from '../../presentation/AnimationMode';
import { Cube2DGame } from '../Cube2DGame';
import type { GameInteractionBoundary } from '../GameInteractionBoundary';
import type { SharedGameActionResult } from '../GameSessionControllerFacade';
import { TorusGame } from '../TorusGame';
import type { DeveloperReplaySession } from './DeveloperReplaySession';

export type DeveloperReplayExternalAction = Readonly<{
  sequence: number;
  result: SharedGameActionResult;
}>;

export interface DeveloperReplayPresentationProps {
  readonly replay: DeveloperReplaySession;
  readonly animationMode: AnimationMode;
  readonly externalAction: DeveloperReplayExternalAction | null;
}

const ignoreDuplicatePreference = (): void => undefined;

/**
 * Presentation-only topology switch. Replay orchestration stays topology-neutral;
 * each branch reuses the normal GoCube view for the controller created by the factory.
 */
export function DeveloperReplayPresentation({
  replay,
  animationMode,
  externalAction,
}: DeveloperReplayPresentationProps) {
  useEffect(() => () => replay.controller.dispose(), [replay]);

  // The normal game views now obtain history availability from their interaction
  // boundary so Play vs bot can expose bot-aware Undo/Redo while ordinary input is
  // locked. Developer replay remains read-only: its own Previous/Next controls are
  // the only history navigation authority.
  const readOnlyInteraction = useMemo<GameInteractionBoundary>(() => {
    const controller = replay.binding.controller;
    return Object.freeze({
      placeStone: (point: PointId) => controller.placeStone(point),
      pass: () => controller.pass(),
      undo: () => controller.undo(),
      redo: () => controller.redo(),
      canUndo: () => false,
      canRedo: () => false,
    });
  }, [replay]);

  if (replay.binding.topology === 'cube') {
    return (
      <Cube2DGame
        controller={replay.binding.controller}
        interaction={readOnlyInteraction}
        onRequestNewGame={() => undefined}
        gameplayReadOnly
        newGameDisabled
        animationMode={animationMode}
        externalAction={externalAction}
      />
    );
  }

  return (
    <TorusGame
      controller={replay.binding.controller}
      interaction={readOnlyInteraction}
      onRequestNewGame={() => undefined}
      initialShowDuplicateRegions={false}
      onShowDuplicateRegionsPreferenceChange={ignoreDuplicatePreference}
      gameplayReadOnly
      newGameDisabled
      animationMode={animationMode}
      externalAction={externalAction}
      initialViewMode="2d"
    />
  );
}
