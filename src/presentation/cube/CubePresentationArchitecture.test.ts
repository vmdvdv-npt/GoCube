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

  it('exposes layout data without screen coordinates or game-state objects', () => {
    const layout = createCube2DLayout(new CubeOrientation(), 3);
    const firstCell = layout.cells[0];

    expect(Object.keys(layout).sort()).toEqual(['cells', 'orientation', 'rows', 'size']);
    expect(Object.keys(firstCell).sort()).toEqual(
      ['column', 'face', 'isCentral', 'isDuplicate', 'pointIds', 'rotation', 'row'].sort(),
    );
    expect(layout.cells.flatMap((cell) => cell.pointIds.flat()).every((pointId) => typeof pointId === 'string')).toBe(true);
    expect(() => JSON.stringify(layout.cells)).not.toThrow();
  });
});
