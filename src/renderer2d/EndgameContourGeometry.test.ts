import { describe, expect, it } from 'vitest';
import {
  buildEndgameContourPath,
  endgameContourStrokeWidth,
} from './EndgameContourGeometry';

const lattice = Object.freeze({ originX: 0, originY: 0, spacing: 100 });

describe('analytic endgame contour geometry', () => {
  it('turns one grid point into one exact circular contour', () => {
    expect(buildEndgameContourPath([{ column: 0, row: 0 }], lattice)).toBe(
      'M 0 -50 A 50 50 0 0 1 50 0 A 50 50 0 0 1 0 50 A 50 50 0 0 1 -50 0 A 50 50 0 0 1 0 -50 Z',
    );
  });

  it('turns a straight run into a stadium with straight tangent sections', () => {
    const path = buildEndgameContourPath(
      [
        { column: 0, row: 0 },
        { column: 1, row: 0 },
      ],
      lattice,
    );

    expect(path).toContain('M 0 -50 L 100 -50');
    expect(path).toContain('L 0 50');
    expect(path.match(/A 50 50/g)).toHaveLength(4);
  });

  it('uses the same exact midline for independently built neighboring regions', () => {
    const upper = buildEndgameContourPath(
      [
        { column: 0, row: 0 },
        { column: 1, row: 0 },
      ],
      lattice,
    );
    const lower = buildEndgameContourPath(
      [
        { column: 0, row: 1 },
        { column: 1, row: 1 },
      ],
      lattice,
    );

    expect(upper).toContain('L 0 50');
    expect(lower).toContain('M 0 50 L 100 50');
  });

  it('rounds convex and concave turns with true quarter-circle arcs', () => {
    const path = buildEndgameContourPath(
      [
        { column: 0, row: 0 },
        { column: 1, row: 0 },
        { column: 0, row: 1 },
      ],
      lattice,
    );

    expect(path).toContain('A 50 50 0 0 1');
    expect(path).toContain('A 50 50 0 0 0');
  });

  it('keeps diagonal-only regions as separate closed contours', () => {
    const path = buildEndgameContourPath(
      [
        { column: 0, row: 0 },
        { column: 1, row: 1 },
      ],
      lattice,
    );

    expect(path.match(/M /g)).toHaveLength(2);
    expect(path.match(/ Z/g)).toHaveLength(2);
  });

  it('sets stroke width so its inner edge is exactly tangent to a stone', () => {
    const spacing = 100;
    const stoneRadius = 42;
    const strokeWidth = endgameContourStrokeWidth(spacing, stoneRadius);

    expect(strokeWidth).toBe(16);
    expect(spacing / 2 - strokeWidth / 2).toBe(stoneRadius);
  });
});
