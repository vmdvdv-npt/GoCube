import { expect, test, type Page } from '@playwright/test';

const start9x9Game = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-game')).toBeVisible();
};

const captureShiftStart = async (
  page: Page,
  direction: 'left' | 'right' | 'up' | 'down',
) =>
  page.evaluate((panDirection) => {
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
        '.torus-board__stone[data-logical-point-id="0,0"]',
      ).length,
    };
  }, direction);

const expectShift = async (
  page: Page,
  direction: 'left' | 'right' | 'up' | 'down',
  expectedOffsetX: number,
  expectedOffsetY: number,
): Promise<void> => {
  const snapshot = await captureShiftStart(page, direction);

  expect(snapshot.animating).toBe('true');
  expect(snapshot.panDirection).toBe(direction);
  expect(snapshot.pointerEvents).toBe('none');
  expect(snapshot.gridTransform).toMatch(/^translate\(/);
  expect(snapshot.gridTransform).not.toBe('translate(0 0)');
  expect(snapshot.piecesTransform).toBe(snapshot.gridTransform);
  expect(snapshot.gridOpacity).toBeNull();
  expect(snapshot.piecesOpacity).toBeNull();
  expect(snapshot.stoneCopies).toBeGreaterThan(1);

  const board = page.locator('.torus-board');
  await expect(board).toHaveAttribute('data-pan-animating', 'false', { timeout: 2_000 });
  await expect(board).toHaveAttribute('data-navigation-busy', 'false');
  await expect(board).toHaveAttribute('data-view-offset-x', String(expectedOffsetX));
  await expect(board).toHaveAttribute('data-view-offset-y', String(expectedOffsetY));
};

test('Torus 2D arrows physically slide grid and stones with seamless wrap', async ({ page }) => {
  await start9x9Game(page);

  const firstPoint = page.locator(
    '.torus-board__hit-target[data-logical-point-id="0,0"][data-copy-role="primary"]',
  );
  await firstPoint.click();
  await expect(page.getByText('White to move')).toBeVisible();

  await page.getByLabel('Показывать дублирующие области').check();
  await expect(page.locator('.torus-board')).toHaveAttribute(
    'data-duplicate-regions-visible',
    'true',
  );

  await expectShift(page, 'right', 1, 0);
  await expectShift(page, 'left', 0, 0);
  await expectShift(page, 'down', 0, 1);
  await expectShift(page, 'up', 0, 0);

  const secondPoint = page.locator(
    '.torus-board__hit-target[data-logical-point-id="4,4"][data-copy-role="primary"]',
  );
  await secondPoint.click();
  await expect(page.getByText('Black to move')).toBeVisible();
  await expect(page.getByText('Move 2')).toBeVisible();
});

test('rapid Torus navigation ignores extra arrows and keeps sidebar actions available', async ({ page }) => {
  await start9x9Game(page);

  await page.locator(
    '.torus-board__hit-target[data-logical-point-id="0,0"][data-copy-role="primary"]',
  ).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

  await page.evaluate(() => {
    for (const direction of ['right', 'right', 'left', 'down'] as const) {
      document.querySelector<HTMLButtonElement>(
        `[aria-label="Shift torus view ${direction}"]`,
      )?.click();
    }
  });

  const board = page.locator('.torus-board');
  await expect(board).toHaveAttribute('data-pan-animating', 'true');
  await expect(page.getByRole('button', { name: /Pass/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New game', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Номера ходов')).toBeEnabled();
  await expect(page.getByLabel('Показывать дублирующие области')).toBeEnabled();

  await expect(board).toHaveAttribute('data-pan-animating', 'false', { timeout: 2_000 });
  // The first command wins; presses received during its animation are ignored.
  await expect(board).toHaveAttribute('data-view-offset-x', '1');
  await expect(board).toHaveAttribute('data-view-offset-y', '0');
});

test('Torus 2D drag-pan moves the board view without changing logical torus offsets', async ({ page }) => {
  await start9x9Game(page);

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
  await expect(page.locator('.torus-board')).toHaveAttribute('data-view-offset-x', '0');
  await expect(page.locator('.torus-board')).toHaveAttribute('data-view-offset-y', '0');
  await expect(page.getByText('Move 0')).toBeVisible();
});
