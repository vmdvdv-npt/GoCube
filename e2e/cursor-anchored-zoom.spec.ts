import { expect, test, type Locator } from '@playwright/test';

const requiredBox = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

test('Cube wheel zoom works on black playfield space and keeps the pointer as the zoom anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const viewport = page.locator('.cube-2d-game__viewport');
  const viewportBox = await requiredBox(viewport);
  const anchor = {
    x: viewportBox.x + viewportBox.width - 24,
    y: viewportBox.y + 24,
  };

  const target = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      insideViewport: Boolean(element?.closest('.cube-2d-game__viewport')),
      overBoard: Boolean(element?.closest('.cube-2d-board')),
    };
  }, anchor);
  expect(target.insideViewport).toBe(true);
  expect(target.overBoard).toBe(false);

  const expectedZoom = 1.2;
  const centerX = viewportBox.x + viewportBox.width / 2;
  const centerY = viewportBox.y + viewportBox.height / 2;
  const expectedPanX = (anchor.x - centerX) * (1 - expectedZoom);
  const expectedPanY = (anchor.y - centerY) * (1 - expectedZoom);

  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -250);

  await expect(viewport).toHaveAttribute('data-view-zoom', '1.200');
  await expect.poll(async () => Number(await viewport.getAttribute('data-pan-x'))).toBeCloseTo(
    expectedPanX,
    0,
  );
  await expect.poll(async () => Number(await viewport.getAttribute('data-pan-y'))).toBeCloseTo(
    expectedPanY,
    0,
  );
});

test('Torus wheel zoom works on black playfield space, anchors to the pointer, and ignores the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start game' }).click();

  const game = page.locator('.torus-game');
  const shell = page.locator('.torus-board-shell');
  const sidebar = page.locator('.game-summary');
  const gameBox = await requiredBox(game);
  const shellBox = await requiredBox(shell);
  const sidebarBox = await requiredBox(sidebar);
  const anchor = {
    x: gameBox.x + gameBox.width - 24,
    y: gameBox.y + 24,
  };

  expect(anchor.x).toBeGreaterThan(shellBox.x + shellBox.width);
  expect(anchor.x).toBeGreaterThan(sidebarBox.x + sidebarBox.width);

  const target = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      insideGame: Boolean(element?.closest('.torus-game')),
      overBoardShell: Boolean(element?.closest('.torus-board-shell')),
    };
  }, anchor);
  expect(target.insideGame).toBe(true);
  expect(target.overBoardShell).toBe(false);

  const wheelDelta = -120;
  const expectedZoom = Math.exp(-wheelDelta * 0.0015);
  const centerX = shellBox.x + shellBox.width / 2;
  const centerY = shellBox.y + shellBox.height / 2;
  const expectedPanX = (anchor.x - centerX) * (1 - expectedZoom);
  const expectedPanY = (anchor.y - centerY) * (1 - expectedZoom);

  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, wheelDelta);

  await expect.poll(async () => Number(await shell.getAttribute('data-view-zoom'))).toBeCloseTo(
    expectedZoom,
    2,
  );
  await expect.poll(async () => Number(await shell.getAttribute('data-pan-x'))).toBeCloseTo(
    expectedPanX,
    0,
  );
  await expect.poll(async () => Number(await shell.getAttribute('data-pan-y'))).toBeCloseTo(
    expectedPanY,
    0,
  );

  const zoomBeforeSidebarWheel = await shell.getAttribute('data-view-zoom');
  await page.mouse.move(
    sidebarBox.x + sidebarBox.width / 2,
    sidebarBox.y + sidebarBox.height / 2,
  );
  await page.mouse.wheel(0, -250);
  await expect(shell).toHaveAttribute('data-view-zoom', zoomBeforeSidebarWheel!);
});
