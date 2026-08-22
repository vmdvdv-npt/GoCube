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

const dragBy = async (page: Page, locator: Locator, dx: number, dy: number) => {
  const box = await requiredBox(locator);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const inset = 24;
  const endX = Math.max(box.x + inset, Math.min(box.x + box.width - inset, startX + dx));
  const endY = Math.max(box.y + inset, Math.min(box.y + box.height - inset, startY + dy));
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();
};

const visibleCubeHitNearestViewportCenter = async (page: Page): Promise<Locator> => {
  const pointId = await page.locator('.cube-2d-hit-area').evaluateAll((elements) => {
    const viewport = document.querySelector<HTMLElement>('.cube-2d-game__viewport')!.getBoundingClientRect();
    const centerX = viewport.left + viewport.width / 2;
    const centerY = viewport.top + viewport.height / 2;
    const candidates = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return {
          pointId: element.getAttribute('data-point-id'),
          x,
          y,
          distance: Math.hypot(x - centerX, y - centerY),
        };
      })
      .filter(
        (candidate) =>
          candidate.pointId &&
          candidate.x >= viewport.left &&
          candidate.x <= viewport.right &&
          candidate.y >= viewport.top &&
          candidate.y <= viewport.bottom,
      )
      .sort((a, b) => a.distance - b.distance);
    return candidates[0]?.pointId ?? null;
  });
  if (!pointId) throw new Error('Expected a visible Cube hit target');
  return page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);
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
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
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

test('Cube strong zoom reaches 4.05x and lets boards and arrows extend beyond the real viewport through pan', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const viewport = page.locator('.cube-2d-game__viewport');
  await viewport.hover();
  await page.mouse.wheel(0, -5000);
  await expect(viewport).toHaveAttribute('data-view-zoom', '4.050');

  const initialGeometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      centralBoard: rect('.cube-2d-board[data-central="true"]'),
      navigationLayer: rect('.cube-2d-game__navigation-layer'),
    };
  });

  expect(initialGeometry.centralBoard.width).toBeGreaterThan(initialGeometry.viewportWidth * 0.6);
  expect(initialGeometry.navigationLayer.width).toBeGreaterThan(initialGeometry.viewportWidth);
  expect(initialGeometry.navigationLayer.height).toBeGreaterThan(initialGeometry.viewportHeight);

  for (let index = 0; index < 8; index += 1) await dragBy(page, viewport, -320, -220);
  const negativePanGeometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    };
    return {
      navigationLayer: rect('.cube-2d-game__navigation-layer'),
      leftArrow: rect('button[aria-label="Move cube left"]'),
      upArrow: rect('button[aria-label="Move cube up"]'),
    };
  });
  expect(negativePanGeometry.navigationLayer.left).toBeLessThan(0);
  expect(negativePanGeometry.navigationLayer.top).toBeLessThan(0);
  expect(negativePanGeometry.leftArrow.right).toBeLessThan(0);
  expect(negativePanGeometry.upArrow.bottom).toBeLessThan(0);

  for (let index = 0; index < 16; index += 1) await dragBy(page, viewport, 320, 220);
  const positivePanGeometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    };
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      navigationLayer: rect('.cube-2d-game__navigation-layer'),
      rightArrow: rect('button[aria-label="Move cube right"]'),
      downArrow: rect('button[aria-label="Move cube down"]'),
    };
  });
  expect(positivePanGeometry.navigationLayer.right).toBeGreaterThan(positivePanGeometry.viewportWidth);
  expect(positivePanGeometry.navigationLayer.bottom).toBeGreaterThan(positivePanGeometry.viewportHeight);
  expect(positivePanGeometry.rightArrow.left).toBeGreaterThan(positivePanGeometry.viewportWidth);
  expect(positivePanGeometry.downArrow.top).toBeGreaterThan(positivePanGeometry.viewportHeight);
  await expectNoDocumentScrollbars(page);
});

test('Torus drag-pan moves the zoomed visual shell without placing a stone and keeps post-pan hit-testing aligned', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start game' }).click();

  const shell = page.locator('.torus-board-shell');
  const board = page.locator('.torus-board');
  const target = page.locator(
    '.torus-board__hit-target[data-logical-point-id="4,4"][data-copy-role="primary"]',
  ).first();
  const turn = page.locator('.turn-indicator strong');

  await board.hover();
  await page.mouse.wheel(0, -450);
  await expect(shell).not.toHaveAttribute('data-view-zoom', '1.000');

  const targetBefore = await requiredBox(target);
  const startX = targetBefore.x + targetBefore.width / 2;
  const startY = targetBefore.y + targetBefore.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 110, startY + 70, { steps: 8 });
  await page.mouse.up();

  await expect(turn).toHaveText('Black to move');
  await expect.poll(async () => Number(await shell.getAttribute('data-pan-x'))).toBeGreaterThan(80);
  await expect.poll(async () => Number(await shell.getAttribute('data-pan-y'))).toBeGreaterThan(50);

  const targetAfter = await requiredBox(target);
  expect(targetAfter.x - targetBefore.x).toBeGreaterThan(80);
  expect(targetAfter.y - targetBefore.y).toBeGreaterThan(40);

  await target.click();
  await expect(turn).toHaveText('White to move');
  await expectNoDocumentScrollbars(page);
});

test('Cube drag-pan at 4.05x moves the complete cross with its arrows, suppresses the drag click, and preserves later gameplay clicks', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '4×4', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  const viewport = page.locator('.cube-2d-game__viewport');
  const navigationLayer = page.locator('.cube-2d-game__navigation-layer');
  const turn = page.locator('.turn-indicator strong');

  await viewport.hover();
  await page.mouse.wheel(0, -5000);
  await expect(viewport).toHaveAttribute('data-view-zoom', '4.050');

  const target = await visibleCubeHitNearestViewportCenter(page);
  const targetBefore = await requiredBox(target);
  const layerBefore = await requiredBox(navigationLayer);
  const startX = targetBefore.x + targetBefore.width / 2;
  const startY = targetBefore.y + targetBefore.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY + 50, { steps: 8 });
  await page.mouse.up();

  await expect(turn).toHaveText('Black to move');
  await expect.poll(async () => Number(await viewport.getAttribute('data-pan-x'))).toBeGreaterThan(40);
  await expect.poll(async () => Number(await viewport.getAttribute('data-pan-y'))).toBeGreaterThan(35);

  const layerAfter = await requiredBox(navigationLayer);
  expect(layerAfter.x - layerBefore.x).toBeGreaterThan(40);
  expect(layerAfter.y - layerBefore.y).toBeGreaterThan(35);
  await expectCubeNavigationAnchored(page);

  await target.click();
  await expect(turn).toHaveText('White to move');
  await expectNoDocumentScrollbars(page);
});