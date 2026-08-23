import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { Cube2DPreview } from './app/Cube2DPreview';
import { EndgameGroupFloatingControls } from './app/EndgameGroupFloatingControls';
import { installTorus2DVectorCameraGuard } from './renderer2d/Torus2DVectorCameraGuard';
import './styles.css';
import './visual-overrides.css';
import './renderer2d/shared-board-theme.css';
import './renderer2d/stone-placement.css';

const showCube2DPreview = new URLSearchParams(window.location.search).has('cube2d-preview');

installTorus2DVectorCameraGuard();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {showCube2DPreview ? (
      <Cube2DPreview />
    ) : (
      <>
        <App />
        <EndgameGroupFloatingControls />
      </>
    )}
  </React.StrictMode>,
);
