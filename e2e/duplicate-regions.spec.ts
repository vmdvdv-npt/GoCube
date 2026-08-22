import { expect, test } from '@playwright/test';

test('duplicate torus regions are one-line dashed visual-only edge strips', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  const board = page.locator('.torus-board');
  const toggle = page.getByLabel('Показывать дублирующие области');
  const primary00 = page.locator(
    '.torus-board__hit-target[data-logical-point-id="0,0"][data-copy-role="primary"]',
  );

  await expect(toggle).not.toBeChecked();
  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'false');
  await expect(page.locator('.torus-board__hit-target[data-copy-role="primary"]')).toHaveCount(81);
  await expect(page.locator('.torus-board__hit-target[data-copy-role="duplicate"]')).toHaveCount(0);
  await expect(page.locator('.torus-board__grid line')).toHaveCount(18);
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(0);

  // Put one stone in the top-left corner. In the new view it must be copied only
  // to the opposite right and bottom strips, never to an interactive board point.
  await primary00.click();
  await expect(page.getByText('Move 1')).toBeVisible();
  await expect(page.getByText('White to move')).toBeVisible();

  await toggle.check();

  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'true');
  await expect(page.locator('.torus-board__hit-target[data-copy-role="primary"]')).toHaveCount(81);
  await expect(page.locator('.torus-board__hit-target[data-copy-role="duplicate"]')).toHaveCount(0);
  await expect(page.locator('.torus-board__grid line')).toHaveCount(18);
  await expect(page.locator('.torus-board__edge-duplicate-band')).toHaveCount(4);
  await expect(page.locator('.torus-board__edge-duplicate-grid-line')).toHaveCount(40);
  await expect(page.locator('.torus-board__edge-duplicate-grid-line').first()).toHaveAttribute(
    'stroke-dasharray',
    '14 10',
  );
  await expect(page.locator('.torus-board__edge-duplicate-grid-line').first()).toHaveAttribute(
    'stroke',
    '#201e1c',
  );
  await expect(page.locator('.torus-board__edge-duplicate-grid-line').first()).toHaveAttribute(
    'pointer-events',
    'none',
  );

  const duplicate00 = page.locator(
    '.torus-board__edge-duplicate-stone[data-logical-point-id="0,0"]',
  );
  await expect(duplicate00).toHaveCount(2);
  await expect(page.locator('.torus-board__edge-duplicate-stones')).toHaveAttribute(
    'opacity',
    '0.5',
  );

  const primaryStone00 = page.locator(
    '.torus-board__stone[data-logical-point-id="0,0"][data-copy-role="primary"]',
  );
  await expect(primaryStone00).toHaveCount(1);
  await expect(primaryStone00).not.toHaveAttribute('opacity', '0.5');
  expect(await primaryStone00.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');

  const layerOrder = await board.evaluate((svg) => {
    const children = Array.from(svg.children);
    return {
      duplicateOverlay: children.findIndex((child) =>
        child.classList.contains('torus-board__edge-duplicates'),
      ),
      primaryStones: children.findIndex(
        (child) =>
          child.classList.contains('torus-board__stones') &&
          !child.classList.contains('torus-board__edge-duplicate-stones'),
      ),
    };
  });
  expect(layerOrder.duplicateOverlay).toBeGreaterThanOrEqual(0);
  expect(layerOrder.primaryStones).toBeGreaterThan(layerOrder.duplicateOverlay);

  const duplicateGrid = page.locator('.torus-board__edge-duplicate-grid');
  await expect(duplicateGrid).toHaveAttribute(
    'mask',
    /url\(#torus-edge-duplicate-grid-mask-\d+\)/,
  );
  await expect(page.locator('.torus-board__edge-duplicate-grid-mask circle')).toHaveCount(2);

  // Clicking directly on a visible duplicate must be ignored completely.
  const duplicateBox = await duplicate00.first().boundingBox();
  expect(duplicateBox).not.toBeNull();
  if (duplicateBox) {
    await page.mouse.click(
      duplicateBox.x + duplicateBox.width / 2,
      duplicateBox.y + duplicateBox.height / 2,
    );
  }
  await expect(page.getByText('Move 1')).toBeVisible();
  await expect(page.getByText('White to move')).toBeVisible();

  await toggle.uncheck();

  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'false');
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(0);
  await expect(page.locator('.torus-board__hit-target[data-copy-role="duplicate"]')).toHaveCount(0);
  await expect(page.locator('.torus-board__grid line')).toHaveCount(18);
});

test('Show duplicate regions is remembered between Torus games and reloads', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start game' }).click();

  let toggle = page.getByLabel('Показывать дублирующие области');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('gocube:preferences');
        return raw ? JSON.parse(raw).showTorusDuplicateRegions : null;
      }),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  toggle = page.getByLabel('Показывать дублирующие области');
  await expect(toggle).toBeChecked();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'true',
  );

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  toggle = page.getByLabel('Показывать дублирующие области');
  await expect(toggle).toBeChecked();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'true',
  );
});
