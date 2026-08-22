import { expect, test, type Locator, type Page } from '@playwright/test';

const requiredBox = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

const dragViewportCenterToTopLeft = async (page: Page, viewport: Locator) => {
  const box = await requiredBox(viewport);
  const inset = 32;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = box.x + inset;
  const endY = box.y + inset;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
};

const currentPan = async (viewport: Locator) => ({
  x: Number(await viewport.getAttribute('data-pan-x')),
  y: Number(await viewport.getAttribute('data-pan-y')),
});

test('Cube 2D drag-pan is not clamped by the board viewport or sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const sidebar = page.locator('.game-summary');
  const viewport = page.locator('.cube-2d-game__viewport');
  const sidebarBefore = await requiredBox(sidebar);

  await viewport.hover();
  await page.mouse.wheel(0, -250);
  await expect(viewport).toHaveAttribute('data-view-zoom', '1.200');

  const formerClamp = await page.evaluate(() => {
    const viewportElement = document.querySelector<HTMLElement>('.cube-2d-game__viewport')!;
    const navigationElement = document.querySelector<HTMLElement>('.cube-2d-game__navigation-layer')!;
    return {
      maxX: Math.max(0, (navigationElement.offsetWidth - viewportElement.clientWidth) / 2),
      maxY: Math.max(0, (navigationElement.offsetHeight - viewportElement.clientHeight) / 2),
    };
  });

  await dragViewportCenterToTopLeft(page, viewport);

  const pan = await currentPan(viewport);
  expect(pan.x).toBeLessThan(-formerClamp.maxX - 200);
  expect(pan.y).toBeLessThan(-formerClamp.maxY - 200);

  const movedGeometry = await page.evaluate(() => {
    const bounds = document
      .querySelector<HTMLElement>('.cube-2d-game__navigation-layer')!
      .getBoundingClientRect();
    const sidebarBounds = document.querySelector<HTMLElement>('.game-summary')!.getBoundingClientRect();
    return {
      navigationLeft: bounds.left,
      navigationTop: bounds.top,
      sidebarRight: sidebarBounds.right,
    };
  });
  expect(movedGeometry.navigationLeft).toBeLessThan(movedGeometry.sidebarRight);
  expect(movedGeometry.navigationTop).toBeLessThan(0);

  const sidebarAfter = await requiredBox(sidebar);
  expect(sidebarAfter.x).toBeCloseTo(sidebarBefore.x, 0);
  expect(sidebarAfter.y).toBeCloseTo(sidebarBefore.y, 0);
  expect(sidebarAfter.width).toBeCloseTo(sidebarBefore.width, 0);
  expect(sidebarAfter.height).toBeCloseTo(sidebarBefore.height, 0);

  const pageMetrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    sidebarZ: Number(getComputedStyle(document.querySelector('.game-summary')!).zIndex),
    playfieldZ: Number(
      getComputedStyle(document.querySelector('.cube-2d-game__board-shell')!).zIndex,
    ),
  }));
  expect(pageMetrics.sidebarZ).toBeGreaterThan(pageMetrics.playfieldZ);
  expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.innerWidth);
  expect(pageMetrics.scrollHeight).toBeLessThanOrEqual(pageMetrics.innerHeight);
});

test('Cube 2D re-grab cancels native browser drag instead of losing pan', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const viewport = page.locator('.cube-2d-game__viewport');
  const navigationLayer = page.locator('.cube-2d-game__navigation-layer');
  await viewport.hover();
  await page.mouse.wheel(0, -500);

  const box = await requiredBox(viewport);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 80, { steps: 8 });
  await page.mouse.up();
  await expect(viewport).toHaveAttribute('data-dragging', 'false');

  const firstPan = await currentPan(viewport);
  expect(firstPan.x).toBeGreaterThan(90);
  expect(firstPan.y).toBeGreaterThan(60);

  const anchorColumnBefore = await navigationLayer.getAttribute('data-vertical-anchor-column');
  const anchorSlot = page.getByRole('button', {
    name: 'Move top and bottom to column 3 using top slot',
  });
  const slotBox = await requiredBox(anchorSlot);
  const slotX = slotBox.x + slotBox.width / 2;
  const slotY = slotBox.y + slotBox.height / 2;

  // Force the same browser-native drag path that produces Chrome's prohibited-drop cursor.
  // Cube pan must own the pointer gesture first and cancel dragstart before it can cancel
  // the pointer stream. Short presses still remain normal button clicks.
  await anchorSlot.evaluate((element) => {
    (element as HTMLElement).draggable = true;
  });
  await page.mouse.move(slotX, slotY);
  await page.mouse.down();

  const nativeDragPrevented = await anchorSlot.evaluate((element) => {
    const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(nativeDragPrevented).toBe(true);

  await page.mouse.move(slotX + 90, slotY + 50, { steps: 8 });
  await page.mouse.up();
  await expect(viewport).toHaveAttribute('data-dragging', 'false');

  const secondPan = await currentPan(viewport);
  expect(secondPan.x).toBeGreaterThan(firstPan.x + 70);
  expect(secondPan.y).toBeGreaterThan(firstPan.y + 30);
  await expect(navigationLayer).toHaveAttribute(
    'data-vertical-anchor-column',
    anchorColumnBefore ?? '',
  );
});