import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const importsFrom = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('import '));

describe('Cube 3D foundation architecture', () => {
  it('keeps Renderer3D limited to presentation input and logical PointId output', () => {
    expect(importsFrom(source('./Renderer3D.ts'))).toEqual([
      "import type { PointId } from '../core/topology/Topology';",
      "import type { GameViewModel } from '../presentation/PresentationModel';",
    ]);
  });

  it('keeps the visual sandbox seam independent from production game modules', () => {
    expect(importsFrom(source('./sandbox/Cube3DVisualSandboxBoundary.ts'))).toEqual([]);
    expect(source('../main.tsx')).not.toContain('renderer3d/sandbox');
  });
});
