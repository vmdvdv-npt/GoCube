import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cubeNetFoldMatrix } from './CubeNetFold';

describe('cube net hinges', () => {
  for (const anchor of [0, 1, 2, 3]) {
    it(`closes six distinct faces from cross column ${anchor + 1}`, () => {
      const cells = [[0, anchor], ...[0, 1, 2, 3].map(column => [1, column]), [2, anchor]];
      const centers = cells.map(([row, column]) => {
        const flat = new Vector3().applyMatrix4(cubeNetFoldMatrix(row, column, anchor, 0));
        expect(flat.toArray()).toEqual([column - anchor, row - 1, 0]);
        const folded = cubeNetFoldMatrix(row, column, anchor, 1);
        const center = new Vector3().applyMatrix4(folded).add(new Vector3(0, 0, 0.5));
        const normal = new Vector3(0, 0, 1).transformDirection(folded);
        expect(center.distanceTo(normal.multiplyScalar(0.5))).toBeLessThan(1e-10);
        return center.toArray().map(value => Math.round(value * 2)).join(',');
      });
      expect(new Set(centers).size).toBe(6);
    });
    it(`keeps every belt seam attached during folding in column ${anchor + 1}`, () => {
      for (const progress of [0.2, 0.5, 0.8]) {
        for (let column = 0; column < 3; column++) {
          const left = cubeNetFoldMatrix(1, column, anchor, progress);
          const right = cubeNetFoldMatrix(1, column + 1, anchor, progress);
          for (const y of [-0.5, 0.5]) {
            expect(new Vector3(0.5, y, 0).applyMatrix4(left).distanceTo(
              new Vector3(-0.5, y, 0).applyMatrix4(right),
            )).toBeLessThan(1e-10);
          }
        }
      }
    });
  }
});
