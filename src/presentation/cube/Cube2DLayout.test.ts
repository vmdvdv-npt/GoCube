import { describe, expect, it } from 'vitest';
import {
  CUBE_FACES,
  CubeTopology,
  cubePointId,
  type CubeSize,
} from '../../core/topology/CubeTopology';
import {
  CUBE_2D_CENTER,
  createCube2DLayout,
  type Cube2DLayoutCell,
} from './Cube2DLayout';
import { CubeOrientation, oppositeCubeFace } from './CubeOrientation';

const CUBE_LAYOUT_CONTRACT_SIZES = [2, 3, 4, 5, 6, 7, 8, 10] as const satisfies readonly CubeSize[];

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

const allOrientations = (): readonly CubeOrientation[] =>
  CUBE_FACES.flatMap((centerFace) =>
    CUBE_FACES.filter(
      (upFace) => upFace !== centerFace && upFace !== oppositeCubeFace(centerFace),
    ).map((upFace) => new CubeOrientation({ centerFace, upFace })),
  );

const requireCell = (cell: Cube2DLayoutCell | null): Cube2DLayoutCell => {
  expect(cell).not.toBeNull();
  if (!cell) throw new Error('Expected occupied Cube 2D layout slot');
  return cell;
};

describe('Cube 2D logical 4x3 placement field', () => {
  it('uses the required second-column, second-row central position', () => {
    const layout = createCube2DLayout(new CubeOrientation(), 3);
    const central = requireCell(layout.rows[CUBE_2D_CENTER.row][CUBE_2D_CENTER.column]);

    expect(CUBE_2D_CENTER).toEqual({ row: 1, column: 1 });
    expect(layout.verticalAnchorColumn).toBe(1);
    expect(central.isCentral).toBe(true);
    expect(central.face).toBe('front');
    expect(central.rotation).toBe(0);
    expect(layout.cells.filter((cell) => cell.isCentral)).toHaveLength(1);
  });

  it('builds the default six-face cross with no duplicates', () => {
    const layout = createCube2DLayout(new CubeOrientation(), 3);

    expect(
      layout.rows.map((row) =>
        row.map((cell) =>
          cell
            ? {
                face: cell.face,
                rotation: cell.rotation,
                central: cell.isCentral,
              }
            : null,
        ),
      ),
    ).toEqual([
      [null, { face: 'top', rotation: 0, central: false }, null, null],
      [
        { face: 'left', rotation: 0, central: false },
        { face: 'front', rotation: 0, central: true },
        { face: 'right', rotation: 0, central: false },
        { face: 'back', rotation: 0, central: false },
      ],
      [null, { face: 'bottom', rotation: 0, central: false }, null, null],
    ]);

    expect(layout.rows).toHaveLength(3);
    expect(layout.rows.every((row) => row.length === 4)).toBe(true);
    expect(layout.rows.flat().filter((cell) => cell === null)).toHaveLength(6);
    expect(layout.cells).toHaveLength(6);
    expect(new Set(layout.cells.map((cell) => cell.face))).toEqual(new Set(CUBE_FACES));
    expect(layout.cells.every((cell) => !('isDuplicate' in cell))).toBe(true);
  });

  it('moves the same physical TOP/BOTTOM faces to every column with seam-correct rotations', () => {
    const orientation = new CubeOrientation();
    const expected = [
      { column: 0, topRotation: 270, bottomRotation: 90 },
      { column: 1, topRotation: 0, bottomRotation: 0 },
      { column: 2, topRotation: 90, bottomRotation: 270 },
      { column: 3, topRotation: 180, bottomRotation: 180 },
    ] as const;

    for (const { column, topRotation, bottomRotation } of expected) {
      const layout = createCube2DLayout(orientation, 4, column);
      const top = requireCell(layout.rows[0][column]);
      const bottom = requireCell(layout.rows[2][column]);

      expect(layout.verticalAnchorColumn).toBe(column);
      expect(top.face).toBe('top');
      expect(bottom.face).toBe('bottom');
      expect(top.rotation).toBe(topRotation);
      expect(bottom.rotation).toBe(bottomRotation);
      expect(top.column).toBe(column);
      expect(bottom.column).toBe(column);
      expect(layout.rows[0].filter(Boolean)).toHaveLength(1);
      expect(layout.rows[2].filter(Boolean)).toHaveLength(1);
    }
  });

  it.each(CUBE_LAYOUT_CONTRACT_SIZES)(
    'maps exactly the six cube faces with no repeated logical points on %dx%d',
    (size) => {
      const topology = new CubeTopology(size);

      for (const anchor of [0, 1, 2, 3] as const) {
        const layout = createCube2DLayout(new CubeOrientation(), size, anchor);
        const visualPoints = layout.cells.flatMap((cell) => flattenPoints(cell));

        expect(layout.cells).toHaveLength(6);
        expect(visualPoints).toHaveLength(6 * size * size);
        expect(new Set(visualPoints).size).toBe(6 * size * size);
        expect(new Set(visualPoints)).toEqual(new Set(topology.points()));

        for (const cell of layout.cells) {
          const points = flattenPoints(cell);
          expect(points).toHaveLength(size * size);
          expect(new Set(points).size).toBe(size * size);
          expect(points.every((point) => topology.has(point))).toBe(true);
          expect(points.every((point) => point.startsWith(`${cell.face}:`))).toBe(true);
        }
      }
    },
  );

  it.each(CUBE_LAYOUT_CONTRACT_SIZES)(
    'contains each physical face exactly once on %dx%d',
    (size) => {
      for (const anchor of [0, 1, 2, 3] as const) {
        const layout = createCube2DLayout(new CubeOrientation(), size, anchor);

        for (const face of CUBE_FACES) {
          const cells = layout.cells.filter((cell) => cell.face === face);
          expect(cells).toHaveLength(1);

          const expected = new Set(
            Array.from({ length: size * size }, (_, index) =>
              cubePointId(face, Math.floor(index / size), index % size),
            ),
          );
          expect(new Set(flattenPoints(cells[0]))).toEqual(expected);
        }
      }
    },
  );

  it('keeps every visible seam compatible with CubeTopology across all orientations, sizes and anchors', () => {
    const orientations = allOrientations();
    expect(orientations).toHaveLength(24);

    for (const size of CUBE_LAYOUT_CONTRACT_SIZES) {
      const topology = new CubeTopology(size);
      const last = size - 1;

      for (const orientation of orientations) {
        for (const anchor of [0, 1, 2, 3] as const) {
          const layout = createCube2DLayout(orientation, size, anchor);
          const middle = layout.rows[1].map(requireCell);
          const top = requireCell(layout.rows[0][anchor]);
          const bottom = requireCell(layout.rows[2][anchor]);
          const anchoredSide = middle[anchor];

          for (let column = 0; column < 3; column += 1) {
            const left = middle[column];
            const right = middle[column + 1];
            expectSeam(
              topology,
              left.pointIds.map((row) => row[last]),
              right.pointIds.map((row) => row[0]),
            );
          }

          expectSeam(topology, top.pointIds[last], anchoredSide.pointIds[0]);
          expectSeam(topology, anchoredSide.pointIds[last], bottom.pointIds[0]);
          expect(top.face).toBe(orientation.neighbors.top);
          expect(bottom.face).toBe(orientation.neighbors.bottom);
        }
      }
    }
  });

  it('rebuilds the six-face cross around every orientation and anchor without copies', () => {
    for (const orientation of allOrientations()) {
      for (const anchor of [0, 1, 2, 3] as const) {
        const layout = createCube2DLayout(orientation, 4, anchor);
        const central = requireCell(layout.rows[1][1]);
        const occupiedPositions = layout.cells.map(({ row, column }) => `${row}:${column}`);

        expect(central.face).toBe(orientation.centerFace);
        expect(central.rotation).toBe(orientation.rotation);
        expect(layout.cells).toHaveLength(6);
        expect(new Set(layout.cells.map((cell) => cell.face))).toEqual(new Set(CUBE_FACES));
        expect(new Set(occupiedPositions)).toEqual(
          new Set([`0:${anchor}`, '1:0', '1:1', '1:2', '1:3', `2:${anchor}`]),
        );
      }
    }
  });
});
