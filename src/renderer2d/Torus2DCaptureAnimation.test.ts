import { describe, expect, it } from 'vitest';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
import {
  TORUS_CAPTURE_DUPLICATE_FADE_DURATION_MS,
  TORUS_CAPTURE_FLIGHT_DURATION_MS,
  TORUS_CAPTURE_FLIGHT_STAGGER_MS,
  buildTorus2DCaptureEffects,
  buildTorus2DScene,
  type Torus2DSize,
} from './Torus2DRenderer';

const pointId = (x: number, y: number): string => `${x},${y}`;

const viewModel = (
  size: Torus2DSize,
  occupied: Readonly<Record<string, 'black' | 'white'>>,
  options: Readonly<{
    moveNumber: number;
    blackCaptures?: number;
    whiteCaptures?: number;
  }>,
): GameViewModel => {
  const points: GameViewPoint[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const logicalPointId = pointId(x, y);
      points.push({
        logicalPointId,
        occupancy: occupied[logicalPointId] ?? 'empty',
      });
    }
  }

  return {
    points,
    currentPlayer: options.moveNumber % 2 === 0 ? 'black' : 'white',
    moveNumber: options.moveNumber,
    consecutivePasses: 0,
    phase: 'playing',
    captures: {
      black: options.blackCaptures ?? 0,
      white: options.whiteCaptures ?? 0,
    },
    ruleSet: 'chinese',
    komi: 7.5,
    finalScore: null,
  };
};

const primaryEffects = (
  previous: GameViewModel,
  next: GameViewModel,
  duplicates = false,
) => {
  const scene = buildTorus2DScene(previous, 9, { offsetX: 0, offsetY: 0 }, duplicates);
  return buildTorus2DCaptureEffects(previous, next, scene).filter(
    (effect) => effect.kind === 'flight',
  );
};

describe('Torus2D captured stone animation', () => {
  it('flies captured white stones left with only a small upward tilt', () => {
    const previous = viewModel(9, { '4,4': 'white' }, { moveNumber: 10 });
    const next = viewModel(9, {}, { moveNumber: 11, blackCaptures: 1 });

    const [effect] = primaryEffects(previous, next);

    expect(effect).toMatchObject({
      kind: 'flight',
      logicalPointId: '4,4',
      color: 'white',
      delayMs: 0,
      durationMs: TORUS_CAPTURE_FLIGHT_DURATION_MS,
      duplicate: false,
    });
    expect(effect!.targetX).toBeLessThan(0);
    expect(effect!.targetY).toBeLessThan(effect!.y);
    expect(Math.abs(effect!.targetX - effect!.x)).toBeGreaterThan(
      Math.abs(effect!.targetY - effect!.y),
    );
  });

  it('flies captured black stones right regardless of player-panel layout', () => {
    const previous = viewModel(9, { '4,4': 'black' }, { moveNumber: 11 });
    const next = viewModel(9, {}, { moveNumber: 12, whiteCaptures: 1 });

    const [effect] = primaryEffects(previous, next);

    expect(effect).toMatchObject({
      kind: 'flight',
      logicalPointId: '4,4',
      color: 'black',
      delayMs: 0,
      durationMs: TORUS_CAPTURE_FLIGHT_DURATION_MS,
    });
    expect(effect!.targetX).toBeGreaterThan(1000);
    expect(effect!.targetY).toBeLessThan(effect!.y);
  });

  it('starts captured group stones sequentially at 150 ms intervals', () => {
    const previous = viewModel(
      9,
      { '2,2': 'white', '2,3': 'white', '3,3': 'white' },
      { moveNumber: 20 },
    );
    const next = viewModel(9, {}, { moveNumber: 21, blackCaptures: 3 });

    const effects = primaryEffects(previous, next);

    expect(effects).toHaveLength(3);
    expect(effects.map((effect) => effect.delayMs)).toEqual([
      0,
      TORUS_CAPTURE_FLIGHT_STAGGER_MS,
      TORUS_CAPTURE_FLIGHT_STAGGER_MS * 2,
    ]);
  });

  it('flies the primary copy but fades wrapped duplicate copies at the same logical delay', () => {
    const previous = viewModel(9, { '0,0': 'white' }, { moveNumber: 30 });
    const next = viewModel(9, {}, { moveNumber: 31, blackCaptures: 1 });
    const scene = buildTorus2DScene(previous, 9, { offsetX: 0, offsetY: 0 }, true);

    const effects = buildTorus2DCaptureEffects(previous, next, scene).filter(
      (effect) => effect.logicalPointId === '0,0',
    );
    const primary = effects.filter((effect) => effect.kind === 'flight');
    const duplicates = effects.filter((effect) => effect.kind === 'fade');

    expect(primary).toHaveLength(1);
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates.every((effect) => effect.duplicate)).toBe(true);
    expect(duplicates.every((effect) => effect.delayMs === primary[0]!.delayMs)).toBe(true);
    expect(duplicates.every(
      (effect) => effect.durationMs === TORUS_CAPTURE_DUPLICATE_FADE_DURATION_MS,
    )).toBe(true);
  });

  it('does not animate undo-like or non-capture state changes', () => {
    const captured = viewModel(9, {}, { moveNumber: 11, blackCaptures: 1 });
    const restored = viewModel(9, { '4,4': 'white' }, { moveNumber: 10 });
    const capturedScene = buildTorus2DScene(captured, 9);

    expect(buildTorus2DCaptureEffects(captured, restored, capturedScene)).toEqual([]);

    const before = viewModel(9, { '4,4': 'white' }, { moveNumber: 10 });
    const afterWithoutCaptureCounter = viewModel(9, {}, { moveNumber: 11 });
    const beforeScene = buildTorus2DScene(before, 9);
    expect(
      buildTorus2DCaptureEffects(before, afterWithoutCaptureCounter, beforeScene),
    ).toEqual([]);
  });
});
