import { expect, test, type Page } from '@playwright/test';
import * as THREE from 'three';
import { SHARED_3D_BASE_CAMERA_DISTANCE } from '../src/renderer3d/Shared3DSceneCore';
import { torus3DSurfacePoint } from '../src/renderer3d/Torus3DSurfaceMapping';

const torusViewButton = (page: Page, mode: '2D' | '3D') =>
  page.getByRole('group', { name: 'Torus view' }).getByRole('button', { name: mode });

const startTorusGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
  await expect(torusViewButton(page, '3D')).toHaveAttribute('aria-pressed', 'true');
};

const primaryStone = (page: Page, pointId: string) =>
  page.locator(
    `.torus-board__stone[data-logical-point-id="${pointId}"][data-copy-role="primary"]`,
  );

const click2DPoint = async (page: Page, pointId: string): Promise<void> => {
  await page.locator(
    `.torus-board__hit-target[data-logical-point-id="${pointId}"][data-copy-role="primary"]`,
  ).click();
};

const switchTorusView = async (page: Page, mode: '2D' | '3D'): Promise<void> => {
  const button = torusViewButton(page, mode);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  if (mode === '2D') {
    await expect(page.getByLabel('Torus 3D scene')).toHaveCount(0);
  }
};

const waitForTorus3DReady = async (page: Page) => {
  const scene = page.getByLabel('Torus 3D scene');
  await expect(scene).toHaveAttribute('data-torus3d-ready', 'true');
  await expect(page.getByTestId('torus-3d-canvas')).toBeVisible();
  // The view buttons remain disabled through the one-time startup appearance.
  await expect(torusViewButton(page, '2D')).toBeEnabled();
  await expect(scene).toHaveAttribute('data-torus3d-transitioning', 'false');
  return scene;
};

const projected3DPoint = async (
  page: Page,
  pointId: string,
): Promise<Readonly<{ pointId: string; x: number; y: number }>> => {
  const scene = await waitForTorus3DReady(page);
  const canvas = page.getByTestId('torus-3d-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Torus 3D canvas has no bounds');

  const rotationText = await scene.getAttribute('data-torus3d-rotation');
  const zoomText = await scene.getAttribute('data-torus3d-zoom');
  const rotation = rotationText?.split(',').map(Number);
  const zoom = Number(zoomText);
  if (
    !rotation ||
    rotation.length !== 4 ||
    rotation.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    throw new Error('Torus 3D view diagnostics are not ready');
  }

  const sample = torus3DSurfacePoint(9, pointId);
  const worldPosition = new THREE.Vector3(
    sample.position.x,
    sample.position.y,
    sample.position.z,
  ).applyQuaternion(new THREE.Quaternion(
    rotation[0]!,
    rotation[1]!,
    rotation[2]!,
    rotation[3]!,
  ).normalize());
  const camera = new THREE.PerspectiveCamera(45, bounds.width / bounds.height, 0.1, 100);
  camera.position.set(0, 0, SHARED_3D_BASE_CAMERA_DISTANCE / zoom);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  worldPosition.project(camera);

  return Object.freeze({
    pointId,
    x: bounds.x + ((worldPosition.x + 1) / 2) * bounds.width,
    y: bounds.y + ((1 - worldPosition.y) / 2) * bounds.height,
  });
};

const hoverAllowed3DPoint = async (page: Page, pointId: string) => {
  const scene = await waitForTorus3DReady(page);
  const point = await projected3DPoint(page, pointId);
  await page.mouse.move(point.x, point.y);
  await expect(scene).toHaveAttribute('data-torus3d-hovered-point', pointId);
  await expect(scene).toHaveAttribute('data-torus3d-hover-status', 'allowed');
  return point;
};

test('new Torus starts in 3D and shares one GameSession with Torus 2D', async ({ page }) => {
  await startTorusGame(page);

  const scene = await waitForTorus3DReady(page);
  await expect(scene).toHaveAttribute('data-torus3d-grid-lines-first', '9');
  await expect(scene).toHaveAttribute('data-torus3d-grid-lines-second', '9');
  await expect(scene).toHaveAttribute('data-torus3d-black-stone-count', '0');
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '0');

  const black = await hoverAllowed3DPoint(page, '0,0');
  await page.mouse.click(black.x, black.y);
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-black-stone-count', '1');
  await expect(scene).toHaveAttribute('data-torus3d-last-move-point', black.pointId);

  const white = await hoverAllowed3DPoint(page, '1,0');
  await page.mouse.click(white.x, white.y);
  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '1');

  await page.getByLabel('Board display options').getByText('Move numbers').click();
  await expect(scene).toHaveAttribute('data-torus3d-move-number-count', '2');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '0');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '1');

  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(page.getByText('Move 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();

  await switchTorusView(page, '2D');
  await expect(primaryStone(page, black.pointId)).toHaveCount(1);
  await expect(primaryStone(page, white.pointId)).toHaveCount(1);

  await click2DPoint(page, '2,0');
  await expect(page.getByText('Move 3', { exact: true })).toBeVisible();
  await switchTorusView(page, '3D');
  const returnedScene = await waitForTorus3DReady(page);
  await expect(returnedScene).toHaveAttribute('data-torus3d-black-stone-count', '2');
  await expect(returnedScene).toHaveAttribute('data-torus3d-white-stone-count', '1');
});

