import { expect, test, type Page } from '@playwright/test';
import { CUBE_3D_PERFORMANCE_BUDGET } from '../src/renderer3d/Cube3DPerformance';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'development', exact: true })).toBeVisible();
});

const startCubeGame = async (page: Page) => {
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
};

test('Cube starts in 2D and switches to the isolated 3D scene without changing the game', async ({ page }) => {
  await startCubeGame(page);

  const view = page.getByRole('group', { name: 'Cube view' });
  await expect(view.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cube-2d-renderer')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Board display options' })).toContainText(
    'Move numbers',
  );
  await expect(page.getByRole('link', { name: 'development', exact: true })).toHaveCount(0);

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

test('Three.js stays lazy until the user enters Cube 3D', async ({ page }) => {
  const threeRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/node_modules/.vite/deps/three')) threeRequests.push(url);
  });

  await startCubeGame(page);
  expect(threeRequests).toHaveLength(0);

  await page.getByRole('group', { name: 'Cube view' }).getByRole('button', { name: '3D' }).click();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);
  expect(threeRequests.length).toBeGreaterThan(0);
});

test('Cube 3D rotation and zoom survive a temporary switch to 2D', async ({ page }) => {
  await startCubeGame(page);
  const view = page.getByRole('group', { name: 'Cube view' });
  await view.getByRole('button', { name: '3D' }).click();

  const scene = page.getByLabel('Cube 3D scene');
  const canvas = page.locator('[data-testid="cube-3d-canvas"]');
  await expect(canvas).toHaveCount(1);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.42, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(0, -240);

  const rotation = await scene.getAttribute('data-cube3d-rotation');
  const zoom = await scene.getAttribute('data-cube3d-zoom');
  expect(rotation).not.toBe('0.000000,0.000000,0.000000,1.000000');
  expect(zoom).not.toBe('1.0000');

  await view.getByRole('button', { name: '2D' }).click();
  await expect(canvas).toHaveCount(0);
  await page.getByRole('group', { name: 'Cube view' }).getByRole('button', { name: '3D' }).click();
  await expect(page.getByLabel('Cube 3D scene')).toHaveAttribute('data-cube3d-rotation', rotation ?? '');
  await expect(page.getByLabel('Cube 3D scene')).toHaveAttribute('data-cube3d-zoom', zoom ?? '');
});

test('Cube 3D resize and repeated mount/unmount do not accumulate canvases', async ({ page }) => {
  await startCubeGame(page);

  for (let cycle = 0; cycle < CUBE_3D_PERFORMANCE_BUDGET.automatedLifecycleCycles; cycle += 1) {
    await page.getByRole('group', { name: 'Cube view' }).getByRole('button', { name: '3D' }).click();
    await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(
      CUBE_3D_PERFORMANCE_BUDGET.maxLiveCanvases,
    );
    await page.getByRole('group', { name: 'Cube view' }).getByRole('button', { name: '2D' }).click();
    await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(
      CUBE_3D_PERFORMANCE_BUDGET.maxResidualCanvasesAfterUnmount,
    );
  }

  await page.getByRole('group', { name: 'Cube view' }).getByRole('button', { name: '3D' }).click();
  const scene = page.getByLabel('Cube 3D scene');
  const before = await scene.getAttribute('data-cube3d-viewport');
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(scene).not.toHaveAttribute('data-cube3d-viewport', before ?? '');
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);
});

test('Torus does not expose the Cube 2D/3D switch', async ({ page }) => {
  await page.getByRole('button', { name: 'Torus', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('group', { name: 'Cube view' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Board display options' })).toContainText(
    'Move numbers',
  );
  await expect(page.getByRole('link', { name: 'development', exact: true })).toHaveCount(0);
});
