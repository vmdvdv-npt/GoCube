import { useMemo, useState } from 'react';
import { CUBE_SIZES, type CubeSize } from '../core/topology/CubeTopology';
import { createCube2DLayout } from '../presentation/cube/Cube2DLayout';
import { CubeOrientation } from '../presentation/cube/CubeOrientation';
import { Cube2DRenderer } from '../renderer2d/Cube2DRenderer';
import './cube2d-preview.css';

const ORIENTATION_PRESETS = [
  { value: '0', label: 'Front · 0°', state: { centerFace: 'front', upFace: 'top' } },
  { value: '90', label: 'Front · 90°', state: { centerFace: 'front', upFace: 'left' } },
  { value: '180', label: 'Front · 180°', state: { centerFace: 'front', upFace: 'bottom' } },
  { value: '270', label: 'Front · 270°', state: { centerFace: 'front', upFace: 'right' } },
] as const;

type OrientationPreset = (typeof ORIENTATION_PRESETS)[number]['value'];

export function Cube2DPreview() {
  const [size, setSize] = useState<CubeSize>(4);
  const [orientationPreset, setOrientationPreset] = useState<OrientationPreset>('0');
  const orientation = useMemo(() => {
    const preset = ORIENTATION_PRESETS.find((candidate) => candidate.value === orientationPreset)!;
    return new CubeOrientation(preset.state);
  }, [orientationPreset]);
  const layout = useMemo(() => createCube2DLayout(orientation, size), [orientation, size]);
  const emptySlots = layout.rows.flat().filter((slot) => slot === null).length;

  return (
    <main className="cube-2d-preview">
      <header className="cube-2d-preview__header">
        <div>
          <p className="cube-2d-preview__kicker">Game Cube Go · 0.2 · task 01.03</p>
          <h1>Cube 2D renderer preview</h1>
          <p>
            Technical six-face cross inside the fixed 4×3 Cube2DLayout placement field.
            No stones, hit testing, navigation, animation, or game controls are active here.
          </p>
        </div>

        <div className="cube-2d-preview__controls">
          <label className="cube-2d-preview__control">
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

          <label className="cube-2d-preview__control">
            Diagnostic rotation
            <select
              aria-label="Diagnostic rotation"
              value={orientationPreset}
              onChange={(event) => setOrientationPreset(event.target.value as OrientationPreset)}
            >
              {ORIENTATION_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <section className="cube-2d-preview__status" aria-label="Preview orientation">
        <span>center: {orientation.centerFace}</span>
        <span>up: {orientation.upFace}</span>
        <span>occupied boards: {layout.cells.length}</span>
        <span>empty slots: {emptySlots}</span>
        <span>logical points: {6 * size * size}</span>
      </section>

      <div className="cube-2d-preview__viewport">
        <Cube2DRenderer layout={layout} diagnostics />
      </div>
    </main>
  );
}
