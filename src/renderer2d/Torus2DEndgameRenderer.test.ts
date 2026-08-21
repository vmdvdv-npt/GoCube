import { describe, expect, it } from 'vitest';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
import type { EndgameGroupRenderState } from '../presentation/EndgameGroupPresentation';
import {
  buildTorus2DEndgameSegments,
  buildTorus2DScene,
  endgameGroupFromTorusViewBoxPosition,
  endgameLineStyle,
  TORUS_ENDGAME_LINE_WIDTH_PX,
  type Torus2DSize,
} from './Torus2DRenderer';

const pointId = (x: number, y: number): string => `${x},${y}`;

const viewModel = (
  size: Torus2DSize,
  occupied: Readonly<Record<string, 'black' | 'white'>>,
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
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 0,
    phase: 'endgame',
    captures: { black: 0, white: 0 },
    ruleSet: 'chinese',
    komi: 7.5,
    finalScore: null,
  };
};

const overlay = (
  group: EndgameGroupRenderState,
  hoveredGroupId: string | null = null,
  selectedGroupId: string | null = null,
) => ({ groups: [group], hoveredGroupId, selectedGroupId });

describe('Torus2DRenderer manual endgame geometry', () => {
  it('draws a normal connected group through the centers of every real adjacency', () => {
    const source = viewModel(9, { '3,4': 'black', '4,4': 'black', '5,4': 'black' });
    const scene = buildTorus2DScene(source, 9);
    const group: EndgameGroupRenderState = {
      id: 'line',
      points: ['3,4', '4,4', '5,4'],
      color: 'black',
      edges: [
        { from: '3,4', to: '4,4' },
        { from: '4,4', to: '5,4' },
      ],
      status: 'alive',
    };

    const segments = buildTorus2DEndgameSegments(scene, overlay(group));
    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.y1 === segment.y2)).toBe(true);
    expect(segments.every((segment) => Math.abs(segment.x2 - segment.x1) === scene.spacing)).toBe(true);
  });

  it('draws a single stone from one stone edge through its center to the other edge', () => {
    const source = viewModel(9, { '4,4': 'white' });
    const scene = buildTorus2DScene(source, 9);
    const group: EndgameGroupRenderState = {
      id: 'single',
      points: ['4,4'],
      color: 'white',
      edges: [],
      status: 'alive',
    };

    const [segment] = buildTorus2DEndgameSegments(scene, overlay(group));
    const stone = scene.points.find((point) => point.logicalPointId === '4,4')!;
    expect(segment).toMatchObject({
      x1: stone.x - scene.stoneRadius,
      y1: stone.y,
      x2: stone.x + scene.stoneRadius,
      y2: stone.y,
    });
  });

  it('draws exactly one center-to-center segment for two neighboring stones', () => {
    const source = viewModel(9, { '4,4': 'black', '5,4': 'black' });
    const scene = buildTorus2DScene(source, 9);
    const group: EndgameGroupRenderState = {
      id: 'pair',
      points: ['4,4', '5,4'],
      color: 'black',
      edges: [{ from: '4,4', to: '5,4' }],
      status: 'dead',
    };

    expect(buildTorus2DEndgameSegments(scene, overlay(group))).toHaveLength(1);
  });

  it('renders every branch of a branching group', () => {
    const source = viewModel(9, {
      '4,4': 'black',
      '3,4': 'black',
      '5,4': 'black',
      '4,3': 'black',
      '4,5': 'black',
    });
    const scene = buildTorus2DScene(source, 9);
    const group: EndgameGroupRenderState = {
      id: 'branch',
      points: ['4,4', '3,4', '5,4', '4,3', '4,5'],
      color: 'black',
      edges: [
        { from: '3,4', to: '4,4' },
        { from: '4,3', to: '4,4' },
        { from: '4,4', to: '4,5' },
        { from: '4,4', to: '5,4' },
      ],
      status: 'seki',
    };

    expect(buildTorus2DEndgameSegments(scene, overlay(group))).toHaveLength(4);
  });

  it('splits a horizontal seam connection instead of drawing across the whole board', () => {
    const source = viewModel(9, { '0,4': 'black', '8,4': 'black' });
    const scene = buildTorus2DScene(source, 9);
    const group: EndgameGroupRenderState = {
      id: 'horizontal-seam',
      points: ['0,4', '8,4'],
      color: 'black',
      edges: [{ from: '0,4', to: '8,4' }],
      status: 'dead',
    };

    const segments = buildTorus2DEndgameSegments(scene, overlay(group));
    expect(segments).toHaveLength(2);
    expect(
      segments.every((segment) => Math.abs(segment.x2 - segment.x1) === scene.spacing / 2),
    ).toBe(true);
  });

  it('splits a vertical seam connection instead of drawing across the whole board', () => {
    const source = viewModel(9, { '4,0': 'white', '4,8': 'white' });
    const scene = buildTorus2DScene(source, 9);
    const group: EndgameGroupRenderState = {
      id: 'vertical-seam',
      points: ['4,0', '4,8'],
      color: 'white',
      edges: [{ from: '4,0', to: '4,8' }],
      status: 'alive',
    };

    const segments = buildTorus2DEndgameSegments(scene, overlay(group));
    expect(segments).toHaveLength(2);
    expect(
      segments.every((segment) => Math.abs(segment.y2 - segment.y1) === scene.spacing / 2),
    ).toBe(true);
  });

  it('uses the same geometry for hover as a weaker temporary line', () => {
    const source = viewModel(9, { '4,4': 'black', '5,4': 'black' });
    const scene = buildTorus2DScene(source, 9);
    const group: EndgameGroupRenderState = {
      id: 'hovered',
      points: ['4,4', '5,4'],
      color: 'black',
      edges: [{ from: '4,4', to: '5,4' }],
      status: null,
    };

    const segments = buildTorus2DEndgameSegments(scene, overlay(group, group.id));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.temporary).toBe(true);
    expect(endgameLineStyle(null, 'black', true).opacity).toBeLessThan(1);
  });

  it('hit-tests an already drawn line back to its semantic group id', () => {
    const source = viewModel(9, { '4,4': 'black', '5,4': 'black' });
    const scene = buildTorus2DScene(source, 9);
    const group: EndgameGroupRenderState = {
      id: 'clickable',
      points: ['4,4', '5,4'],
      color: 'black',
      edges: [{ from: '4,4', to: '5,4' }],
      status: 'alive',
    };

    const [segment] = buildTorus2DEndgameSegments(scene, overlay(group));
    expect(
      endgameGroupFromTorusViewBoxPosition(
        [segment!],
        (segment!.x1 + segment!.x2) / 2,
        (segment!.y1 + segment!.y2) / 2,
      ),
    ).toBe(group.id);
  });

  it('uses an exact 2 px endgame line', () => {
    expect(TORUS_ENDGAME_LINE_WIDTH_PX).toBe(2);
  });

  it('maps Alive/Dead/Seki/Unknown to the required solid/dashed colors', () => {
    expect(endgameLineStyle('alive', 'black', false)).toMatchObject({
      stroke: '#ffffff',
      strokeDasharray: null,
    });
    expect(endgameLineStyle('alive', 'white', false)).toMatchObject({
      stroke: '#111111',
      strokeDasharray: null,
    });
    expect(endgameLineStyle('dead', 'black', false)).toMatchObject({
      stroke: '#d32f2f',
      strokeDasharray: null,
    });
    expect(endgameLineStyle('seki', 'white', false)).toMatchObject({
      stroke: '#7a7a7a',
      strokeDasharray: null,
    });
    expect(endgameLineStyle('unknown', 'black', false).strokeDasharray).not.toBeNull();
  });

  it('renders synchronized line copies in duplicate regions', () => {
    const source = viewModel(9, { '0,4': 'black', '8,4': 'black' });
    const scene = buildTorus2DScene(source, 9, { offsetX: 0, offsetY: 0 }, true);
    const group: EndgameGroupRenderState = {
      id: 'duplicates',
      points: ['0,4', '8,4'],
      color: 'black',
      edges: [{ from: '0,4', to: '8,4' }],
      status: 'dead',
    };

    const segments = buildTorus2DEndgameSegments(scene, overlay(group));
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.groupId === group.id)).toBe(true);
    expect(segments.every((segment) => segment.status === 'dead')).toBe(true);
    expect(
      segments.every((segment) =>
        Math.abs(segment.x2 - segment.x1) <= scene.spacing &&
        Math.abs(segment.y2 - segment.y1) <= scene.spacing,
      ),
    ).toBe(true);
  });
});
