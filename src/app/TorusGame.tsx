import { FinalAnalysisProgressProvider } from './FinalAnalysisProgressContext';
import {
  TorusGame as TorusGameBase,
  type TorusGameProps,
} from './TorusGameBase';
import { useGameControllerLifecycle } from './useGameControllerLifecycle';

export type { TorusGameProps };

export function TorusGame(props: TorusGameProps) {
  useGameControllerLifecycle(props.controller);

  return (
    <FinalAnalysisProgressProvider source={props.controller.finalAnalysisProgressSource()}>
      <TorusGameBase {...props} />
    </FinalAnalysisProgressProvider>
  );
}
