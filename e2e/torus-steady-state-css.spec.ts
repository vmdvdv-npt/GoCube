import { expect, test, type Locator, type Page } from '@playwright/test';

const startTorus = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-board')).toBeVisible();
};

const pointOutsideEdge = async (
  hitTarget: Locator,
  direction: 'left' | 'right' | 'up' | 'down',
  radiusFactor: number,
): Promise<Readonly<{ x: number; y: number }>> =>
  hitTarget.evaluate(
    (element, args) => {
      const circle = element as SVGCircleElement;
      const svg = circle.ownerSVGElement;
      const matrix = svg?.getScreenCTM();
      if (!svg || !matrix) throw new Error('Expected Torus SVG screen transform');

      const cx = Number(circle.getAttribute('cx'));
      const cy = Number(circle.getAttribute('cy'));
      const radius = Number(circle.getAttribute('r'));
      const point = svg.createSVGPoint();
      point.x =
        cx +
        (args.direction === 'left' ? -1 : args.direction === 'right' ? 1 : 0) *
          radius *
          args.radiusFactor;
      point.y =
        cy +
        (args.direction === 'up' ? -1 : args.direction === 'down' ? 1 : 0) *
          radius *
          args.radiusFactor;
      const screenPoint = point.matrixTransform(matrix);
      return { x: screenPoint.x, y: screenPoint.y };
    },
    { direction, radiusFactor },
  );

test('Torus keeps the system cursor and no persistent compositor hint', async ({ page }) => {
  await startTorus(page);

  const board = page.locator('.torus-board');
  const state = await board.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      cursor: style.cursor,
      transform: style.transform,
      willChange: style.willChange,
    };
  });

  expect(state.cursor).not.toBe('none');
  expect(state.transform).toBe('none');
  expect(state.willChange).toBe('auto');
});

test('Japanese rules stat has no stale capture-stone decoration', async ({ page }) => {
  await startTorus(page);

  const rulesStat = page.getByText('Japanese rules', { exact: true });
  await expect(rulesStat).toBeVisible();
  const style = await rulesStat.evaluate((element) => ({
    beforeContent: getComputedStyle(element, '::before').content,
    flexDirection: getComputedStyle(element).flexDirection,
  }));

  expect(style.beforeContent).toBe('none');
  expect(style.flexDirection).toBe('row');
});

test('primary board edges preserve their normal hit influence without duplicate strips', async ({
  page,
}) => {
  await startTorus(page);
  await expect(page.locator('.torus-board')).toHaveAttribute('data-duplicate-regions-visible', 'false');
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(0);
  await expect(page.locator('.torus-board__hit-target[data-copy-role="duplicate"]')).toHaveCount(0);

  const edgePoints = [
    { id: '0,4', direction: 'left' },
    { id: '8,4', direction: 'right' },
    { id: '4,0', direction: 'up' },
    { id: '4,8', direction: 'down' },
  ] as const;

  for (const { id, direction } of edgePoints) {
    const hitTarget = page.locator(
      `.torus-board__hit-target[data-logical-point-id="${id}"][data-copy-role="primary"]`,
    );
    const position = await pointOutsideEdge(hitTarget, direction, 0.5);
    await page.mouse.move(position.x, position.y);
    await expect(
      page.locator(`.torus-board__preview-stone[data-logical-point-id="${id}"]`),
    ).toHaveCount(1);
  }

  const leftEdge = page.locator(
    '.torus-board__hit-target[data-logical-point-id="0,4"][data-copy-role="primary"]',
  );
  const playableEdgePosition = await pointOutsideEdge(leftEdge, 'left', 0.5);
  await page.mouse.move(playableEdgePosition.x, playableEdgePosition.y);
  await expect(
    page.locator('.torus-board__preview-stone[data-logical-point-id="0,4"]'),
  ).toHaveCount(1);
  await page.mouse.click(playableEdgePosition.x, playableEdgePosition.y);
  await expect(
    page.locator('.torus-board__stone[data-logical-point-id="0,4"][data-copy-role="primary"]'),
  ).toHaveCount(1);
});
