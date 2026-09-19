import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
});

test('Cube starts in 2D and switches to the isolated 3D scene without changing the game', async ({ page }) => {
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const view = page.getByRole('group', { name: 'Cube view' });
  await expect(view.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cube-2d-renderer')).toBeVisible();

  const displayOptions = page.getByRole('group', { name: 'Board display options' });
  const development = page.getByRole('link', { name: 'development', exact: true });
  await expect(development).toBeVisible();
  const displayOptionsBox = await displayOptions.boundingBox();
  const developmentBox = await development.boundingBox();
  expect(displayOptionsBox).not.toBeNull();
  expect(developmentBox).not.toBeNull();
  expect(developmentBox!.y).toBeGreaterThanOrEqual(
    displayOptionsBox!.y + displayOptionsBox!.height,
  );

  const point = page.locator('.cube-2d-hit-area[data-point-id="front:1:1"]');
  await point.click();
  await expect(page.locator('.cube-2d-stone[data-logical-point-id="front:1:1"]')).toHaveCount(1);

  await view.getByRole('button', { name: '3D' }).click();
  await expect(view.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Cube 3D view')).toBeVisible();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);

  await view.getByRole('button', { name: '2D' }).click();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(0);
  await expect(page.locator('.cube-2d-stone[data-logical-point-id="front:1:1"]')).toHaveCount(1);
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();
});

test('Torus does not expose the Cube 2D/3D switch', async ({ page }) => {
  await page.getByRole('button', { name: 'Torus', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('group', { name: 'Cube view' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'development', exact: true })).toBeVisible();
});
