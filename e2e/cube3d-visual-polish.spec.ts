import { expect, test, type Page } from '@playwright/test';

const CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS = 30_000;

const cubeGame = (page: Page) => page.getByRole('region', { name: 'Cube game' });
const cubeViewSwitch = (page: Page) => page.getByRole('group', { name: 'Cube view' });
const scene3D = (page: Page) => page.getByLabel('Cube 3D scene');
const hit2D = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);

const waitForViewTransition = async (page: Page): Promise<void> => {
  await expect(cubeGame(page)).toHaveAttribute('data-cube-view-transitioning', 'false', {
    timeout: CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS,
  });
};

const enter3D = async (page: Page): Promise<void> => {
  await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
  await waitForViewTransition(page);
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1, {
    timeout: CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS,
  });
};

const canvasCenter = async (page: Page): Promise<{ x: number; y: number }> => {
  const bounds = await page.locator('[data-testid="cube-3d-canvas"]').boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Cube 3D canvas has no browser bounds');
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
};

test('Cube 3D visual polish remains stable on 7×7 across hover, rotation and full zoom range', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '7×7', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  // Build a legal position whose front-center point is suicide for Black.
  for (const pointId of [
    'back:3:3',
    'front:2:3',
    'back:1:1',
    'front:3:2',
    'back:5:5',
    'front:3:4',
    'left:3:3',
    'front:4:3',
  ]) {
    await hit2D(page, pointId).click();
  }

  await enter3D(page);
  const scene = scene3D(page);
  await expect(scene).toHaveAttribute('data-cube3d-size', '7');
  await expect(scene).toHaveAttribute('data-cube3d-visual-style', 'wood-pbr');
  await expect(scene).toHaveAttribute('data-cube3d-shadows', 'soft');
  await expect(scene).toHaveAttribute('data-cube3d-black-stone-count', '4');
  await expect(scene).toHaveAttribute('data-cube3d-white-stone-count', '4');
  await expect(scene).toHaveAttribute('data-cube3d-last-move-point', 'front:4:3');
  await expect(scene).toHaveAttribute('data-cube3d-zoom', '1.0000');
  await expect
    .poll(async () => Number(await scene.getAttribute('data-cube3d-grid-pitch')))
    .toBeGreaterThan(0);

  // A neighboring face center remains an allowed hover marker.
  await page.getByRole('button', { name: 'Move Cube 3D right' }).click();
  await waitForViewTransition(page);
  let center = await canvasCenter(page);
  await page.mouse.move(center.x, center.y);
  await expect(scene).toHaveAttribute('data-cube3d-hovered-point', 'right:3:3');
  await expect(scene).toHaveAttribute('data-cube3d-hover-status', 'allowed');

  // Returning to the canonical front view exposes the prepared forbidden center.
  await page.getByRole('button', { name: 'Reset Cube 3D view' }).click();
  await waitForViewTransition(page);
  center = await canvasCenter(page);
  await page.mouse.move(center.x, center.y);
  await expect(scene).toHaveAttribute('data-cube3d-hovered-point', 'front:3:3');
  await expect(scene).toHaveAttribute('data-cube3d-hover-status', 'forbidden');

  await page.getByRole('checkbox', { name: 'Move numbers' }).check();
  await expect(scene).toHaveAttribute('data-cube3d-move-number-count', '7');

  // Exercise both zoom clamps with the polished scene mounted.
  await page.mouse.wheel(0, -10_000);
  await expect(scene).toHaveAttribute('data-cube3d-zoom', '2.5000');
  await page.mouse.wheel(0, 10_000);
  await expect(scene).toHaveAttribute('data-cube3d-zoom', '0.6500');

  // An arbitrary diagonal drag exposes edge/corner views without changing gameplay.
  const rotationBefore = await scene.getAttribute('data-cube3d-rotation');
  center = await canvasCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 120, center.y - 90, { steps: 8 });
  await page.mouse.up();
  await expect(scene).not.toHaveAttribute('data-cube3d-rotation', rotationBefore ?? '');
  await expect(page.getByText('Move 8', { exact: true })).toBeVisible();
});
