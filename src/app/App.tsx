import { TorusGame } from './TorusGame';

export function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="app-kicker">Game Cube Go · 0.1.14</p>
        <h1>Torus 2D</h1>
        <p>Interactive GameSession → PresentationModel → Torus2DRenderer integration.</p>
      </header>
      <TorusGame />
    </main>
  );
}
