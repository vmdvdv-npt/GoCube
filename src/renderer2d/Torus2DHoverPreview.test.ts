import { describe, expect, it } from 'vitest';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
import {
  buildTorus2DScene,
  nearestVisualPointFromTorusViewBoxPosition,
  pointFromTorusViewBoxPosition,
} from './Torus2DRenderer';

const viewModel = (): GameViewModel => {
  const points: GameViewPoint[] = [];
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      points.push({
        logicalPointId: `${x},${y}`,
        occupancy: 'empty',
      });
    }
  }

  return {
    points,
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 0,
    phase: 'playing',
    captures: { black: 0, white: 0 },
    ruleSet: 'chinese',
    komi: 7.5,
    finalScore: null,
  };
};

describe('Torus2D hover preview hit testing', () => {
  it('snaps hover to the nearest point across gaps without changing the exact-hit helper', () => {
    const scene = buildTorus2DScene(viewModel(), 9);
    const first = scene.points[0]!;
    const betweenX = first.x + scene.spacing / 2;

    expect(pointFromTorusViewBoxPosition(scene, betweenX, first.y)).toBeNull();
    expect(
      nearestVisualPointFromTorusViewBoxPosition(scene, betweenX, first.y)?.logicalPointId,
    ).toBe('1,0');
  });

  it('keeps hover snapped across the whole board viewBox and ignores positions outside it', () => {
    const scene = buildTorus2DScene(viewModel(), 9);

    expect(nearestVisualPointFromTorusViewBoxPosition(scene, 0, 0)?.logicalPointId).toBe(
      '0,0',
    );
    expect(
      nearestVisualPointFromTorusViewBoxPosition(
        scene,
        scene.viewBoxSize,
        scene.viewBoxSize,
      )?.logicalPointId,
    ).toBe('8,8');
    expect(nearestVisualPointFromTorusViewBoxPosition(scene, -1, 500)).toBeNull();
  });
});
