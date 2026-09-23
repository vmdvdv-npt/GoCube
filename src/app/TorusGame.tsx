import { useState } from 'react';
import { Torus3DScene } from '../renderer3d/Torus3DScene';
import '../renderer3d/torus3d.css';
import { FinalAnalysisProgressProvider } from './FinalAnalysisProgressContext';
import {
  TorusGame as TorusGameBase,
  type TorusGameProps,
} from './TorusGameBase';

export type { TorusGameProps };

export function TorusGame(props: TorusGameProps) {
  const [show3DFoundation, setShow3DFoundation] = useState(false);
  const foundationEntryEnabled =
    import.meta.env.DEV || new URLSearchParams(window.location.search).has('torus3d');

  return (
    <FinalAnalysisProgressProvider source={props.controller.finalAnalysisProgressSource()}>
      <div className="torus-3d-foundation-host" data-torus3d-foundation={show3DFoundation ? 'open' : 'closed'}>
        <TorusGameBase {...props} />
        {foundationEntryEnabled ? (
          <button
            className="torus-3d-foundation-toggle"
            type="button"
            aria-pressed={show3DFoundation}
            onClick={() => setShow3DFoundation((current) => !current)}
          >
            {show3DFoundation ? 'Torus 2D' : 'Torus 3D prototype'}
          </button>
        ) : null}
        {foundationEntryEnabled && show3DFoundation ? (
          <div className="torus-3d-foundation-overlay" aria-label="Torus 3D prototype view">
            <Torus3DScene size={props.controller.size} />
          </div>
        ) : null}
      </div>
    </FinalAnalysisProgressProvider>
  );
}
