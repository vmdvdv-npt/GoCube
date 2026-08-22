import { describe, expect, it } from 'vitest';
import type { StoneColor } from '../core/game/types';
import { CubeOrientation } from '../presentation/cube/CubeOrientation';
import { createCube2DLayout } from '../presentation/cube/Cube2DLayout';
import {
  CUBE_2D_CAPTURE_STAGGER_MS,
  buildCube2DCaptureEffects,
  type Cube2DCaptureSource,
} from '../presentation/cube/Cube2DVisualEffectsModel';
import {
  CUBE_2D_BASE_CELL_SIZE,
  CUBE_2D_STAGE_WIDTH,
  createCube2DStagePointMap,
} from './Cube2DRenderer';

const sourceFrom = (
  layout: ReturnType<typeof createCube2DLayout>,
  pointId: string,
  color: StoneColor,
): Cube2DCaptureSource => {
  const geometry = createCube2DStagePointMap(layout).get(pointId);
  if (!geometry) throw new Error(`Missing stage geometry for ${pointId}`);
  return Object.freeze({ ...geometry, color });
};

describe('Cube2D captured stone animation', () => {
  it('flies white left and black right with 150 ms stagger', () => {
    const layout = createCube2DLayout(new CubeOrientation(), 4, 1);
    const points = [...createCube2DStagePointMap(layout).keys()];
    const white = sourceFrom(layout, points[0]!, 'white');
    const black = sourceFrom(layout, points[1]!, 'black');
    const third = sourceFrom(layout, points[2]!, 'white');

    const effects = buildCube2DCaptureEffects({
      generation: 1,
      capturedPointIds: [white.pointId, black.pointId, third.pointId],
      previousSources: new Map([
        [white.pointId, white],
        [black.pointId, black],
        [third.pointId, third],
      ]),
      stageWidth: CUBE_2D_STAGE_WIDTH,
    });

    expect(effects.map((effect) => effect.delayMs)).toEqual([
      0,
      CUBE_2D_CAPTURE_STAGGER_MS,
      CUBE_2D_CAPTURE_STAGGER_MS * 2,
    ]);
    expect(effects[0]!.targetStageX).toBeLessThan(0);
    expect(effects[1]!.targetStageX).toBeGreaterThan(CUBE_2D_STAGE_WIDTH);
    expect(effects.every((effect) => effect.targetStageY < effect.stageY)).toBe(true);
  });

  it('uses the previous rendered layout even when navigation changes the next layout', () => {
    const before = createCube2DLayout(new CubeOrientation(), 4, 1);
    const after = createCube2DLayout(new CubeOrientation().moveLeft(), 4, 1);
    const beforeGeometry = createCube2DStagePointMap(before);
    const afterGeometry = createCube2DStagePointMap(after);
    const changedPointId = [...beforeGeometry.keys()].find((pointId) => {
      const first = beforeGeometry.get(pointId)!;
      const second = afterGeometry.get(pointId)!;
      return first.stageX !== second.stageX || first.stageY !== second.stageY;
    });
    if (!changedPointId) throw new Error('Expected navigation to move at least one physical point');

    const source = sourceFrom(before, changedPointId, 'white');
    const [effect] = buildCube2DCaptureEffects({
      generation: 2,
      capturedPointIds: [changedPointId],
      previousSources: new Map([[changedPointId, source]]),
      stageWidth: CUBE_2D_STAGE_WIDTH,
    });
    const nextPosition = afterGeometry.get(changedPointId)!;

    expect(effect!.stageX).toBe(source.stageX);
    expect(effect!.stageY).toBe(source.stageY);
    expect([effect!.stageX, effect!.stageY]).not.toEqual([
      nextPosition.stageX,
      nextPosition.stageY,
    ]);
  });

  it('preserves the pre-navigation capture source after left, right, up and down', () => {
    const before = createCube2DLayout(new CubeOrientation(), 4, 2);
    const beforeGeometry = createCube2DStagePointMap(before);
    const nextOrientations = [
      ['left', new CubeOrientation().moveLeft()],
      ['right', new CubeOrientation().moveRight()],
      ['up', new CubeOrientation().moveUp()],
      ['down', new CubeOrientation().moveDown()],
    ] as const;

    for (const [direction, orientation] of nextOrientations) {
      const after = createCube2DLayout(orientation, 4, 2);
      const afterGeometry = createCube2DStagePointMap(after);
      const changedPointId = [...beforeGeometry.keys()].find((pointId) => {
        const first = beforeGeometry.get(pointId)!;
        const second = afterGeometry.get(pointId)!;
        return first.stageX !== second.stageX || first.stageY !== second.stageY;
      });
      if (!changedPointId) throw new Error(`Expected ${direction} navigation to move a point`);

      const source = sourceFrom(before, changedPointId, 'black');
      const [effect] = buildCube2DCaptureEffects({
        generation: 20,
        capturedPointIds: [changedPointId],
        previousSources: new Map([[changedPointId, source]]),
        stageWidth: CUBE_2D_STAGE_WIDTH,
      });
      const nextPosition = afterGeometry.get(changedPointId)!;

      expect(effect!.stageX, direction).toBe(source.stageX);
      expect(effect!.stageY, direction).toBe(source.stageY);
      expect([effect!.stageX, effect!.stageY], direction).not.toEqual([
        nextPosition.stageX,
        nextPosition.stageY,
      ]);
    }
  });

  it('tracks vertical anchor columns 0, 1, 2 and 3 in stage geometry', () => {
    for (const anchor of [0, 1, 2, 3] as const) {
      const layout = createCube2DLayout(new CubeOrientation(), 4, anchor);
      const top = layout.cells.find((cell) => cell.row === 0);
      if (!top) throw new Error('Expected top Cube face');
      const pointId = top.pointIds[0]![0]!;
      const geometry = createCube2DStagePointMap(layout).get(pointId)!;

      expect(geometry.layoutColumn).toBe(anchor);
      expect(geometry.layoutRow).toBe(0);
      expect(geometry.stageX).toBeCloseTo(anchor * 100 + geometry.localX, 10);
    }
  });

  it.each([2, 7] as const)('keeps one exact stage source for every point on %dx%d', (size) => {
    const layout = createCube2DLayout(new CubeOrientation().moveUp().moveRight(), size, 3);
    const geometry = createCube2DStagePointMap(layout);

    expect(geometry.size).toBe(6 * size * size);
    expect(new Set(geometry.keys()).size).toBe(6 * size * size);
    for (const point of geometry.values()) {
      expect(point.stageX).toBeGreaterThanOrEqual(0);
      expect(point.stageX).toBeLessThanOrEqual(400);
      expect(point.stageY).toBeGreaterThanOrEqual(0);
      expect(point.stageY).toBeLessThanOrEqual(300);
      expect(point.radius).toBeGreaterThan(0);
    }
  });

  it('maps normal-board and capture-layer centers to the same CSS pixel at every Cube zoom', () => {
    const layout = createCube2DLayout(new CubeOrientation().moveDown(), 7, 2);
    const geometry = [...createCube2DStagePointMap(layout).values()][17]!;

    for (const zoom of [0.78, 1, 1.35]) {
      const cellSize = CUBE_2D_BASE_CELL_SIZE * zoom;
      const normalX = geometry.layoutColumn * cellSize + (geometry.localX / 100) * cellSize;
      const normalY = geometry.layoutRow * cellSize + (geometry.localY / 100) * cellSize;
      const captureX = (geometry.stageX / 400) * (4 * cellSize);
      const captureY = (geometry.stageY / 300) * (3 * cellSize);

      expect(captureX).toBeCloseTo(normalX, 10);
      expect(captureY).toBeCloseTo(normalY, 10);
    }
  });

  it('creates exactly one flight for each captured PointId, including points on different faces', () => {
    const layout = createCube2DLayout(new CubeOrientation(), 4, 1);
    const geometry = [...createCube2DStagePointMap(layout).values()];
    const first = geometry[0]!;
    const acrossFace = geometry.find((candidate) => candidate.face !== first.face)!;
    const firstSource = sourceFrom(layout, first.pointId, 'white');
    const secondSource = sourceFrom(layout, acrossFace.pointId, 'white');

    const effects = buildCube2DCaptureEffects({
      generation: 3,
      capturedPointIds: [first.pointId, first.pointId, acrossFace.pointId],
      previousSources: new Map([
        [first.pointId, firstSource],
        [acrossFace.pointId, secondSource],
      ]),
      stageWidth: CUBE_2D_STAGE_WIDTH,
    });

    expect(effects).toHaveLength(2);
    expect(new Set(effects.map((effect) => effect.pointId))).toEqual(
      new Set([first.pointId, acrossFace.pointId]),
    );
    expect(effects[0]!.stageX).toBe(firstSource.stageX);
    expect(effects[1]!.stageX).toBe(secondSource.stageX);
  });
});
