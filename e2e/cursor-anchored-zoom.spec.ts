import { expect, test, type Locator, type Page } from '@playwright/test';

const requiredBox = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

const boxCenter = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

const expectCenterAt = async (
  locator: Locator,
  expected: { x: number; y: number },
  tolerance = 2,
) => {
  const center = boxCenter(await requiredBox(locator));
  expect(Math.abs(center.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(center.y - expected.y)).toBeLessThanOrEqual(tolerance);
};

const startCube = async (page: Page) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
};

test('Cube wheel zoom works on black playfield space and keeps the pointer as the zoom anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startCube(page);

  const viewport = page.locator('.cube-2d-game__viewport');
  const viewportBox = await requiredBox(viewport);
  const anchor = {
    x: viewportBox.x + viewportBox.width - 24,
    y: viewportBox.y + 80,
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

test('Cube keeps a real board point pinned through repeated zoom-in all the way to 4.05x', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startCube(page);

  const viewport = page.locator('.cube-2d-game__viewport');
  const target = page
    .locator('.cube-2d-board[data-central="true"] .cube-2d-hit-area')
    .first();
  const anchor = boxCenter(await requiredBox(target));

  await page.mouse.move(anchor.x, anchor.y);
  for (let index = 0; index < 20; index += 1) {
    await page.mouse.wheel(0, -250);
  }

  await expect(viewport).toHaveAttribute('data-view-zoom', '4.050');
  await expectCenterAt(target, anchor);

  const layer = await requiredBox(page.locator('.cube-2d-game__navigation-layer'));
  const viewportBox = await requiredBox(viewport);
  expect(layer.width).toBeGreaterThan(viewportBox.width);
  expect(layer.height).toBeGreaterThan(viewportBox.height);
});

test('Cube zoom-out returns the cross toward the initial centered home position independent of cursor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startCube(page);

  const viewport = page.locator('.cube-2d-game__viewport');
  const navigationLayer = page.locator('.cube-2d-game__navigation-layer');
  const target = page
    .locator('.cube-2d-board[data-central="true"] .cube-2d-hit-area')
    .nth(5);
  const anchor = boxCenter(await requiredBox(target));

  await page.mouse.move(anchor.x, anchor.y);
  for (let index = 0; index < 5; index += 1) {
    await page.mouse.wheel(0, -250);
  }
  await expect(viewport).toHaveAttribute('data-view-zoom', '2.000');
  await expectCenterAt(target, anchor);

  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 120, anchor.y + 80, { steps: 8 });
  await page.mouse.up();

  const currentPanX = Number(await viewport.getAttribute('data-pan-x'));
  const currentPanY = Number(await viewport.getAttribute('data-pan-y'));
  expect(Math.abs(currentPanX) + Math.abs(currentPanY)).toBeGreaterThan(100);

  const viewportBox = await requiredBox(viewport);
  const deliberatelyOffCenterCursor = {
    x: viewportBox.x + viewportBox.width - 24,
    y: viewportBox.y + viewportBox.height - 24,
  };
  await page.mouse.move(deliberatelyOffCenterCursor.x, deliberatelyOffCenterCursor.y);
  await page.mouse.wheel(0, 250);

  await expect(viewport).toHaveAttribute('data-view-zoom', '1.800');
  await expect.poll(async () => Number(await viewport.getAttribute('data-pan-x'))).toBeCloseTo(
    currentPanX * 0.8,
    0,
  );
  await expect.poll(async () => Number(await viewport.getAttribute('data-pan-y'))).toBeCloseTo(
    currentPanY * 0.8,
    0,
  );

  await page.mouse.wheel(0, 1000);
  await expect(viewport).toHaveAttribute('data-view-zoom', '1.000');
  await expect(viewport).toHaveAttribute('data-pan-x', '0.0');
  await expect(viewport).toHaveAttribute('data-pan-y', '0.0');

  const homeViewportBox = await requiredBox(viewport);
  const homeLayerBox = await requiredBox(navigationLayer);
  await expectCenterAt(navigationLayer, boxCenter(homeViewportBox));
  expect(boxCenter(homeLayerBox).x).toBeCloseTo(boxCenter(homeViewportBox).x, 0);
  expect(boxCenter(homeLayerBox).y).toBeCloseTo(boxCenter(homeViewportBox).y, 0);

  await page.mouse.wheel(0, 500);
  await expect(viewport).toHaveAttribute('data-view-zoom', '0.780');
  await expect(viewport).toHaveAttribute('data-pan-x', '0.0');
  await expect(viewport).toHaveAttribute('data-pan-y', '0.0');
  await expectCenterAt(navigationLayer, boxCenter(await requiredBox(viewport)));
});

test('Cube preserves the pointer anchor after drag-pan and accumulates a rapid wheel burst', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startCube(page);

  const viewport = page.locator('.cube-2d-game__viewport');
  const target = page
    .locator('.cube-2d-board[data-central="true"] .cube-2d-hit-area')
    .nth(5);
  const initial = boxCenter(await requiredBox(target));

  await page.mouse.move(initial.x, initial.y);
  await page.mouse.down();
  await page.mouse.move(initial.x + 120, initial.y + 80, { steps: 8 });
  await page.mouse.up();

  const afterPan = boxCenter(await requiredBox(target));
  expect(afterPan.x - initial.x).toBeGreaterThan(100);
  expect(afterPan.y - initial.y).toBeGreaterThan(60);

  await page.evaluate(({ x, y }) => {
    const viewportElement = document.querySelector<HTMLElement>('.cube-2d-game__viewport');
    if (!viewportElement) throw new Error('Cube viewport missing');
    for (let index = 0; index < 10; index += 1) {
      viewportElement.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          deltaY: -50,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        }),
      );
    }
  }, afterPan);

  await expect(viewport).toHaveAttribute('data-view-zoom', '1.400');
  await expectCenterAt(target, afterPan);
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
    y: gameBox.y + 80,
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
