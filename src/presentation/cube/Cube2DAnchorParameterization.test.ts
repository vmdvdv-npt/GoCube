import { describe, expect, it } from 'vitest';
import { CUBE_FACES, CubeTopology } from '../../core/topology/CubeTopology';
import { createCube2DLayout } from './Cube2DLayout';
import {
  createCube2DViewState,
  setCube2DVerticalAnchorColumn,
} from './Cube2DNavigation';

describe.each([8, 10] as const)('Cube 2D movable anchor on technical %dx%d', (size) => {
  it.each([0, 1, 2, 3] as const)(
    'keeps six unique physical faces and 6×N×N unique points in anchor column %d',
    (column) => {
      const topology = new CubeTopology(size);
      const view = setCube2DVerticalAnchorColumn(createCube2DViewState(), column);
      const layout = createCube2DLayout(
        view.orientation,
        size,
        view.verticalAnchorColumn,
      );
      const visualPoints = layout.cells.flatMap((cell) => cell.pointIds.flat());

      expect(layout.verticalAnchorColumn).toBe(column);
      expect(layout.cells).toHaveLength(6);
      expect(layout.rows.flat().filter((slot) => slot === null)).toHaveLength(6);
      expect(layout.rows[0][column]).not.toBeNull();
      expect(layout.rows[2][column]).not.toBeNull();
      expect(layout.rows[1].every((slot) => slot !== null)).toBe(true);
      expect(new Set(layout.cells.map((cell) => cell.face))).toEqual(new Set(CUBE_FACES));
      expect(visualPoints).toHaveLength(6 * size * size);
      expect(new Set(visualPoints).size).toBe(6 * size * size);
      expect(new Set(visualPoints)).toEqual(new Set(topology.points()));

      for (const otherColumn of [0, 1, 2, 3] as const) {
        if (otherColumn === column) continue;
        expect(layout.rows[0][otherColumn]).toBeNull();
        expect(layout.rows[2][otherColumn]).toBeNull();
      }
    },
  );
});
