import { expect, test, type Locator, type Page } from '@playwright/test';

const CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS = 30_000;

const cubeGame = (page: Page) => page.getByRole('region', { name: 'Cube game' });
const cubeViewSwitch = (page: Page) => page.getByRole('group', { name: 'Cube view' });
const scene3D = (page: Page) => page.getByLabel('Cube 3D scene');
const hit2D = (page: Page, pointId: string): Locator =>
  page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);

const waitFor3DTransition = async (page: Page): Promise<void> => {
  await expect(cubeGame(page)).toHaveAttribute('data-cube-view-transitioning', 'false', {
    timeout: CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS,
  });
};

const startCubeGame = async (page: Page, size: 3 | 4): Promise<void> => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: `${String(size)}×${String(size)}`, exact: true }).click();
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByLabel('Komi').fill('0');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-cube-size', String(size));
};

const enter3D = async (page: Page): Promise<void> => {
  await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
  await waitFor3DTransition(page);
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1, {
    timeout: CUBE_VIEW_TRANSITION_EXPECT_TIMEOUT_MS,
  });
};

const enter2D = async (page: Page): Promise<void> => {
  await cubeViewSwitch(page).getByRole('button', { name: '2D' }).click();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(0);
};

const click3DCenter = async (page: Page): Promise<void> => {
  const canvas = page.locator('[data-testid="cube-3d-canvas"]');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
};

const passTwice = async (page: Page): Promise<void> => {
  const pass = page.getByRole('button', { name: /^Pass(?: \(1\))?$/ });
  await pass.click();
  await expect(pass).toBeDisabled();
  await expect(pass).toBeEnabled({ timeout: 2_200 });
  await pass.click();
};

const resolveGroupAt = async (
  page: Page,
  pointId: string,
  status: 'Alive' | 'Dead' | 'Seki',
): Promise<void> => {
  await hit2D(page, pointId).click();
  await page
    .getByRole('group', { name: 'Selected group status' })
    .getByRole('button', { name: status, exact: true })
    .click();
};

