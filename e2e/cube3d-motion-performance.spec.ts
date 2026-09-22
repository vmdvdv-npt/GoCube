import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

test('motion bounds drawing-buffer work and restores full resolution when settled', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByLabel('Cube 3D scene')).toHaveCount(1);
  for (let frame = 0; frame < 110; frame++) {
    await page.clock.runFor(16);
    if (Number(await page.locator('.cube-view-fold').getAttribute('data-fold-blend')) > 0.3) break;
  }
  const canvas = page.locator('[data-testid="cube-3d-canvas"]');
  const measure = () => canvas.evaluate(node => {
    const surface = node as HTMLCanvasElement;
    return { pixels: surface.width * surface.height, width: surface.width, cssWidth: surface.clientWidth };
  });
  const motion = await measure();
  expect(motion.pixels).toBeLessThanOrEqual(1_500_000);
  expect(motion.width).toBeLessThanOrEqual(motion.cssWidth);
  // Closed hinges must stop rewriting all six face transforms while the parent turns.
  await page.locator('.cube-view-fold__root').evaluate(root => {
    const counter = { changes: 0 };
    Object.assign(window, { foldMutationCounter: counter });
    const observer = new MutationObserver(records => { counter.changes += records.length; });
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['style'] });
    Object.assign(window, { foldMutationObserver: observer });
  });
  await page.clock.runFor(80);
  const mutations = await page.evaluate(() => {
    const state = window as unknown as { foldMutationCounter: { changes: number }; foldMutationObserver: MutationObserver };
    state.foldMutationObserver.disconnect();
    return state.foldMutationCounter.changes;
  });
  expect(mutations).toBeLessThanOrEqual(6); // Only the parent's transform, once per frame.
  await page.clock.runFor(1200);
  await expect(page.locator('.cube-view-fold')).toHaveCount(0);
  const settled = await measure();
  expect(settled.width).toBe(settled.cssWidth * 2);
  expect(motion.pixels / settled.pixels).toBeLessThanOrEqual(0.25);
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -80);
  await page.clock.runFor(16);
  expect((await measure()).pixels).toBeLessThanOrEqual(1_500_000);
  await page.clock.runFor(160);
  expect((await measure()).width).toBe(settled.width);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 70, bounds.y + bounds.height / 2 + 30);
  expect((await measure()).pixels).toBeLessThanOrEqual(1_500_000);
  await page.mouse.up();
  expect((await measure()).width).toBe(settled.width);
  console.log('CUBE_MOTION_PIXEL_BUDGET', JSON.stringify({ motionPixels: motion.pixels, restingPixels: settled.pixels }));
});
