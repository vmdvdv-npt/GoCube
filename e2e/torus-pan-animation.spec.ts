import { expect, test, type Page } from '@playwright/test';

const start9x9Game = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByTestId('new-game-settings-grid')).toBeVisible();
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
  const view2D = page
    .getByRole('group', { name: 'Torus view' })
    .getByRole('button', { name: '2D' });
  await expect(view2D).toBeEnabled();
  await view2D.click();
  await expect(view2D).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Torus 3D scene')).toHaveCount(0);
};

const wrap9 = (value: number): number => ((value % 9) + 9) % 9;

const currentOffsets = async (page: Page): Promise<Readonly<{ x: number; y: number }>> => {
  const board = page.locator('.torus-board');
  return Object.freeze({
    x: Number(await board.getAttribute('data-view-offset-x')),
    y: Number(await board.getAttribute('data-view-offset-y')),
  });
};

const captureShiftStart = async (
  page: Page,
  direction: 'left' | 'right' | 'up' | 'down',
  stonePointId: string,
) =>
  page.evaluate(({ panDirection, logicalPointId }) => {
    const board = document.querySelector<SVGSVGElement>('.torus-board');
    const button = document.querySelector<HTMLButtonElement>(
      `[aria-label="Shift torus view ${panDirection}"]`,
    );
    if (!board || !button) throw new Error('Torus board controls are missing');

    button.click();

    const grid = board.querySelector<SVGGElement>('.torus-board__pan-content--grid');
    const pieces = board.querySelector<SVGGElement>('.torus-board__pan-content--pieces');
    return {
      animating: board.getAttribute('data-pan-animating'),
      panDirection: board.getAttribute('data-pan-direction'),
      pointerEvents: board.style.pointerEvents,
      gridTransform: grid?.getAttribute('transform') ?? null,
      piecesTransform: pieces?.getAttribute('transform') ?? null,
      gridOpacity: grid?.getAttribute('opacity') ?? null,
      piecesOpacity: pieces?.getAttribute('opacity') ?? null,
      stoneCopies: board.querySelectorAll(
        `.torus-board__stone[data-logical-point-id="${logicalPointId}"]`,
      ).length,
    };
  }, { panDirection: direction, logicalPointId: stonePointId });

const expectShift = async (
  page: Page,
  direction: 'left' | 'right' | 'up' | 'down',
  expectedOffsetX: number,
  expectedOffsetY: number,
  stonePointId: string,
): Promise<void> => {
  const snapshot = await captureShiftStart(page, direction, stonePointId);

  expect(snapshot.animating).toBe('true');
  expect(snapshot.panDirection).toBe(direction);
  expect(snapshot.pointerEvents).toBe('none');
  expect(snapshot.gridTransform).toMatch(/^translate\(/);
  expect(snapshot.gridTransform).not.toBe('translate(0 0)');
  expect(snapshot.piecesTransform).toBe(snapshot.gridTransform);
  expect(snapshot.gridOpacity).toBeNull();
  expect(snapshot.piecesOpacity).toBeNull();
  // The renderer creates temporary wrapped copies only while the pan animation is active.
  expect(snapshot.stoneCopies).toBeGreaterThan(1);

  const board = page.locator('.torus-board');
  await expect(board).toHaveAttribute('data-pan-animating', 'false', { timeout: 2_000 });
  await expect(board).toHaveAttribute('data-navigation-busy', 'false');
  await expect(board).toHaveAttribute('data-view-offset-x', String(expectedOffsetX));
  await expect(board).toHaveAttribute('data-view-offset-y', String(expectedOffsetY));
  await expect(board).toHaveAttribute('data-duplicate-regions-visible', 'false');
};

test('Torus 2D arrows physically slide grid and stones with seamless wrap', async ({ page }) => {
  await start9x9Game(page);

  const baseline = await currentOffsets(page);
  const firstPointId = `${baseline.x},${baseline.y}`;
  const firstPoint = page.locator(
    `.torus-board__hit-target[data-logical-point-id="${firstPointId}"][data-copy-role="primary"]`,
  );
  await firstPoint.click();
  await expect(page.getByText('White to move')).toBeVisible();
  await expect(page.locator('.torus-board__edge-duplicates')).toHaveCount(0);

  await expectShift(page, 'right', wrap9(baseline.x + 1), baseline.y, firstPointId);
  await expectShift(page, 'left', baseline.x, baseline.y, firstPointId);
  await expectShift(page, 'down', baseline.x, wrap9(baseline.y + 1), firstPointId);
  await expectShift(page, 'up', baseline.x, baseline.y, firstPointId);

  const secondPointId = `${wrap9(baseline.x + 4)},${wrap9(baseline.y + 4)}`;
  const secondPoint = page.locator(
    `.torus-board__hit-target[data-logical-point-id="${secondPointId}"][data-copy-role="primary"]`,
  );
  await secondPoint.click();
  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.getByText('Move 2')).toBeVisible();
});

