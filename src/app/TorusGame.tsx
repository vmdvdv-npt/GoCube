import { FinalAnalysisProgressProvider } from './FinalAnalysisProgressContext';
import {
  TorusGame as TorusGameBase,
  type TorusGameProps,
} from './TorusGameBase';

export type { TorusGameProps };

export function TorusGame(props: TorusGameProps) {
  return (
    <FinalAnalysisProgressProvider source={props.controller.finalAnalysisProgressSource()}>
      <TorusGameBase {...props} />
    </FinalAnalysisProgressProvider>
  );
}
