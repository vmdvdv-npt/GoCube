import { useMemo, useState } from 'react';
import { CUBE_SIZES, type CubeSize } from '../core/topology/CubeTopology';
import { createCube2DLayout } from '../presentation/cube/Cube2DLayout';
import { CubeOrientation } from '../presentation/cube/CubeOrientation';
import { Cube2DRenderer } from '../renderer2d/Cube2DRenderer';
import './cube2d-preview.css';

export function Cube2DPreview() {
  const [size, setSize] = useState<CubeSize>(4);
  const orientation = useMemo(() => new CubeOrientation(), []);
  const layout = useMemo(() => createCube2DLayout(orientation, size), [orientation, size]);

  return (
    <main className="cube-2d-preview">
      <header className="cube-2d-preview__header">
        <div>
          <p className="cube-2d-preview__kicker">Game Cube Go · 0.2 · task 01.03</p>
          <h1>Cube 2D renderer preview</h1>
          <p>
            Technical 4×3 view of the logical Cube2DLayout. No stones, hit testing,
            navigation, animation, or game controls are active here.
          </p>
        </div>

        <label className="cube-2d-preview__size-control">
          Cube size
          <select
            aria-label="Cube size"
            value={size}
            onChange={(event) => setSize(Number(event.target.value) as CubeSize)}
          >
            {CUBE_SIZES.map((option) => (
              <option key={option} value={option}>
                {option}×{option}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="cube-2d-preview__status" aria-label="Preview orientation">
        <span>center: {orientation.centerFace}</span>
        <span>up: {orientation.upFace}</span>
        <span>boards: {layout.cells.length}</span>
        <span>logical points: {6 * size * size}</span>
      </section>

      <div className="cube-2d-preview__viewport">
        <Cube2DRenderer layout={layout} diagnostics />
      </div>
    </main>
  );
}
