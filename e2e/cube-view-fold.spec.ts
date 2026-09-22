import { expect, test } from '@playwright/test';

for (const anchor of [0, 1, 2, 3]) {
  test(`folds from cross column ${anchor + 1} and restores the net`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Cube', exact: true }).click();
    await page.getByRole('button', { name: '3×3', exact: true }).click();
    await page.getByRole('button', { name: 'Start game' }).click();
    const game = page.getByRole('region', { name: 'Cube game' });
    await page.locator('.cube-2d-hit-area[data-point-id="front:1:1"]').click();
    if (anchor !== 1) {
      await page.locator(`.cube-2d-anchor-slot[data-layout-row="0"][data-layout-column="${anchor}"]`).click();
      await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'false');
    }
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(game).toHaveAttribute('data-cube-view-transitioning', 'true');
    await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeDisabled();
    await expect(page.locator('.cube-view-fold')).toHaveAttribute('data-fold-anchor', String(anchor));
    await expect(game).toHaveAttribute('data-cube-view-transitioning', 'false', { timeout: 30_000 });
    await expect(page.getByLabel('Cube 3D scene')).toHaveAttribute('data-cube3d-anchor', `${['left', 'front', 'right', 'back'][anchor]}:top`);
    await expect(page.getByLabel('Cube 3D scene')).toHaveAttribute('data-cube3d-black-stone-count', '1');
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await expect(game).toHaveAttribute('data-cube-view-transitioning', 'false', { timeout: 30_000 });
    await expect(page.locator('.cube-view-fold')).toHaveCount(0);
    await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-vertical-anchor-column', String(anchor));
    await expect(page.locator('.cube-2d-stone[data-logical-point-id="front:1:1"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled();
  });
}

test('reduced motion switches without a folding overlay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByLabel('Cube 3D scene')).toBeVisible();
  await expect(page.locator('.cube-view-fold')).toHaveCount(0);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.locator('.cube-2d-renderer')).toBeVisible();
  await expect(page.locator('.cube-view-fold')).toHaveCount(0);
});

test('cross-fades both representations in the same moving pose and restores input', async ({ page }) => {
  test.setTimeout(60_000); // Frame-by-frame software WebGL inspection.
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByLabel('Cube 3D scene')).toHaveCount(1);
  let foundBlend = false;
  for (let frame = 0; frame < 110; frame++) {
    await page.clock.runFor(16);
    const blend = await page.locator('.cube-view-fold').getAttribute('data-fold-blend');
    if (Number(blend) > 0.3 && Number(blend) < 0.8) { foundBlend = true; break; }
  }
  expect(foundBlend).toBe(true);
  const scene = page.getByLabel('Cube 3D scene');
  const rotation = await scene.getAttribute('data-cube3d-transition-rotation');
  const yaw = Number(await page.locator('.cube-view-fold').getAttribute('data-fold-yaw'));
  expect(Math.abs(yaw)).toBeGreaterThan(0.3);
  const canvasOpacity = await page.locator('[data-testid="cube-3d-canvas"]').evaluate(node => Number(getComputedStyle(node).opacity));
  expect(canvasOpacity).toBeGreaterThan(0.3);
  expect(canvasOpacity).toBeLessThan(0.8);
  await page.clock.runFor(80);
  expect(Number(await page.locator('.cube-view-fold').getAttribute('data-fold-yaw'))).toBeLessThan(yaw);
  await expect(scene).not.toHaveAttribute('data-cube3d-transition-rotation', rotation!);
  await page.clock.runFor(1000);
  await expect(page.locator('.cube-view-fold')).toHaveCount(0);
  await expect(scene).toHaveAttribute('data-cube3d-rotation', '0.000000,0.000000,0.000000,1.000000');
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled();
});

test('cold 3D loading keeps the original net visible until the textured frame is ready', async ({ page }) => {
  let releaseModule!: () => void;
  let releaseTexture!: () => void;
  const moduleGate = new Promise<void>(resolve => { releaseModule = resolve; });
  const textureGate = new Promise<void>(resolve => { releaseTexture = resolve; });
  await page.route('**/renderer3d/ThreeScene.tsx*', async route => { await moduleGate; await route.continue(); });
  await page.route('**/assets/board/cube-walnut.png', async route => { await textureGate; await route.continue(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  const net = page.locator('.cube-2d-game__stage .cube-2d-renderer');
  const bounds = await net.boundingBox();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(net).toBeVisible();
  await expect(page.locator('.cube-3d-board-shell')).toBeHidden();
  expect(await net.boundingBox()).toEqual(bounds);
  releaseModule();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);
  await expect(net).toBeVisible();
  await expect(page.locator('.cube-3d-board-shell')).toBeHidden();
  expect(await net.boundingBox()).toEqual(bounds);
  releaseTexture();
  await expect(page.getByRole('region', { name: 'Cube game' })).toHaveAttribute('data-cube-view-transitioning', 'false', { timeout: 30_000 });
  await expect(page.getByLabel('Cube 3D scene')).toBeVisible();
});

test('a missing wood texture does not leave switching locked', async ({ page }) => {
  await page.route('**/assets/board/cube-walnut.png', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Cube game' })).toHaveAttribute('data-cube-view-transitioning', 'false', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Pass', exact: true })).toBeEnabled();
});
