import { expect, test, type Locator, type Page } from '@playwright/test';

const requiredBox = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

const dragViewportBy = async (page: Page, viewport: Locator, dx: number, dy: number) => {
  const box = await requiredBox(viewport);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = Math.max(box.x + 24, Math.min(box.x + box.width - 24, startX + dx));
  const endY = Math.max(box.y + 24, Math.min(box.y + box.height - 24, startY + dy));

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
};

test('Cube 2D drag-pan is not clamped by the board viewport or sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube 2D', exact: true }).click();
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

  for (let index = 0; index < 7; index += 1) {
    await dragViewportBy(page, viewport, -320, -220);
  }

  const pan = {
    x: Number(await viewport.getAttribute('data-pan-x')),
    y: Number(await viewport.getAttribute('data-pan-y')),
  };
  expect(pan.x).toBeLessThan(-formerClamp.maxX - 200);
  expect(pan.y).toBeLessThan(-formerClamp.maxY - 200);

  const escaped = await page.evaluate(() => {
    const bounds = document
      .querySelector<HTMLElement>('.cube-2d-game__navigation-layer')!
      .getBoundingClientRect();
    return {
      right: bounds.right,
      bottom: bounds.bottom,
    };
  });
  expect(escaped.right).toBeLessThan(0);
  expect(escaped.bottom).toBeLessThan(0);

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
