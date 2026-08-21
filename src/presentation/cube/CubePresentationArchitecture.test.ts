import { describe, expect, it } from 'vitest';
import { createCube2DLayout } from './Cube2DLayout';
import { CubeOrientation } from './CubeOrientation';

describe('Cube orientation/layout architecture boundary', () => {
  it('exposes only logical orientation data', () => {
    const orientation = new CubeOrientation();
    const state = orientation.toState();

    expect(state).toEqual({ centerFace: 'front', upFace: 'top' });
    expect(Object.keys(state).sort()).toEqual(['centerFace', 'upFace']);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('exposes a six-face logical cross without renderer coordinates or duplicate metadata', () => {
    const layout = createCube2DLayout(new CubeOrientation(), 3);
    const firstCell = layout.cells[0];
    const allPointIds = layout.cells.flatMap((cell) => cell.pointIds.flat());

    expect(Object.keys(layout).sort()).toEqual(['cells', 'orientation', 'rows', 'size']);
    expect(Object.keys(firstCell).sort()).toEqual(
      ['column', 'face', 'isCentral', 'pointIds', 'rotation', 'row'].sort(),
    );
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows.every((row) => row.length === 4)).toBe(true);
    expect(layout.rows.flat().filter((slot) => slot === null)).toHaveLength(6);
    expect(layout.cells).toHaveLength(6);
    expect(new Set(layout.cells.map((cell) => cell.face)).size).toBe(6);
    expect(new Set(allPointIds).size).toBe(allPointIds.length);
    expect(allPointIds.every((pointId) => typeof pointId === 'string')).toBe(true);
    expect(() => JSON.stringify(layout.rows)).not.toThrow();
  });
});
