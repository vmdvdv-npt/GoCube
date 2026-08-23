import { expect, test, type Locator, type Page } from '@playwright/test';

const torusPoint = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  );

const cubeHit = (page: Page, logicalPointId: string): Locator =>
  page.locator(`.cube-2d-hit-area[data-point-id="${logicalPointId}"]`);

const floatingControl = (page: Page): Locator =>
  page.getByTestId('endgame-group-control');

const expectInsideViewportAndBoardArea = async (page: Page, control: Locator): Promise<void> => {
  const controlBox = await control.boundingBox();
  const sidebarBox = await page.locator('.game-summary').boundingBox();
  const viewport = page.viewportSize();
  expect(controlBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(controlBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x + sidebarBox!.width);
  expect(controlBox!.x).toBeGreaterThanOrEqual(0);
  expect(controlBox!.y).toBeGreaterThanOrEqual(0);
  expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(viewport!.height);
};

test('Torus Endgame Review shows one screen-space status control beside the clicked logical group', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();

  // Black is one logical seam group; White is a separate two-stone group near the top edge.
  await torusPoint(page, '0,4').click();
  await torusPoint(page, '4,0').click();
  await torusPoint(page, '8,4').click();
  await torusPoint(page, '4,1').click();

  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();

  // Group-local actions do not occupy the sidebar before a user selects a group.
  await expect(floatingControl(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Selected group status' })).toHaveCount(0);

  await torusPoint(page, '0,4').click();
  const control = floatingControl(page);
  await expect(control).toBeVisible();
  await expect(control).toHaveCount(1);
  await expect(control).toHaveAttribute('data-group-point-count', '2');
  await expect(control).toHaveAttribute('data-placement', /^(top|bottom|left|right)$/);
  await expectInsideViewportAndBoardArea(page, control);

  const alive = control.getByRole('button', { name: 'Alive', exact: true });
  const dead = control.getByRole('button', { name: 'Dead', exact: true });
  const seki = control.getByRole('button', { name: 'Seki', exact: true });
  const aliveBox = await alive.boundingBox();
  const deadBox = await dead.boundingBox();
  const sekiBox = await seki.boundingBox();
  expect(aliveBox).not.toBeNull();
  expect(deadBox).not.toBeNull();
  expect(sekiBox).not.toBeNull();
  expect(aliveBox!.y).toBeLessThan(deadBox!.y);
  expect(deadBox!.y).toBeLessThan(sekiBox!.y);

  await seki.click();
  await expect(seki).toHaveAttribute('aria-pressed', 'true');
  await expect(control).toHaveCount(1);

  const seamControlBox = await control.boundingBox();
  await torusPoint(page, '4,0').click();
  await expect(control).toHaveCount(1);
  await expect(control).toHaveAttribute('data-group-point-count', '2');
  const topGroupControlBox = await control.boundingBox();
  expect(seamControlBox).not.toBeNull();
  expect(topGroupControlBox).not.toBeNull();
  expect(
    Math.abs(topGroupControlBox!.x - seamControlBox!.x) +
      Math.abs(topGroupControlBox!.y - seamControlBox!.y),
  ).toBeGreaterThan(2);

  // The control stays screen-space sized while the board and stones zoom.
  const whiteStone = page.locator(
    '.torus-board__stone[data-logical-point-id="4,0"][data-copy-role="primary"]',
  );
  const beforeControl = await control.boundingBox();
  const beforeStone = await whiteStone.boundingBox();
  const board = await page.locator('.torus-board-viewport').boundingBox();
  expect(beforeControl).not.toBeNull();
  expect(beforeStone).not.toBeNull();
  expect(board).not.toBeNull();
  await page.mouse.move(board!.x + board!.width / 2, board!.y + board!.height / 2);
  await page.mouse.wheel(0, -320);
  await page.waitForTimeout(120);
  const afterZoomControl = await control.boundingBox();
  const afterZoomStone = await whiteStone.boundingBox();
  expect(afterZoomControl).not.toBeNull();
  expect(afterZoomStone).not.toBeNull();
  expect(Math.abs(afterZoomControl!.height - beforeControl!.height)).toBeLessThan(1.5);
  expect(afterZoomStone!.width).toBeGreaterThan(beforeStone!.width);
  await expectInsideViewportAndBoardArea(page, control);

  // Drag-pan moves the selected group and the contextual control together.
  const beforePanControl = await control.boundingBox();
  const beforePanStone = await whiteStone.boundingBox();
  const zoomedBoard = await page.locator('.torus-board-viewport').boundingBox();
  expect(beforePanControl).not.toBeNull();
  expect(beforePanStone).not.toBeNull();
  expect(zoomedBoard).not.toBeNull();
  const startX = zoomedBoard!.x + zoomedBoard!.width / 2;
  const startY = zoomedBoard!.y + zoomedBoard!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 46, startY + 32, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const afterPanControl = await control.boundingBox();
  const afterPanStone = await whiteStone.boundingBox();
  expect(afterPanControl).not.toBeNull();
  expect(afterPanStone).not.toBeNull();
  expect(afterPanStone!.x - beforePanStone!.x).toBeGreaterThan(5);
  expect(afterPanControl!.x - beforePanControl!.x).toBeGreaterThan(5);
  await expectInsideViewportAndBoardArea(page, control);
});

test('Cube 2D keeps the single contextual status control attached through review navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  await cubeHit(page, 'front:1:1').click();
  await cubeHit(page, 'right:1:1').click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(floatingControl(page)).toHaveCount(0);

  await cubeHit(page, 'front:1:1').click();
  const control = floatingControl(page);
  await expect(control).toBeVisible();
  await expect(control).toHaveCount(1);
  await control.getByRole('button', { name: 'Alive', exact: true }).click();
  await expect(control.getByRole('button', { name: 'Alive', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await cubeHit(page, 'right:1:1').click();
  await expect(control).toHaveCount(1);
  await control.getByRole('button', { name: 'Alive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Finish scoring' })).toBeEnabled();
  await expectInsideViewportAndBoardArea(page, control);

  const selectedStone = page.locator(
    '.cube-2d-stone[data-logical-point-id="right:1:1"]',
  );
  const beforeControl = await control.boundingBox();
  const beforeStone = await selectedStone.boundingBox();
  const viewport = await page.locator('.cube-2d-game__viewport').boundingBox();
  expect(beforeControl).not.toBeNull();
  expect(beforeStone).not.toBeNull();
  expect(viewport).not.toBeNull();
  await page.mouse.move(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2);
  await page.mouse.wheel(0, -260);
  await page.waitForTimeout(100);
  const afterZoomControl = await control.boundingBox();
  const afterZoomStone = await selectedStone.boundingBox();
  expect(afterZoomControl).not.toBeNull();
  expect(afterZoomStone).not.toBeNull();
  expect(Math.abs(afterZoomControl!.height - beforeControl!.height)).toBeLessThan(1.5);
  expect(afterZoomStone!.width).toBeGreaterThan(beforeStone!.width);

  const beforeNavigation = await control.boundingBox();
  await page.getByRole('button', { name: 'Move cube right' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'true');
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'false', {
    timeout: 1000,
  });
  const afterNavigation = await control.boundingBox();
  expect(beforeNavigation).not.toBeNull();
  expect(afterNavigation).not.toBeNull();
  expect(
    Math.abs(afterNavigation!.x - beforeNavigation!.x) +
      Math.abs(afterNavigation!.y - beforeNavigation!.y),
  ).toBeGreaterThan(2);
  await expect(control).toHaveCount(1);
  await expect(control.getByRole('button', { name: 'Alive', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectInsideViewportAndBoardArea(page, control);
});
