import { expect, test, type Locator, type Page } from '@playwright/test';

const requiredBox = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

const expectBoxStable = (
  before: { x: number; y: number; width: number; height: number },
  after: { x: number; y: number; width: number; height: number },
) => {
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect(after.height).toBeCloseTo(before.height, 0);
};

const expectNoDocumentScrollbars = async (page: Page) => {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    shellOverflow: getComputedStyle(document.querySelector('.app-shell--game')!).overflow,
  }));

  expect(metrics.shellOverflow).toBe('hidden');
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.innerHeight);
};

const expectCubeNavigationAnchored = async (page: Page) => {
  const leftBoard = await requiredBox(
    page.locator('.cube-2d-board[data-layout-row="1"][data-layout-column="0"]'),
  );
  const rightBoard = await requiredBox(
    page.locator('.cube-2d-board[data-layout-row="1"][data-layout-column="3"]'),
  );
  const topBoard = await requiredBox(page.locator('.cube-2d-board[data-layout-row="0"]'));
  const bottomBoard = await requiredBox(page.locator('.cube-2d-board[data-layout-row="2"]'));
  const leftArrow = await requiredBox(page.getByRole('button', { name: 'Move cube left' }));
  const rightArrow = await requiredBox(page.getByRole('button', { name: 'Move cube right' }));
  const upArrow = await requiredBox(page.getByRole('button', { name: 'Move cube up' }));
  const downArrow = await requiredBox(page.getByRole('button', { name: 'Move cube down' }));

  expect(leftBoard.x - (leftArrow.x + leftArrow.width)).toBeCloseTo(30, 0);
  expect(rightArrow.x - (rightBoard.x + rightBoard.width)).toBeCloseTo(30, 0);
  expect(topBoard.y - (upArrow.y + upArrow.height)).toBeCloseTo(30, 0);
  expect(downArrow.y - (bottomBoard.y + bottomBoard.height)).toBeCloseTo(30, 0);
};

test('Torus wheel zoom scales the board and arrows while the sidebar stays fixed and viewport has no scrollbars', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start game' }).click();

  const sidebar = page.locator('.game-summary');
  const shell = page.locator('.torus-board-shell');
  const upArrow = page.getByRole('button', { name: 'Shift torus view up' });
  const board = page.locator('.torus-board');

  const sidebarBefore = await requiredBox(sidebar);
  const shellBefore = await requiredBox(shell);
  const arrowBefore = await requiredBox(upArrow);

  await board.hover();
  await page.mouse.wheel(0, -250);
  await expect(shell).not.toHaveAttribute('data-view-zoom', '1.000');
  const zoom = Number(await shell.getAttribute('data-view-zoom'));
  await expect.poll(async () => (await shell.boundingBox())?.width ?? 0).toBeCloseTo(
    shellBefore.width * zoom,
    0,
  );

  const sidebarAfter = await requiredBox(sidebar);
  const shellAfter = await requiredBox(shell);
  const arrowAfter = await requiredBox(upArrow);

  expectBoxStable(sidebarBefore, sidebarAfter);
  expect(shellAfter.width).toBeGreaterThan(shellBefore.width * 1.2);
  expect(shellAfter.height).toBeGreaterThan(shellBefore.height * 1.2);
  expect(arrowAfter.width).toBeGreaterThan(arrowBefore.width * 1.2);

  const stacking = await page.evaluate(() => ({
    sidebar: Number(getComputedStyle(document.querySelector('.game-summary')!).zIndex),
    board: Number(getComputedStyle(document.querySelector('.torus-board-shell')!).zIndex),
  }));
  expect(stacking.sidebar).toBeGreaterThan(stacking.board);
  await expectNoDocumentScrollbars(page);
});

test('Cube arrows keep full brightness and exact 30px anchoring while the fixed sidebar ignores zoom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube 2D', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const sidebar = page.locator('.game-summary');
  const viewport = page.locator('.cube-2d-game__viewport');
  const renderer = page.locator('.cube-2d-renderer');
  const leftArrow = page.getByRole('button', { name: 'Move cube left' });

  const sidebarBefore = await requiredBox(sidebar);
  const leftArrowBefore = await requiredBox(leftArrow);
  await expectCubeNavigationAnchored(page);

  await page
    .getByRole('button', { name: 'Move top and bottom to column 4 using top slot' })
    .click();
  await expect(renderer).toHaveAttribute('data-animating', 'true');
  await expect(leftArrow).toBeDisabled();
  await expect(leftArrow).toHaveCSS('opacity', '1');
  await expect(renderer).toHaveAttribute('data-animating', 'false', { timeout: 1000 });
  await expectCubeNavigationAnchored(page);

  await viewport.hover();
  await page.mouse.wheel(0, -250);
  await expect(viewport).toHaveAttribute('data-view-zoom', '1.200');

  const sidebarAfter = await requiredBox(sidebar);
  const leftArrowAfter = await requiredBox(leftArrow);
  expectBoxStable(sidebarBefore, sidebarAfter);
  expect(leftArrowAfter.width).toBeCloseTo(leftArrowBefore.width, 0);
  expect(leftArrowAfter.height).toBeCloseTo(leftArrowBefore.height, 0);
  await expectCubeNavigationAnchored(page);

  const stacking = await page.evaluate(() => ({
    sidebar: Number(getComputedStyle(document.querySelector('.game-summary')!).zIndex),
    board: Number(getComputedStyle(document.querySelector('.cube-2d-game__board-shell')!).zIndex),
  }));
  expect(stacking.sidebar).toBeGreaterThan(stacking.board);
  await expectNoDocumentScrollbars(page);
});
