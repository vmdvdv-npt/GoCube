import { useEffect } from 'react';
import type { AnimationMode } from '../../presentation/AnimationMode';
import { Cube2DGame } from '../Cube2DGame';
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

  if (replay.binding.topology === 'cube') {
    return (
      <Cube2DGame
        controller={replay.binding.controller}
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
      onRequestNewGame={() => undefined}
      initialShowDuplicateRegions={false}
      onShowDuplicateRegionsPreferenceChange={ignoreDuplicatePreference}
      gameplayReadOnly
      newGameDisabled
      animationMode={animationMode}
      externalAction={externalAction}
    />
  );
}