test('Torus 3D preserves spatial anchor and manual zoom across 3D to 2D to 3D', async ({ page }) => {
  await startTorusGame(page);
  let scene = await waitForTorus3DReady(page);
  const canvas = page.getByTestId('torus-3d-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const centerX = bounds!.x + bounds!.width / 2;
  const centerY = bounds!.y + bounds!.height / 2;

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 80, centerY + 55, { steps: 4 });
  await page.mouse.up();
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -220);

  const anchorBefore = await scene.getAttribute('data-torus3d-anchor');
  const zoomBefore = await scene.getAttribute('data-torus3d-zoom');
  expect(anchorBefore).toBeTruthy();
  expect(zoomBefore).toBeTruthy();
  await expect(page.getByText('Move 0', { exact: true })).toBeVisible();

  await switchTorusView(page, '2D');
  await switchTorusView(page, '3D');
  scene = await waitForTorus3DReady(page);
  await expect(scene).toHaveAttribute('data-torus3d-anchor', anchorBefore!);
  await expect(scene).toHaveAttribute('data-torus3d-zoom', zoomBefore!);
  await expect(page.getByText('Move 0', { exact: true })).toBeVisible();
});

test('Torus 3D navigation and Reset View change only ViewState', async ({ page }) => {
  await startTorusGame(page);
  const scene = await waitForTorus3DReady(page);
  const initialAnchor = await scene.getAttribute('data-torus3d-anchor');

  await page.getByRole('button', { name: 'Move Torus 3D right' }).click();
  await expect(scene).toHaveAttribute('data-torus3d-transitioning', 'false');
  await expect(scene).not.toHaveAttribute('data-torus3d-anchor', initialAnchor ?? '');
  await expect(page.getByText('Move 0', { exact: true })).toBeVisible();

  const canvas = page.getByTestId('torus-3d-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, -200);
  await expect(scene).not.toHaveAttribute('data-torus3d-zoom', '1.0000');

  await page.getByRole('button', { name: 'Reset Torus 3D view' }).click();
  await expect(scene).toHaveAttribute('data-torus3d-transitioning', 'false');
  await expect(scene).toHaveAttribute('data-torus3d-zoom', '1.0000');
  await expect(page.getByText('Move 0', { exact: true })).toBeVisible();
});

test('rapid Torus 2D 3D switching leaves only the last requested renderer active', async ({ page }) => {
  await startTorusGame(page);
  await waitForTorus3DReady(page);

  await torusViewButton(page, '2D').click();
  await torusViewButton(page, '3D').click();
  await torusViewButton(page, '2D').click();
  await torusViewButton(page, '3D').click();

  await expect(torusViewButton(page, '3D')).toHaveAttribute('aria-pressed', 'true');
  await waitForTorus3DReady(page);
  await expect(page.getByTestId('torus-3d-canvas')).toHaveCount(1);
  await expect(page.locator('.torus-3d-overlay')).toHaveCount(1);
  await expect(page.getByText('Move 0', { exact: true })).toBeVisible();
});

test('Torus 3D projects authoritative captures made in shared Torus 2D', async ({ page }) => {
  await startTorusGame(page);
  await waitForTorus3DReady(page);
  await switchTorusView(page, '2D');
  for (const pointId of ['1,1', '0,1', '5,5', '1,0', '5,6', '2,1', '6,5', '1,2']) {
    await click2DPoint(page, pointId);
  }
  await expect(page.getByLabel('Black stones captured: 1')).toBeVisible();
  await switchTorusView(page, '3D');
  const scene = await waitForTorus3DReady(page);
  await expect(scene).toHaveAttribute('data-torus3d-black-stone-count', '3');
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '4');
  await expect(scene).toHaveAttribute('data-torus3d-phase', 'playing');
});
