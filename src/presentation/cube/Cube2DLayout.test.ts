import { describe, expect, it } from 'vitest';
import {
  CUBE_FACES,
  CUBE_SIZES,
  CubeTopology,
  cubePointId,
  type CubeSize,
} from '../../core/topology/CubeTopology';
import {
  CUBE_2D_CENTER,
  createCube2DLayout,
  type Cube2DLayoutCell,
} from './Cube2DLayout';
import { CubeOrientation } from './CubeOrientation';

const flattenPoints = (cell: Cube2DLayoutCell): readonly string[] => cell.pointIds.flat();

const expectSeam = (
  topology: CubeTopology,
  first: readonly string[],
  second: readonly string[],
) => {
  expect(first).toHaveLength(second.length);
  for (let index = 0; index < first.length; index += 1) {
    expect(topology.neighbors(first[index])).toContain(second[index]);
  }
};

describe('Cube 2D logical 4x3 layout', () => {
  it('uses the required second-column, second-row central position', () => {
    const layout = createCube2DLayout(new CubeOrientation(), 3);
    const central = layout.rows[CUBE_2D_CENTER.row][CUBE_2D_CENTER.column];

    expect(CUBE_2D_CENTER).toEqual({ row: 1, column: 1 });
    expect(central.isCentral).toBe(true);
    expect(central.face).toBe('front');
    expect(central.rotation).toBe(0);
    expect(layout.cells.filter((cell) => cell.isCentral)).toHaveLength(1);
  });

  it('builds the canonical 4x3 gallery with explicit rotations and six visual duplicates', () => {
    const layout = createCube2DLayout(new CubeOrientation(), 3);

    expect(
      layout.rows.map((row) =>
        row.map((cell) => ({
          face: cell.face,
          rotation: cell.rotation,
          duplicate: cell.isDuplicate,
        })),
      ),
    ).toEqual([
      [
        { face: 'top', rotation: 270, duplicate: true },
        { face: 'top', rotation: 0, duplicate: false },
        { face: 'top', rotation: 90, duplicate: true },
        { face: 'top', rotation: 180, duplicate: true },
      ],
      [
        { face: 'left', rotation: 0, duplicate: false },
        { face: 'front', rotation: 0, duplicate: false },
        { face: 'right', rotation: 0, duplicate: false },
        { face: 'back', rotation: 0, duplicate: false },
      ],
      [
        { face: 'bottom', rotation: 90, duplicate: true },
        { face: 'bottom', rotation: 0, duplicate: false },
        { face: 'bottom', rotation: 270, duplicate: true },
        { face: 'bottom', rotation: 180, duplicate: true },
      ],
    ]);

    expect(layout.cells).toHaveLength(12);
    expect(layout.cells.filter((cell) => cell.isDuplicate)).toHaveLength(6);

    const primaryFaces = layout.cells.filter((cell) => !cell.isDuplicate).map((cell) => cell.face);
    expect(new Set(primaryFaces)).toEqual(new Set(CUBE_FACES));
    expect(primaryFaces).toHaveLength(6);
  });

  it.each(CUBE_SIZES)('maps every visual point copy to an existing logical point on %dx%d', (size: CubeSize) => {
    const topology = new CubeTopology(size);
    const layout = createCube2DLayout(new CubeOrientation(), size);

    for (const cell of layout.cells) {
      const points = flattenPoints(cell);
      expect(points).toHaveLength(size * size);
      expect(new Set(points).size).toBe(size * size);
      expect(points.every((point) => topology.has(point))).toBe(true);
      expect(points.every((point) => point.startsWith(`${cell.face}:`))).toBe(true);
    }
  });

  it.each(CUBE_SIZES)('keeps every duplicate face copy bound to the same logical pointIds on %dx%d', (size: CubeSize) => {
    const layout = createCube2DLayout(new CubeOrientation(), size);

    for (const face of CUBE_FACES) {
      const copies = layout.cells.filter((cell) => cell.face === face);
      const expected = new Set(
        Array.from({ length: size * size }, (_, index) =>
          cubePointId(face, Math.floor(index / size), index % size),
        ),
      );

      for (const copy of copies) {
        expect(new Set(flattenPoints(copy))).toEqual(expected);
      }
    }
  });

  it('uses CubeTopology-compatible rotations at every visible central-row and vertical seam', () => {
    const topology = new CubeTopology(3);
    const layout = createCube2DLayout(new CubeOrientation(), 3);
    const last = topology.size - 1;

    for (let column = 0; column < 3; column += 1) {
      const left = layout.rows[1][column];
      const right = layout.rows[1][column + 1];
      expectSeam(
        topology,
        left.pointIds.map((row) => row[last]),
        right.pointIds.map((row) => row[0]),
      );
    }

    for (let column = 0; column < 4; column += 1) {
      const top = layout.rows[0][column];
      const middle = layout.rows[1][column];
      const bottom = layout.rows[2][column];

      expectSeam(topology, top.pointIds[last], middle.pointIds[0]);
      expectSeam(topology, middle.pointIds[last], bottom.pointIds[0]);
    }
  });

  it('rebuilds the same logical gallery around the new exact orientation after navigation', () => {
    const starts = [
      new CubeOrientation().moveRight(),
      new CubeOrientation().moveLeft(),
      new CubeOrientation().moveUp(),
      new CubeOrientation().moveDown(),
      new CubeOrientation().moveRight().moveUp().moveLeft(),
    ];

    for (const orientation of starts) {
      const layout = createCube2DLayout(orientation, 4);
      const central = layout.rows[1][1];

      expect(central.face).toBe(orientation.centerFace);
      expect(central.rotation).toBe(orientation.rotation);
      expect(layout.cells.filter((cell) => !cell.isDuplicate).map((cell) => cell.face)).toHaveLength(6);
      expect(new Set(layout.cells.filter((cell) => !cell.isDuplicate).map((cell) => cell.face))).toEqual(
        new Set(CUBE_FACES),
      );
    }
  });
});
