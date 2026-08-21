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