import { describe, expectTypeOf, it } from 'vitest';
import type { PointId } from '../core/topology/Topology';
import type { GameViewModel } from '../presentation/PresentationModel';
import type { Renderer3D } from './Renderer3D';
import type { Cube3DVisualSandboxMount } from './sandbox/Cube3DVisualSandboxBoundary';

describe('Cube 3D foundation architecture', () => {
  it('keeps Renderer3D limited to presentation input and logical PointId output', () => {
    expectTypeOf<Parameters<Renderer3D['render']>>().toEqualTypeOf<[GameViewModel]>();
    expectTypeOf<ReturnType<Renderer3D['pointFromClientPosition']>>().toEqualTypeOf<PointId | null>();
  });

  it('keeps the visual sandbox seam limited to an isolated DOM mount lifecycle', () => {
    expectTypeOf<Parameters<Cube3DVisualSandboxMount['mount']>>().toEqualTypeOf<[HTMLElement]>();
    expectTypeOf<ReturnType<Cube3DVisualSandboxMount['mount']>>().toEqualTypeOf<() => void>();
  });
});
