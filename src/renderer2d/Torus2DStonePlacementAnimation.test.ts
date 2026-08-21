import { describe, expect, it } from 'vitest';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
import { stonePlacementPointFromTransition } from './Torus2DStoneAnnotations';
import type { Torus2DSize } from './Torus2DRenderer';

const pointId = (x: number, y: number): string => `${x},${y}`;

const viewModel = (
  size: Torus2DSize,
  occupied: Readonly<Record<string, 'black' | 'white'>>,
  options: Readonly<{
    moveNumber: number;
    lastMovePointId?: string | null;
    stoneMoveNumbers?: Readonly<Record<string, number>>;
  }>,
): GameViewModel => {
  const points: GameViewPoint[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const logicalPointId = pointId(x, y);
      const occupancy = occupied[logicalPointId] ?? 'empty';
      points.push({
        logicalPointId,
        occupancy,
        moveNumber:
          occupancy === 'empty' ? null : options.stoneMoveNumbers?.[logicalPointId] ?? null,
      });
    }
  }

  return {
    points,
    currentPlayer: options.moveNumber % 2 === 0 ? 'black' : 'white',
    moveNumber: options.moveNumber,
    consecutivePasses: 0,
    phase: 'playing',
    captures: { black: 0, white: 0 },
    ruleSet: 'chinese',
    komi: 7.5,
    finalScore: null,
    lastMovePointId: options.lastMovePointId ?? null,
  };
};

describe('Torus2D stone placement animation transition', () => {
  it('identifies exactly the stone placed by the next ordinary move', () => {
    const previous = viewModel(9, { '1,1': 'black' }, {
      moveNumber: 7,
      lastMovePointId: '1,1',
      stoneMoveNumbers: { '1,1': 7 },
    });
    const next = viewModel(9, { '1,1': 'black', '4,4': 'white' }, {
      moveNumber: 8,
      lastMovePointId: '4,4',
      stoneMoveNumbers: { '1,1': 7, '4,4': 8 },
    });

    expect(stonePlacementPointFromTransition(previous, next)).toBe('4,4');
  });

  it('does not animate initial render, pass, repeat render, or undo', () => {
    const moveEight = viewModel(9, { '4,4': 'white' }, {
      moveNumber: 8,
      lastMovePointId: '4,4',
      stoneMoveNumbers: { '4,4': 8 },
    });
    const passNine = viewModel(9, { '4,4': 'white' }, {
      moveNumber: 9,
      lastMovePointId: '4,4',
      stoneMoveNumbers: { '4,4': 8 },
    });

    expect(stonePlacementPointFromTransition(null, moveEight)).toBeNull();
    expect(stonePlacementPointFromTransition(moveEight, passNine)).toBeNull();
    expect(stonePlacementPointFromTransition(moveEight, moveEight)).toBeNull();
    expect(stonePlacementPointFromTransition(passNine, moveEight)).toBeNull();
  });

  it('still identifies the newly placed stone on a capturing move', () => {
    const previous = viewModel(9, { '3,3': 'white' }, {
      moveNumber: 10,
      lastMovePointId: '3,3',
      stoneMoveNumbers: { '3,3': 6 },
    });
    const next = viewModel(9, { '4,4': 'black' }, {
      moveNumber: 11,
      lastMovePointId: '4,4',
      stoneMoveNumbers: { '4,4': 11 },
    });

    expect(stonePlacementPointFromTransition(previous, next)).toBe('4,4');
  });

  it('rejects stale last-move metadata instead of animating the wrong stone', () => {
    const previous = viewModel(9, {}, { moveNumber: 4 });
    const next = viewModel(9, { '2,2': 'black' }, {
      moveNumber: 5,
      lastMovePointId: '2,2',
      stoneMoveNumbers: { '2,2': 3 },
    });

    expect(stonePlacementPointFromTransition(previous, next)).toBeNull();
  });
});
