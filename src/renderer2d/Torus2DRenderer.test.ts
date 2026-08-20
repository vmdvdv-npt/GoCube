import { describe, expect, it } from 'vitest';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
import {
  Torus2DRenderer,
  buildTorus2DScene,
  pointFromTorusViewBoxPosition,
  type Torus2DSize,
} from './Torus2DRenderer';

const pointId = (x: number, y: number): string => `${x},${y}`;

const viewModel = (
  size: Torus2DSize,
  occupied: Readonly<Record<string, 'black' | 'white'>> = {},
  reverse = false,
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
  if (reverse) points.reverse();

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

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];

  constructor(readonly tagName: string) {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: Node): Node {
    this.children.push(child as unknown as FakeElement);
    return child;
  }

  replaceChildren(...nodes: (Node | string)[]): void {
    this.children.length = 0;
    for (const node of nodes) {
      if (typeof node !== 'string') this.children.push(node as unknown as FakeElement);
    }
  }
}

const fakeSvg = () => {
  const document = {
    createElementNS: (_namespace: string, qualifiedName: string) =>
      new FakeElement(qualifiedName) as unknown as Element,
  } as unknown as Document;

  const root = new FakeElement('svg') as FakeElement & {
    ownerDocument: Document;
    getBoundingClientRect(): DOMRect;
  };
  root.ownerDocument = document;
  root.getBoundingClientRect = () =>
    ({ left: 100, top: 50, width: 500, height: 500 } as DOMRect);

  return { root, svg: root as unknown as SVGSVGElement };
};

describe('Torus2DRenderer', () => {
  it('builds deterministic row-major geometry independently of ViewModel point order', () => {
    const normal = buildTorus2DScene(viewModel(9), 9);
    const reversed = buildTorus2DScene(viewModel(9, {}, true), 9);

    expect(normal).toEqual(reversed);
    expect(normal.points).toHaveLength(81);
    expect(normal.points[0]).toMatchObject({ logicalPointId: '0,0', x: 60, y: 60 });
    expect(normal.points.at(-1)).toMatchObject({ logicalPointId: '8,8', x: 940, y: 940 });
    expect(normal.gridLines).toHaveLength(18);
  });

  it('maps black, white and empty logical points into the scene without changing occupancy', () => {
    const scene = buildTorus2DScene(
      viewModel(9, { '0,0': 'black', '4,5': 'white' }),
      9,
    );

    expect(scene.points.find((point) => point.logicalPointId === '0,0')?.occupancy).toBe('black');
    expect(scene.points.find((point) => point.logicalPointId === '4,5')?.occupancy).toBe('white');
    expect(scene.points.find((point) => point.logicalPointId === '8,8')?.occupancy).toBe('empty');
  });

  it.each([9, 13, 19] as const)('supports a %ix%i torus', (size) => {
    const scene = buildTorus2DScene(viewModel(size), size);
    expect(scene.points).toHaveLength(size * size);
    expect(scene.gridLines).toHaveLength(size * 2);
  });

  it('hit-tests viewBox coordinates to logical PointId and rejects space between intersections', () => {
    const scene = buildTorus2DScene(viewModel(9), 9);
    const center = scene.points.find((point) => point.logicalPointId === '4,3')!;

    expect(pointFromTorusViewBoxPosition(scene, center.x, center.y)).toBe('4,3');
    expect(
      pointFromTorusViewBoxPosition(scene, center.x + scene.spacing / 2, center.y),
    ).toBeNull();
    expect(pointFromTorusViewBoxPosition(scene, -100, -100)).toBeNull();
    expect(pointFromTorusViewBoxPosition(scene, Number.NaN, center.y)).toBeNull();
  });

  it('renders SVG groups and stones from GameViewModel only', () => {
    const { root, svg } = fakeSvg();
    const renderer = new Torus2DRenderer(svg, 9);

    renderer.render(viewModel(9, { '0,0': 'black', '8,8': 'white' }));

    expect(root.attributes.get('viewBox')).toBe('0 0 1000 1000');
    expect(root.children.map((child) => child.attributes.get('class'))).toEqual([
      'torus-board__background',
      'torus-board__grid',
      'torus-board__hit-targets',
      'torus-board__stones',
    ]);
    expect(root.children[1]?.children).toHaveLength(18);
    expect(root.children[2]?.children).toHaveLength(81);
    expect(root.children[3]?.children).toHaveLength(2);
    expect(root.children[3]?.children[0]?.attributes.get('data-logical-point-id')).toBe('0,0');
    expect(root.children[3]?.children[1]?.attributes.get('data-logical-point-id')).toBe('8,8');
  });

  it('maps client coordinates back to a logical point after render', () => {
    const { svg } = fakeSvg();
    const renderer = new Torus2DRenderer(svg, 9);

    expect(renderer.pointFromClientPosition(130, 80)).toBeNull();
    renderer.render(viewModel(9));

    // viewBox (60, 60) maps to client (130, 80) in the fake 500x500 SVG.
    expect(renderer.pointFromClientPosition(130, 80)).toBe('0,0');
    expect(renderer.pointFromClientPosition(100, 50)).toBeNull();
  });

  it('does not mutate the input GameViewModel', () => {
    const source = viewModel(9, { '2,3': 'black' }, true);
    const before = JSON.stringify(source);

    const scene = buildTorus2DScene(source, 9);

    expect(JSON.stringify(source)).toBe(before);
    expect(scene.points).not.toBe(source.points);
  });

  it('rejects incomplete or duplicate logical boards instead of inventing renderer state', () => {
    const source = viewModel(9);
    expect(
      () => buildTorus2DScene({ ...source, points: source.points.slice(0, -1) }, 9),
    ).toThrow('expected 81 points');

    const duplicate = [...source.points];
    duplicate[80] = duplicate[0]!;
    expect(() => buildTorus2DScene({ ...source, points: duplicate }, 9)).toThrow(
      'Duplicate logical point',
    );
  });
});