test('rapid Torus navigation ignores extra arrows and keeps sidebar actions available', async ({ page }) => {
  await start9x9Game(page);

  const baseline = await currentOffsets(page);
  await page.locator(
    `.torus-board__hit-target[data-logical-point-id="${baseline.x},${baseline.y}"][data-copy-role="primary"]`,
  ).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  const board = page.locator('.torus-board');
  const shiftDown = page.getByRole('button', { name: 'Shift torus view down' });

  // Dispatch both commands in one browser task so the second command is guaranteed to
  // arrive while the first 240 ms animation is active. Using two Playwright click()
  // calls here is racy on WebKit because actionability work can outlive the animation.
  const rapidSnapshot = await page.evaluate(() => {
    const boardElement = document.querySelector<SVGSVGElement>('.torus-board');
    const shiftRight = document.querySelector<HTMLButtonElement>(
      '[aria-label="Shift torus view right"]',
    );
    const shiftDownButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="Shift torus view down"]',
    );
    if (!boardElement || !shiftRight || !shiftDownButton) {
      throw new Error('Torus board controls are missing');
    }

    shiftRight.click();
    const startedAnimating = boardElement.getAttribute('data-pan-animating');
    const startedDirection = boardElement.getAttribute('data-pan-direction');

    // Canonical behavior is to ignore an extra command while animating, not queue it.
    shiftDownButton.click();

    return {
      startedAnimating,
      startedDirection,
      animatingAfterExtra: boardElement.getAttribute('data-pan-animating'),
      directionAfterExtra: boardElement.getAttribute('data-pan-direction'),
    };
  });

  expect(rapidSnapshot.startedAnimating).toBe('true');
  expect(rapidSnapshot.startedDirection).toBe('right');
  expect(rapidSnapshot.animatingAfterExtra).toBe('true');
  expect(rapidSnapshot.directionAfterExtra).toBe('right');
  await expect(page.getByRole('button', { name: /Pass/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New game', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Move numbers', { exact: true })).toBeEnabled();
  const duplicateRegions = page.getByLabel('Show duplicate regions', { exact: true });
  await expect(duplicateRegions).toBeEnabled();
  await expect(duplicateRegions).not.toBeChecked();

  const afterRightX = wrap9(baseline.x + 1);
  await expect(board).toHaveAttribute('data-pan-animating', 'false', { timeout: 2_000 });
  await expect(board).toHaveAttribute('data-view-offset-x', String(afterRightX));
  await expect(board).toHaveAttribute('data-view-offset-y', String(baseline.y));

  // Once the active animation ends, the same command is accepted normally.
  await shiftDown.click();
  await expect(board).toHaveAttribute('data-pan-animating', 'true');
  await expect(board).toHaveAttribute('data-pan-animating', 'false', { timeout: 2_000 });
  await expect(board).toHaveAttribute('data-view-offset-x', String(afterRightX));
  await expect(board).toHaveAttribute('data-view-offset-y', String(wrap9(baseline.y + 1)));
});

test('Torus 2D drag-pan moves the board view without changing logical torus offsets', async ({ page }) => {
  await start9x9Game(page);

  const baseline = await currentOffsets(page);
  const shell = page.locator('.torus-board-shell');
  const bounds = await shell.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 90, startY + 55, { steps: 4 });
  await page.mouse.up();

  const pan = await shell.evaluate((element) => ({
    x: Number(element.getAttribute('data-pan-x')),
    y: Number(element.getAttribute('data-pan-y')),
  }));
  expect(Math.abs(pan.x)).toBeGreaterThan(30);
  expect(Math.abs(pan.y)).toBeGreaterThan(20);
  await expect(page.locator('.torus-board')).toHaveAttribute('data-view-offset-x', String(baseline.x));
  await expect(page.locator('.torus-board')).toHaveAttribute('data-view-offset-y', String(baseline.y));
  await expect(page.getByText('Move 0')).toBeVisible();
});
