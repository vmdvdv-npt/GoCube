import { useEffect } from 'react';

export interface DisposableGameController {
  dispose(): void;
}

/** One unmount/replacement cleanup path for every gameplay controller. */
export const useGameControllerLifecycle = (controller: DisposableGameController): void => {
  useEffect(() => () => controller.dispose(), [controller]);
};