test('Cube 3D shares capture, Undo/Redo, Pass, move numbers and zoom-preserving renderer switching', async ({ page }) => {
  await startCubeGame(page, 3);

  for (const pointId of [
    'front:1:1',
    'front:1:2',
    'front:0:2',
    'right:1:0',
    'front:2:2',
    'back:1:1',
    'right:0:0',
    'back:0:0',
    'right:2:0',
    'top:1:1',
  ]) {
    await hit2D(page, pointId).click();
  }

  await enter3D(page);
  const scene = scene3D(page);
  await expect(scene).toHaveAttribute('data-cube3d-black-stone-count', '5');
  await expect(scene).toHaveAttribute('data-cube3d-white-stone-count', '5');

  await page.getByRole('button', { name: 'Move Cube 3D right' }).click();
  await waitFor3DTransition(page);
  await expect(scene).toHaveAttribute('data-cube3d-anchor', /^(right):/);

  // The center of the right face is the capture move from the existing Cube 2D fixture.
  await click3DCenter(page);
  await expect(page.getByText('Move 11', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-cube3d-black-stone-count', '6');
  await expect(scene).toHaveAttribute('data-cube3d-white-stone-count', '3');
  await expect(scene).toHaveAttribute('data-cube3d-last-move-point', 'right:1:1');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(scene).toHaveAttribute('data-cube3d-black-stone-count', '5');
  await expect(scene).toHaveAttribute('data-cube3d-white-stone-count', '5');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(scene).toHaveAttribute('data-cube3d-black-stone-count', '6');
  await expect(scene).toHaveAttribute('data-cube3d-white-stone-count', '3');

  await page.getByRole('checkbox', { name: 'Move numbers' }).check();
  await expect(scene).toHaveAttribute('data-cube3d-move-number-count', '8');
  await expect(scene).toHaveAttribute('data-cube3d-last-move-point', 'right:1:1');

  await page.getByRole('button', { name: 'Pass' }).click();
  await expect(page.getByText('Move 12', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-cube3d-move-number-count', '8');
  await expect(scene).toHaveAttribute('data-cube3d-last-move-point', 'right:1:1');

  const canvas = page.locator('[data-testid="cube-3d-canvas"]');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -220);
  const zoomed = await scene.getAttribute('data-cube3d-zoom');
  expect(zoomed).toBeTruthy();
  expect(zoomed).not.toBe('1.0000');

  await enter2D(page);
  await expect(page.locator('.cube-2d-stone')).toHaveCount(9);
  await expect(page.locator('.cube-2d-move-number')).toHaveCount(8);
  await enter3D(page);
  await expect(scene3D(page)).toHaveAttribute('data-cube3d-black-stone-count', '6');
  await expect(scene3D(page)).toHaveAttribute('data-cube3d-white-stone-count', '3');
  await expect(scene3D(page)).toHaveAttribute('data-cube3d-move-number-count', '8');
  await expect(scene3D(page)).toHaveAttribute('data-cube3d-zoom', zoomed!);
});

test('Cube 2D and Cube 3D edit the same endgame review state in both directions', async ({ page }) => {
  await startCubeGame(page, 3);

  for (const pointId of ['front:1:1', 'back:0:0', 'right:1:0', 'back:0:1']) {
    await hit2D(page, pointId).click();
  }
  await passTwice(page);
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();

  await enter3D(page);
  await expect(scene3D(page)).toHaveAttribute('data-cube3d-phase', 'endgame');

  // front:1:1 is the exact center of the canonical front face.
  await click3DCenter(page);
  await page
    .getByRole('group', { name: 'Selected group status' })
    .getByRole('button', { name: 'Dead', exact: true })
    .click();
  await expect(scene3D(page)).toHaveAttribute('data-cube3d-dead-review-count', '1');

  await enter2D(page);
  await expect(page.locator('.cube-2d-group-contour--dead')).toHaveCount(1);
  await resolveGroupAt(page, 'back:0:0', 'Seki');

  await enter3D(page);
  await expect
    .poll(async () => Number(await scene3D(page).getAttribute('data-cube3d-seki-review-count')))
    .toBeGreaterThan(0);
  await expect(scene3D(page)).toHaveAttribute('data-cube3d-dead-review-count', '1');
});

test('Cube 3D finishes scoring with territory/dead-stone presentation, remains navigable, and Undo restores play', async ({ page }) => {
  await startCubeGame(page, 4);

  const blackSurround = [
    'front:0:1',
    'front:1:0',
    'front:1:2',
    'front:2:0',
    'front:2:2',
    'front:3:1',
  ] as const;
  const whiteFillers = ['back:0:0', 'back:0:1', 'back:0:2', 'back:0:3', 'back:1:0'] as const;
  const moves = [
    blackSurround[0],
    'front:1:1',
    blackSurround[1],
    whiteFillers[0],
    blackSurround[2],
    whiteFillers[1],
    blackSurround[3],
    whiteFillers[2],
    blackSurround[4],
    whiteFillers[3],
    blackSurround[5],
    whiteFillers[4],
  ] as const;
  for (const pointId of moves) await hit2D(page, pointId).click();

  await passTwice(page);
  await expect(page.getByRole('heading', { name: 'Assisted endgame review' })).toBeVisible();

  for (const pointId of blackSurround) await resolveGroupAt(page, pointId, 'Alive');
  for (const pointId of whiteFillers) await resolveGroupAt(page, pointId, 'Alive');
  await resolveGroupAt(page, 'front:1:1', 'Dead');
  await expect(page.getByRole('button', { name: 'Finish scoring' })).toBeEnabled();

  await enter3D(page);
  const scene = scene3D(page);
  await expect(scene).toHaveAttribute('data-cube3d-dead-review-count', '1');
  await expect(scene).toHaveAttribute('data-cube3d-white-stone-count', '6');
  await expect
    .poll(async () => Number(await scene.getAttribute('data-cube3d-black-territory-count')))
    .toBeGreaterThanOrEqual(1);

  await page.getByRole('button', { name: 'Finish scoring' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(scene).toHaveAttribute('data-cube3d-phase', 'finished');
  await expect(scene).toHaveAttribute('data-cube3d-white-stone-count', '5');
  await expect(scene).toHaveAttribute('data-cube3d-dead-review-count', '0');
  await expect
    .poll(async () => Number(await scene.getAttribute('data-cube3d-black-territory-count')))
    .toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Close game result' }).click();
  await expect(page.getByRole('button', { name: 'Game result' })).toBeVisible();

  const canvas = page.locator('[data-testid="cube-3d-canvas"]');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  const zoomBefore = await scene.getAttribute('data-cube3d-zoom');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, -180);
  await expect(scene).not.toHaveAttribute('data-cube3d-zoom', zoomBefore ?? '');

  await page.getByRole('button', { name: 'Move Cube 3D up' }).click();
  await waitFor3DTransition(page);
  await page.getByRole('button', { name: 'Reset Cube 3D view' }).click();
  await waitFor3DTransition(page);

  await page.getByRole('button', { name: 'Game result' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close game result' }).click();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(scene).toHaveAttribute('data-cube3d-phase', 'playing');
  await expect(scene).toHaveAttribute('data-cube3d-white-stone-count', '6');
  await expect(scene).toHaveAttribute('data-cube3d-black-territory-count', '0');
  await expect(scene).toHaveAttribute('data-cube3d-white-territory-count', '0');
  await expect(scene).toHaveAttribute('data-cube3d-dead-review-count', '0');
  await expect(page.getByRole('button', { name: 'Game result' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pass (1)' })).toBeEnabled();
});
