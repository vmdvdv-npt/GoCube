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
  createCube2DRenderModel,
  type Cube2DVisualBoard,
} from './Cube2DRenderer';

const pointAt = (board: Cube2DVisualBoard, row: number, column: number): string =>
  board.pointRows[row][column].pointId;

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

describe('Cube2DRenderer render model', () => {
  it('renders exactly 12 boards and keeps the required central board at row 1, column 1', () => {
    const orientation = new CubeOrientation();
    const layout = createCube2DLayout(orientation, 4);
    const model = createCube2DRenderModel(layout);
    const centralBoards = model.boards.filter((board) => board.isCentral);

    expect(model.boards).toHaveLength(12);
    expect(centralBoards).toHaveLength(1);
    expect(centralBoards[0].row).toBe(1);
    expect(centralBoards[0].column).toBe(1);
    expect(centralBoards[0].face).toBe(orientation.centerFace);
  });

  it('copies face, rotation, duplicate flags and point mapping directly from Cube2DLayout', () => {
    const layout = createCube2DLayout(new CubeOrientation().moveUp().moveRight(), 5);
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
        isDuplicate: board.isDuplicate,
      }).toEqual({
        row: cell.row,
        column: cell.column,
        face: cell.face,
        rotation: cell.rotation,
        isCentral: cell.isCentral,
        isDuplicate: cell.isDuplicate,
      });

      expect(
        board.pointRows.map((row) => row.map((point) => point.pointId)),
      ).toEqual(cell.pointIds);
    }
  });

  it.each(CUBE_SIZES)('uses only existing logical pointIds on %dx%d', (size: CubeSize) => {
    const topology = new CubeTopology(size);
    const model = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), size));
    const visualPointIds = model.boards.flatMap((board) => board.points.map((point) => point.pointId));

    expect(visualPointIds.every((pointId) => topology.has(pointId))).toBe(true);
    expect(new Set(visualPointIds).size).toBe(6 * size * size);
    expect(topology.points()).toHaveLength(6 * size * size);
  });

  it.each(CUBE_SIZES)('does not create new logical points for duplicate boards on %dx%d', (size: CubeSize) => {
    const model = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), size));

    for (const face of CUBE_FACES) {
      const copies = model.boards.filter((board) => board.face === face);
      const expected = new Set(
        Array.from({ length: size * size }, (_, index) =>
          cubePointId(face, Math.floor(index / size), index % size),
        ),
      );

      for (const copy of copies) {
        expect(new Set(copy.points.map((point) => point.pointId))).toEqual(expected);
      }
    }
  });

  it('keeps the same logical face set while rotations change visual row/column mapping', () => {
    const size = 4;
    const model = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), size));
    const copies = model.boards.filter((board) => board.face === 'top');
    const targetPoint = cubePointId('top', 0, 0);
    const expectedLocation: Readonly<Record<CubeRotation, readonly [number, number]>> = {
      0: [0, 0],
      90: [0, size - 1],
      180: [size - 1, size - 1],
      270: [size - 1, 0],
    };

    expect(copies).toHaveLength(4);
    expect(new Set(copies.map((copy) => copy.rotation))).toEqual(new Set([0, 90, 180, 270]));

    for (const copy of copies) {
      expect(new Set(copy.points.map((point) => point.pointId))).toEqual(
        new Set(copies[0].points.map((point) => point.pointId)),
      );
      const visualPoint = copy.points.find((point) => point.pointId === targetPoint);
      expect(visualPoint).toBeDefined();
      expect([visualPoint!.row, visualPoint!.column]).toEqual(expectedLocation[copy.rotation]);
    }
  });

  it('preserves CubeTopology adjacency across visible horizontal and vertical seams', () => {
    const topology = new CubeTopology(4);
    const model = createCube2DRenderModel(createCube2DLayout(new CubeOrientation(), 4));
    const boardAt = (row: number, column: number) =>
      model.boards.find((board) => board.row === row && board.column === column)!;
    const last = topology.size - 1;

    for (let column = 0; column < 3; column += 1) {
      const left = boardAt(1, column);
      const right = boardAt(1, column + 1);
      expectSeam(
        topology,
        Array.from({ length: topology.size }, (_, row) => pointAt(left, row, last)),
        Array.from({ length: topology.size }, (_, row) => pointAt(right, row, 0)),
      );
    }

    for (let column = 0; column < 4; column += 1) {
      const top = boardAt(0, column);
      const middle = boardAt(1, column);
      const bottom = boardAt(2, column);

      expectSeam(
        topology,
        Array.from({ length: topology.size }, (_, col) => pointAt(top, last, col)),
        Array.from({ length: topology.size }, (_, col) => pointAt(middle, 0, col)),
      );
      expectSeam(
        topology,
        Array.from({ length: topology.size }, (_, col) => pointAt(middle, last, col)),
        Array.from({ length: topology.size }, (_, col) => pointAt(bottom, 0, col)),
      );
    }
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
