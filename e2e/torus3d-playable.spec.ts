import { expect, test, type Page } from '@playwright/test';

const startTorusGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
};

const primaryStone = (page: Page, pointId: string) =>
  page.locator(
    `.torus-board__stone[data-logical-point-id="${pointId}"][data-copy-role="primary"]`,
  );

const click2DPoint = async (page: Page, pointId: string): Promise<void> => {
  await page.locator(
    `.torus-board__hit-target[data-logical-point-id="${pointId}"][data-copy-role="primary"]`,
  ).click();
};

const findAllowed3DPoint = async (
  page: Page,
  excluded: readonly string[] = [],
): Promise<Readonly<{ pointId: string; x: number; y: number }>> => {
  const scene = page.getByLabel('Torus 3D foundation scene');
  const canvas = page.getByTestId('torus-3d-canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Torus 3D canvas has no bounds');

  for (let row = 1; row <= 8; row += 1) {
    for (let column = 1; column <= 8; column += 1) {
      const x = bounds.x + (bounds.width * column) / 9;
      const y = bounds.y + (bounds.height * row) / 9;
      await page.mouse.move(x, y);
      await page.waitForTimeout(4);
      const pointId = await scene.getAttribute('data-torus3d-hovered-point');
      const status = await scene.getAttribute('data-torus3d-hover-status');
      if (pointId && status === 'allowed' && !excluded.includes(pointId)) {
        return Object.freeze({ pointId, x, y });
      }
    }
  }
  throw new Error('Could not find an allowed visible Torus 3D point');
};

test('Torus 3D places stones through GameSession and shares Undo/Redo/Pass state with 2D', async ({ page }) => {
  await startTorusGame(page);
  await page.getByRole('button', { name: 'Torus 3D prototype' }).click();

  const scene = page.getByLabel('Torus 3D foundation scene');
  await expect(scene).toHaveAttribute('data-torus3d-grid-lines-first', '9');
  await expect(scene).toHaveAttribute('data-torus3d-grid-lines-second', '9');
  await expect(scene).toHaveAttribute('data-torus3d-black-stone-count', '0');
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '0');

  const black = await findAllowed3DPoint(page);
  await page.mouse.click(black.x, black.y);
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-black-stone-count', '1');
  await expect(scene).toHaveAttribute('data-torus3d-last-move-point', black.pointId);

  const white = await findAllowed3DPoint(page, [black.pointId]);
  await page.mouse.click(white.x, white.y);
  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '1');

  await page.getByLabel('Board display options').getByText('Move numbers').click();
  await expect(scene).toHaveAttribute('data-torus3d-move-number-count', '2');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '0');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '1');

  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(page.getByText('Move 3', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-black-stone-count', '1');
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '1');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Move 2', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Torus 2D' }).click();
  await expect(scene).toHaveCount(0);
  await expect(primaryStone(page, black.pointId)).toHaveCount(1);
  await expect(primaryStone(page, white.pointId)).toHaveCount(1);
});

test('Torus 3D drag and wheel change only the shared view state', async ({ page }) => {
  await startTorusGame(page);
  await page.getByRole('button', { name: 'Torus 3D prototype' }).click();

  const scene = page.getByLabel('Torus 3D foundation scene');
  const canvas = page.getByTestId('torus-3d-canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const centerX = bounds!.x + bounds!.width / 2;
  const centerY = bounds!.y + bounds!.height / 2;

  const rotationBefore = await scene.getAttribute('data-torus3d-rotation');
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 80, centerY + 55, { steps: 4 });
  await page.mouse.up();
  await expect(scene).not.toHaveAttribute('data-torus3d-rotation', rotationBefore ?? '');
  await expect(page.getByText('Move 0', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-black-stone-count', '0');

  const zoomBefore = await scene.getAttribute('data-torus3d-zoom');
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -220);
  await expect(scene).not.toHaveAttribute('data-torus3d-zoom', zoomBefore ?? '');
  await expect(page.getByText('Move 0', { exact: true })).toBeVisible();
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '0');
});

test('Torus 3D projects authoritative captures made in the shared Torus game', async ({ page }) => {
  await startTorusGame(page);
  for (const pointId of ['1,1', '0,1', '5,5', '1,0', '5,6', '2,1', '6,5', '1,2']) {
    await click2DPoint(page, pointId);
  }
  await expect(page.getByLabel('Black stones captured: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Torus 3D prototype' }).click();
  const scene = page.getByLabel('Torus 3D foundation scene');
  await expect(scene).toHaveAttribute('data-torus3d-black-stone-count', '3');
  await expect(scene).toHaveAttribute('data-torus3d-white-stone-count', '4');
  await expect(scene).toHaveAttribute('data-torus3d-phase', 'playing');
});
