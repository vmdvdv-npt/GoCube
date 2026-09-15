import { describe, expect, it } from 'vitest';
import { Cube2DGameController } from './Cube2DGameController';
import { TorusGameController } from './TorusGameController';

describe('game controller defaults', () => {
  it('defaults new Cube and Torus sessions to komi 0.5', () => {
    const cube = new Cube2DGameController();
    const torus = new TorusGameController();

    expect(cube.snapshot().komi).toBe(0.5);
    expect(torus.snapshot().komi).toBe(0.5);

    cube.dispose();
    torus.dispose();
  });
});
