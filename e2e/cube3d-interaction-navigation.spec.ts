import { expect, test, type Page } from '@playwright/test';
import type { CubeFace } from '../src/core/topology/CubeTopology';
import { cubeOrientationAnchorToQuaternion } from '../src/presentation/cube/Cube3DViewState';

const CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS = 30_000;

const startCubeGame = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
};

const cubeGame = (page: Page) => page.getByRole('region', { name: 'Cube game' });
const cubeViewSwitch = (page: Page) => page.getByRole('group', { name: 'Cube view' });

const waitForViewTransition = async (page: Page) => {
  await expect(cubeGame(page)).toHaveAttribute('data-cube-view-transitioning', 'false', {
    timeout: CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS,
  });
};

const enter3D = async (page: Page) => {
  await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
  await waitForViewTransition(page);
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1, {
    timeout: CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS,
  });
};

const canonicalRotationDataset = (anchor: string): string => {
  const [centerFace, upFace] = anchor.split(':') as [CubeFace, CubeFace];
  const rotation = cubeOrientationAnchorToQuaternion({ centerFace, upFace });
  return [rotation.x, rotation.y, rotation.z, rotation.w]
    .map((value) => value.toFixed(6))
    .join(',');
};

test('Cube 3D interaction polish preserves gameplay while navigating and resetting', async ({ page }) => {
  await startCubeGame(page);
  await enter3D(page);

  const scene = page.getByLabel('Cube 3D scene');
  const canvas = page.locator('[data-testid="cube-3d-canvas"]');
  const initialBounds = await canvas.boundingBox();
  expect(initialBounds).not.toBeNull();
  if (!initialBounds) return;

  const centerX = initialBounds.x + initialBounds.width / 2;
  const centerY = initialBounds.y + initialBounds.height / 2;

  await page.mouse.click(centerX, centerY);
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 160, centerY, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();

  const zoomBefore = await scene.getAttribute('data-cube3d-zoom');
  const boardBounds = await page.getByLabel('Cube 3D view', { exact: true }).boundingBox();
  expect(boardBounds).not.toBeNull();
  if (!boardBounds) return;
  await page.mouse.move(boardBounds.x + 20, boardBounds.y + boardBounds.height / 2);
  await page.mouse.wheel(0, -220);
  const zoomed = await scene.getAttribute('data-cube3d-zoom');
  expect(zoomed).not.toBe(zoomBefore);

  const moveUp = page.getByRole('button', { name: 'Move Cube 3D up' });
  await moveUp.click();
  await waitForViewTransition(page);
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();

  const navigatedAnchor = await scene.getAttribute('data-cube3d-anchor');
  expect(navigatedAnchor).toBeTruthy();
  if (!navigatedAnchor) return;
  await expect(scene).toHaveAttribute(
    'data-cube3d-rotation',
    canonicalRotationDataset(navigatedAnchor),
  );
  await expect(scene).toHaveAttribute('data-cube3d-zoom', zoomed ?? '');

  const navigatedBounds = await canvas.boundingBox();
  expect(navigatedBounds).not.toBeNull();
  if (!navigatedBounds) return;
  await page.mouse.click(
    navigatedBounds.x + navigatedBounds.width / 2,
    navigatedBounds.y + navigatedBounds.height / 2,
  );
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Reset Cube 3D view' }).click();
  await waitForViewTransition(page);
  await expect(scene).toHaveAttribute('data-cube3d-anchor', 'front:top');
  await expect(scene).toHaveAttribute('data-cube3d-rotation', '0.000000,0.000000,0.000000,1.000000');
  await expect(scene).toHaveAttribute('data-cube3d-zoom', '1.0000');
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();

  await cubeViewSwitch(page).getByRole('button', { name: '2D' }).click();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(0);
  await expect(page.locator('.cube-2d-stone')).toHaveCount(2);
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();
});
