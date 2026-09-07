import { FinalAnalysisProgressProvider } from './FinalAnalysisProgressContext';
import { TorusGameBase, type TorusGameProps } from './TorusGameBase';
import './manual-endgame.css';
import './game-viewport.css';

export function TorusGame(props: TorusGameProps) {
  return (
    <FinalAnalysisProgressProvider source={props.controller.finalAnalysisProgressSource()}>
      <TorusGameBase {...props} />
    </FinalAnalysisProgressProvider>
  );
}
