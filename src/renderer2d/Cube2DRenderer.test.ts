import { describe, expect, it } from 'vitest';
import {
  CUBE_FACES,
  CUBE_SIZES,
  CubeTopology,
  cubePointId,
  type CubeSize,
} from '../core/topology/CubeTopology';
import { createCube2DLayout } from '../presentation/cube/Cube2DLayout';
import { CubeOrientation, type CubeRotation } from '../presentation/cube/CubeOrientation';
import {
  CUBE_2D_SVG_SIZE,
  createCube2DRenderModel,
  type Cube2DVisualBoard,
} from './Cube2DRenderer';

const pointAt = (board: Cube2DVisualBoard, row: number, column: number): string =>
  board.pointRows[row][column].pointId;

const boardAt = (
  boards: readonly Cube2DVisualBoard[],
  row: number,
  column: number,
): Cube2DVisualBoard => {
  const board = boards.find((candidate) => candidate.row === row && candidate.column === column);
  if (!board) throw new Error(`Expected occupied Cube 2D slot at ${row}:${column}`);
  return board;
};

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

const allOrientations = (): readonly CubeOrientation[] => {
  const queue = [new CubeOrientation()];
  const result = new Map<string, CubeOrientation>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.centerFace}:${current.upFace}`;
    if (result.has(key)) continue;
    result.set(key, current);
    queue.push(current.moveLeft(), current.moveRight(), current.moveUp(), current.moveDown());
  }

  return [...result.values()];
};

describe('Cube2DRenderer render model', () => {
  it('renders exactly six physical boards inside the fixed 4x3 placement field', () => {
    const orientation = new CubeOrientation();
    const layout = createCube2DLayout(orientation, 4);
    const model = createCube2DRenderModel(layout);
    const centralBoards = model.boards.filter((board) => board.isCentral);

    expect(model.rows).toBe(3);
    expect(model.columns).toBe(4);
    expect(model.boards).toHaveLength(6);
    expect(centralBoards).toHaveLength(1);
    expect(centralBoards[0].row).toBe(1);
    expect(centralBoards[0].column).toBe(1);
    expect(centralBoards[0].face).toBe(orientation.centerFace);

    expect(model.boards.map((board) => [board.row, board.column])).toEqual([
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
    ]);
  });

  it('copies face, rotation, central status and point mapping directly from Cube2DLayout', () => {
    const layout = createCube2DLayout(new CubeOrientation().moveUp().moveRight(), 5, 3);
    const model = createCube2DRenderModel(layout);

    expect(model.boards).toHaveLength(layout.cells.length);

    for (let index = 0; index < layout.cells.length; index += 1) {
      const cell = layout.cells[index];
      const board = model.boards[index];

      expect({
        row: board.row,
        column: board.column,
        face: board.face,
        rotation: board.rotation,
        isCentral: board.isCentral,
      }).toEqual({
        row: cell.row,
        column: cell.column,
        face: cell.face,
        rotation: cell.rotation,
        isCentral: cell.isCentral,
      });
      expect(Object.keys(board)).not.toContain('isDuplicate');
      expect(board.pointRows.map((row) => row.map((point) => point.pointId))).toEqual(cell.pointIds);
    }
  });

  it.each(CUBE_SIZES)('renders every logical CubeTopology point exactly once on %dx%d', (size: CubeSize) => {
    const topology = new CubeTopology(size);

    for (const anchor of [0, 1, 2, 3] as const) {
      const model = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), size, anchor));
      const visualPointIds = model.boards.flatMap((board) => board.points.map((point) => point.pointId));

      expect(visualPointIds).toHaveLength(6 * size * size);
      expect(visualPointIds.every((pointId) => topology.has(pointId))).toBe(true);
      expect(new Set(visualPointIds).size).toBe(6 * size * size);
      expect(new Set(visualPointIds)).toEqual(new Set(topology.points()));
    }
  });

  it('renders every physical cube face once and only once', () => {
    for (const anchor of [0, 1, 2, 3] as const) {
      const model = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), 4, anchor));

      expect(model.boards).toHaveLength(CUBE_FACES.length);
      expect(new Set(model.boards.map((board) => board.face))).toEqual(new Set(CUBE_FACES));
      for (const face of CUBE_FACES) {
        expect(model.boards.filter((board) => board.face === face)).toHaveLength(1);
      }
    }
  });

  it('uses layout rotation to change visual row/column mapping for 0, 90, 180 and 270 degrees', () => {
    const size = 4;
    const targetPoint = cubePointId('front', 0, 0);
    const cases: readonly [CubeOrientation, CubeRotation, readonly [number, number]][] = [
      [new CubeOrientation({ centerFace: 'front', upFace: 'top' }), 0, [0, 0]],
      [new CubeOrientation({ centerFace: 'front', upFace: 'left' }), 90, [0, size - 1]],
      [new CubeOrientation({ centerFace: 'front', upFace: 'bottom' }), 180, [size - 1, size - 1]],
      [new CubeOrientation({ centerFace: 'front', upFace: 'right' }), 270, [size - 1, 0]],
    ];

    for (const [orientation, rotation, expectedLocation] of cases) {
      const model = createCube2DRenderModel(createCube2DLayout(orientation, size));
      const central = model.boards.find((board) => board.isCentral)!;
      const visualPoint = central.points.find((point) => point.pointId === targetPoint);

      expect(central.face).toBe('front');
      expect(central.rotation).toBe(rotation);
      expect(visualPoint).toBeDefined();
      expect([visualPoint!.row, visualPoint!.column]).toEqual(expectedLocation);
    }
  });

  it('preserves CubeTopology adjacency at every visible seam for all orientations, sizes and anchors', () => {
    const orientations = allOrientations();
    expect(orientations).toHaveLength(24);

    for (const size of CUBE_SIZES) {
      const topology = new CubeTopology(size);
      const last = size - 1;

      for (const orientation of orientations) {
        for (const anchor of [0, 1, 2, 3] as const) {
          const model = createCube2DRenderModel(createCube2DLayout(orientation, size, anchor));
          const sideRing = [
            boardAt(model.boards, 1, 0),
            boardAt(model.boards, 1, 1),
            boardAt(model.boards, 1, 2),
            boardAt(model.boards, 1, 3),
          ] as const;
          const top = boardAt(model.boards, 0, anchor);
          const bottom = boardAt(model.boards, 2, anchor);
          const anchoredSide = sideRing[anchor];

          for (let column = 0; column < 3; column += 1) {
            const first = sideRing[column];
            const second = sideRing[column + 1];
            expectSeam(
              topology,
              Array.from({ length: size }, (_, row) => pointAt(first, row, last)),
              Array.from({ length: size }, (_, row) => pointAt(second, row, 0)),
            );
          }

          expectSeam(
            topology,
            Array.from({ length: size }, (_, column) => pointAt(top, last, column)),
            Array.from({ length: size }, (_, column) => pointAt(anchoredSide, 0, column)),
          );
          expectSeam(
            topology,
            Array.from({ length: size }, (_, column) => pointAt(anchoredSide, last, column)),
            Array.from({ length: size }, (_, column) => pointAt(bottom, 0, column)),
          );
        }
      }
    }
  });

  it.each(CUBE_SIZES)('keeps point spacing uniform across face boundaries on %dx%d', (size: CubeSize) => {
    const model = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), size));
    const central = model.boards.find((board) => board.isCentral)!;
    const xs = central.pointRows[0].map((point) => point.x);
    const ys = central.pointRows.map((row) => row[0].y);
    const horizontalStep = xs[1] - xs[0];
    const verticalStep = ys[1] - ys[0];
    const horizontalSeamDistance = CUBE_2D_SVG_SIZE - xs[xs.length - 1] + xs[0];
    const verticalSeamDistance = CUBE_2D_SVG_SIZE - ys[ys.length - 1] + ys[0];

    expect(horizontalSeamDistance).toBeCloseTo(horizontalStep, 8);
    expect(verticalSeamDistance).toBeCloseTo(verticalStep, 8);
  });

  it('rebuilds from a new orientation without mutating the previous orientation', () => {
    const initialOrientation = new CubeOrientation();
    const movedOrientation = initialOrientation.moveRight();
    const initialModel = createCube2DRenderModel(createCube2DLayout(initialOrientation, 3));
    const movedModel = createCube2DRenderModel(createCube2DLayout(movedOrientation, 3));
    const initialCentral = initialModel.boards.find((board) => board.isCentral)!;
    const movedCentral = movedModel.boards.find((board) => board.isCentral)!;

    expect(initialOrientation.centerFace).toBe('front');
    expect(initialCentral.face).toBe('front');
    expect(movedCentral.face).toBe(movedOrientation.centerFace);
    expect(movedCentral.face).toBe('right');
    expect(movedCentral.face).not.toBe(initialCentral.face);
  });
});
