import { useEffect } from 'react';

export interface DisposableGameController {
  dispose(): void;
}

/** Dispose a controller only from the React boundary that explicitly owns it. */
export const useGameControllerLifecycle = (
  controller: DisposableGameController | null,
): void => {
  useEffect(() => {
    if (!controller) return undefined;
    return () => controller.dispose();
  }, [controller]);
};
