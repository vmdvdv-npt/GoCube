import { describe, expect, it } from 'vitest';
import type { GameViewModel, GameViewPoint } from '../presentation/PresentationModel';
import {
  Torus2DRenderer,
  buildTorus2DScene,
  pointFromTorusViewBoxPosition,
  shiftTorus2DViewState,
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

describe('Torus2DRenderer presentation', () => {
  it('builds a deterministic clean NxN board by default', () => {
    const normal = buildTorus2DScene(viewModel(9), 9);
    const reversed = buildTorus2DScene(viewModel(9, {}, true), 9);

    expect(normal).toEqual(reversed);
    expect(normal.points).toHaveLength(81);
    expect(normal.visualPoints).toHaveLength(81);
    expect(normal.visualPoints.filter((point) => point.duplicate)).toHaveLength(0);
    expect(normal.duplicateMargin).toBe(0);
    expect(normal.points[0]).toMatchObject({
      logicalPointId: '0,0',
      x: 120,
      y: 120,
      duplicate: false,
    });
    expect(normal.gridLines).toHaveLength(18);
  });

  it('adds exactly four wrapped duplicate rows and columns on every side when enabled', () => {
    const scene = buildTorus2DScene(viewModel(9), 9, { offsetX: 0, offsetY: 0 }, true);

    expect(scene.points).toHaveLength(81);
    expect(scene.visualPoints).toHaveLength(289);
    expect(scene.visualPoints.filter((point) => point.duplicate)).toHaveLength(208);
    expect(scene.duplicateMargin).toBe(4);
    expect(scene.visualPoints[0]).toMatchObject({
      logicalPointId: '5,5',
      visualColumn: -4,
      visualRow: -4,
      duplicate: true,
    });
    expect(scene.visualPoints.at(-1)).toMatchObject({
      visualColumn: 12,
      visualRow: 12,
      duplicate: true,
    });
    expect(scene.gridLines).toHaveLength(34);
  });

  it('keeps every visible duplicate of a logical point synchronized', () => {
    const scene = buildTorus2DScene(
      viewModel(9, { '0,0': 'black', '4,5': 'white' }),
      9,
      { offsetX: 0, offsetY: 0 },
      true,
    );

    const cornerCopies = scene.visualPoints.filter((point) => point.logicalPointId === '0,0');
    expect(cornerCopies).toHaveLength(4);
    expect(cornerCopies.every((point) => point.occupancy === 'black')).toBe(true);

    expect(scene.visualPoints.find((point) => point.logicalPointId === '4,5')?.occupancy).toBe(
      'white',
    );
  });

  it.each([9, 13, 19] as const)('supports clean and 4-cell duplicate regions on a %ix%i torus', (size) => {
    const clean = buildTorus2DScene(viewModel(size), size);
    const repeated = buildTorus2DScene(
      viewModel(size),
      size,
      { offsetX: 0, offsetY: 0 },
      true,
    );

    expect(clean.points).toHaveLength(size * size);
    expect(clean.visualPoints).toHaveLength(size * size);
    expect(clean.gridLines).toHaveLength(size * 2);

    expect(repeated.points).toHaveLength(size * size);
    expect(repeated.visualPoints).toHaveLength((size + 8) ** 2);
    expect(repeated.gridLines).toHaveLength((size + 8) * 2);
  });

  it('shifts the logical view cyclically in all four directions', () => {
    expect(shiftTorus2DViewState({ offsetX: 0, offsetY: 0 }, 'left', 9)).toEqual({
      offsetX: 8,
      offsetY: 0,
    });
    expect(shiftTorus2DViewState({ offsetX: 0, offsetY: 0 }, 'up', 9)).toEqual({
      offsetX: 0,
      offsetY: 8,
    });
    expect(shiftTorus2DViewState({ offsetX: 8, offsetY: 8 }, 'right', 9)).toEqual({
      offsetX: 0,
      offsetY: 8,
    });
    expect(shiftTorus2DViewState({ offsetX: 8, offsetY: 8 }, 'down', 9)).toEqual({
      offsetX: 8,
      offsetY: 0,
    });
  });

  it('repositions logical points without changing their identities or occupancy', () => {
    const source = viewModel(9, { '1,2': 'black' });
    const shifted = buildTorus2DScene(source, 9, { offsetX: 1, offsetY: 2 });

    expect(shifted.points[0]).toMatchObject({
      logicalPointId: '1,2',
      occupancy: 'black',
      visualColumn: 0,
      visualRow: 0,
    });
    expect(new Set(shifted.points.map((point) => point.logicalPointId))).toEqual(
      new Set(source.points.map((point) => point.logicalPointId)),
    );
  });

  it('hit-tests primary and enabled duplicate copies back to one logical PointId', () => {
    const clean = buildTorus2DScene(viewModel(9), 9);
    const primary = clean.points.find((point) => point.logicalPointId === '0,0')!;

    expect(pointFromTorusViewBoxPosition(clean, primary.x, primary.y)).toBe('0,0');
    expect(
      pointFromTorusViewBoxPosition(clean, primary.x + clean.spacing / 2, primary.y),
    ).toBeNull();
    expect(pointFromTorusViewBoxPosition(clean, Number.NaN, primary.y)).toBeNull();

    const repeated = buildTorus2DScene(
      viewModel(9),
      9,
      { offsetX: 0, offsetY: 0 },
      true,
    );
    const duplicate = repeated.visualPoints.find(
      (point) => point.logicalPointId === '8,0' && point.visualColumn === -1,
    )!;
    expect(pointFromTorusViewBoxPosition(repeated, duplicate.x, duplicate.y)).toBe('8,0');
  });

  it('renders only the clean board until duplicate regions are explicitly enabled', () => {
    const { root, svg } = fakeSvg();
    const renderer = new Torus2DRenderer(svg, 9);
    const source = viewModel(9, { '0,0': 'black', '8,8': 'white' });

    renderer.render(source);

    expect(renderer.duplicateRegionsVisible()).toBe(false);
    expect(root.attributes.get('viewBox')).toBe('0 0 1000 1000');
    expect(root.attributes.get('data-duplicate-regions-visible')).toBe('false');
    expect(root.children.map((child) => child.attributes.get('class'))).toEqual([
      'torus-board__background',
      'torus-board__grid',
      'torus-board__hit-targets',
      'torus-board__stones',
    ]);
    expect(root.children[1]?.children).toHaveLength(18);
    expect(root.children[2]?.children).toHaveLength(81);
    expect(root.children[3]?.children).toHaveLength(2);

    renderer.setDuplicateRegionsVisible(true);
    renderer.render(source);

    expect(renderer.duplicateRegionsVisible()).toBe(true);
    expect(root.attributes.get('data-duplicate-regions-visible')).toBe('true');
    expect(root.children[1]?.children).toHaveLength(34);
    expect(root.children[2]?.children).toHaveLength(289);
    expect(root.children[3]?.children).toHaveLength(8);
    expect(
      root.children[3]?.children.filter(
        (child) => child.attributes.get('data-logical-point-id') === '0,0',
      ),
    ).toHaveLength(4);
  });

  it('pans indefinitely while preserving semantic hit testing', () => {
    const { root, svg } = fakeSvg();
    const renderer = new Torus2DRenderer(svg, 9);
    renderer.render(viewModel(9));

    for (let index = 0; index < 10; index += 1) renderer.pan('right');
    expect(renderer.viewState()).toEqual({ offsetX: 1, offsetY: 0 });
    expect(root.attributes.get('data-view-offset-x')).toBe('1');

    // viewBox (120, 120) maps to client (160, 110); after the shift it is logical point 1,0.
    expect(renderer.pointFromClientPosition(160, 110)).toBe('1,0');
  });

  it('does not mutate the input GameViewModel while building or panning the view', () => {
    const source = viewModel(9, { '2,3': 'black' }, true);
    const before = JSON.stringify(source);
    const { svg } = fakeSvg();
    const renderer = new Torus2DRenderer(svg, 9);

    renderer.render(source);
    renderer.setDuplicateRegionsVisible(true);
    renderer.render(source);
    renderer.pan('left');
    renderer.pan('up');

    expect(JSON.stringify(source)).toBe(before);
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

  it('rejects fractional view offsets because navigation is in logical steps', () => {
    expect(() => buildTorus2DScene(viewModel(9), 9, { offsetX: 0.5, offsetY: 0 })).toThrow(
      'integer logical steps',
    );
  });
});
