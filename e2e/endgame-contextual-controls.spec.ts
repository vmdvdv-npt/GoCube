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

const expectControlNearClickTarget = async (control: Locator, target: Locator): Promise<void> => {
  const controlBox = await control.boundingBox();
  const targetBox = await target.boundingBox();
  expect(controlBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const clickX = targetBox!.x + targetBox!.width / 2;
  const clickY = targetBox!.y + targetBox!.height / 2;
  const distanceX =
    clickX < controlBox!.x
      ? controlBox!.x - clickX
      : clickX > controlBox!.x + controlBox!.width
        ? clickX - (controlBox!.x + controlBox!.width)
        : 0;
  const distanceY =
    clickY < controlBox!.y
      ? controlBox!.y - clickY
      : clickY > controlBox!.y + controlBox!.height
        ? clickY - (controlBox!.y + controlBox!.height)
        : 0;

  expect(Math.hypot(distanceX, distanceY)).toBeLessThanOrEqual(24);
};

test('Torus Endgame Review anchors the popup to each group click and dismisses it after a decision or outside click', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
  const view2D = page
    .getByRole('group', { name: 'Torus view' })
    .getByRole('button', { name: '2D' });
  await expect(view2D).toBeEnabled();
  await view2D.click();
  await expect(view2D).toHaveAttribute('aria-pressed', 'true');

  await torusPoint(page, '0,4').click();
  await torusPoint(page, '4,0').click();
  await torusPoint(page, '8,4').click();
  await torusPoint(page, '4,1').click();

  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();
  await expect(floatingControl(page)).toHaveCount(0);

  const seamGroup = torusPoint(page, '0,4');
  await seamGroup.click();
  const control = floatingControl(page);
  await expect(control).toBeVisible();
  await expect(control).toHaveCount(1);
  await expect(control).toHaveAttribute('data-group-point-count', '2');
  await expectControlNearClickTarget(control, seamGroup);
  await expectInsideViewportAndBoardArea(page, control);

  await control.getByRole('button', { name: 'Seki', exact: true }).click();
  await expect(control).toHaveCount(0);
  await expect(page.locator('.torus-board__group-contour--seki')).toHaveCount(1);

  await seamGroup.click();
  await expect(control).toBeVisible();
  await expect(control.getByRole('button', { name: 'Seki', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('heading', { name: 'Assisted endgame review' }).click();
  await expect(control).toHaveCount(0);

  const topGroup = torusPoint(page, '4,0');
  await topGroup.click();
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute('data-group-point-count', '2');
  await expectControlNearClickTarget(control, topGroup);
  await expectInsideViewportAndBoardArea(page, control);
});

test('Cube 2D moves the popup to the latest group click and closes it after applying a status', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  await cubeHit(page, 'front:1:1').click();
  await cubeHit(page, 'right:1:1').click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();

  const frontGroup = cubeHit(page, 'front:1:1');
  await frontGroup.click();
  const control = floatingControl(page);
  await expect(control).toBeVisible();
  await expectControlNearClickTarget(control, frontGroup);

  await control.getByRole('button', { name: 'Alive', exact: true }).click();
  await expect(control).toHaveCount(0);

  await frontGroup.click();
  await expect(control).toBeVisible();
  await expect(control.getByRole('button', { name: 'Alive', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const frontControlBox = await control.boundingBox();
  const rightGroup = cubeHit(page, 'right:1:1');
  await rightGroup.click();
  await expect(control).toBeVisible();
  await expectControlNearClickTarget(control, rightGroup);
  const rightControlBox = await control.boundingBox();
  expect(frontControlBox).not.toBeNull();
  expect(rightControlBox).not.toBeNull();
  expect(
    Math.abs(rightControlBox!.x - frontControlBox!.x) +
      Math.abs(rightControlBox!.y - frontControlBox!.y),
  ).toBeGreaterThan(2);

  await control.getByRole('button', { name: 'Alive', exact: true }).click();
  await expect(control).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Finish scoring' })).toBeEnabled();
});
