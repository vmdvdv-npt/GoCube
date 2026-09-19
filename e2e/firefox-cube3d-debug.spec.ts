import { expect, test } from '@playwright/test';

test('diagnose Firefox Cube 3D mount', async ({ page }) => {
  page.on('console', (message) => {
    console.log(`BROWSER_CONSOLE ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    console.log(`PAGE_ERROR: ${error.stack ?? error.message}`);
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByRole('group', { name: 'Cube view' }).getByRole('button', { name: '3D' }).click();

  await expect(page.getByRole('region', { name: 'Cube game' })).toHaveAttribute(
    'data-cube-view-transitioning',
    'false',
  );
  await page.waitForTimeout(1000);

  console.log(
    'CUBE3D_DEBUG',
    JSON.stringify({
      view: await page.getByRole('region', { name: 'Cube game' }).getAttribute('data-cube-view'),
      viewCount: await page.getByLabel('Cube 3D view').count(),
      sceneCount: await page.getByLabel('Cube 3D scene').count(),
      loadingCount: await page.locator('.cube-3d-scene--loading').count(),
      canvasCount: await page.locator('[data-testid="cube-3d-canvas"]').count(),
    }),
  );

  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1, { timeout: 5_000 });
});
