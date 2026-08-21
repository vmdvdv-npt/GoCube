import { expect, test, type Page } from '@playwright/test';

const startGame = async (page: Page, size: '9' | '13' | '19'): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption(size);
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'aria-label',
    `${size} by ${size} repeating torus Go board`,
  );
};

const edgeMarginInGridSteps = async (page: Page): Promise<number> =>
  page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.torus-board-viewport');
    const points = Array.from(
      document.querySelectorAll<SVGCircleElement>('.torus-board__hit-target'),
    );
    if (!viewport || points.length < 2) throw new Error('Board geometry is missing');

    const centers = points
      .map((point) => {
        const box = point.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      })
      .sort((left, right) => left.x - right.x || left.y - right.y);

    const uniqueX = [...new Set(centers.map((point) => Number(point.x.toFixed(3))))].sort(
      (left, right) => left - right,
    );
    if (uniqueX.length < 2) throw new Error('Grid spacing cannot be measured');

    const spacing = uniqueX[1]! - uniqueX[0]!;
    const viewportBox = viewport.getBoundingClientRect();
    const edgeMargin = uniqueX[0]! - viewportBox.left;
    return edgeMargin / spacing;
  });

for (const size of ['9', '13', '19'] as const) {
  test(`${size}x${size} keeps its normal edge margin and reserves room for one duplicate strip`, async ({
    page,
  }) => {
    await startGame(page, size);

    await expect.poll(() => edgeMarginInGridSteps(page)).toBeGreaterThan(0.72);
    await expect.poll(() => edgeMarginInGridSteps(page)).toBeLessThan(0.88);

    await page.getByLabel('Показывать дублирующие области').check();
    await expect(page.locator('.torus-board')).toHaveAttribute(
      'data-duplicate-regions-visible',
      'true',
    );

    // Duplicate mode deliberately reserves the former wooden margin for a single
    // renderer-only wrapped strip. The playable hit geometry itself stays size×size.
    await expect(page.locator('.torus-board__hit-target[data-copy-role="primary"]')).toHaveCount(
      Number(size) ** 2,
    );
    await expect(page.locator('.torus-board__hit-target[data-copy-role="duplicate"]')).toHaveCount(0);
    await expect(page.locator('.torus-board__edge-duplicate-band')).toHaveCount(4);
    await expect(page.locator('.torus-board__edge-duplicate-grid-line')).toHaveCount(
      Number(size) * 4 + 4,
    );
  });
}