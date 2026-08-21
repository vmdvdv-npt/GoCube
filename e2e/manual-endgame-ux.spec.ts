import { expect, test, type Locator, type Page } from '@playwright/test';

const startGame = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
};

const point = (page: Page, logicalPointId: string): Locator =>
  page.locator(
    `.torus-board__hit-target[data-logical-point-id="${logicalPointId}"][data-copy-role="primary"]`,
  );

const clickLineAwayFromStone = async (page: Page, line: Locator): Promise<void> => {
  const position = await line.evaluate((element) => {
    const x1 = Number(element.getAttribute('x1'));
    const y1 = Number(element.getAttribute('y1'));
    const x2 = Number(element.getAttribute('x2'));
    const y2 = Number(element.getAttribute('y2'));
    return { x: x1 + (x2 - x1) * 0.9, y: y1 + (y2 - y1) * 0.9 };
  });
  const board = page.locator('.torus-board');
  const bounds = await board.boundingBox();
  if (!bounds) throw new Error('Board has no bounding box');

  await board.click({
    position: {
      x: (position.x / 1000) * bounds.width,
      y: (position.y / 1000) * bounds.height,
    },
  });
};

test('manual endgame is board-first, reclassifiable, seam-safe and duplicate-aware', async ({ page }) => {
  await startGame(page);

  // Black becomes one logical group through the horizontal torus seam.
  await point(page, '0,4').click();
  await point(page, '4,4').click();
  await point(page, '8,4').click();
  await point(page, '4,5').click();
  await page.getByRole('button', { name: 'Pass' }).click();
  await page.getByRole('button', { name: 'Pass' }).click();

  await expect(page.getByRole('heading', { name: 'Manual endgame classification' })).toBeVisible();
  await expect(page.locator('.endgame-group')).toHaveCount(0);
  await expect(page.getByText('Classified 0 of 2')).toBeVisible();

  // Hovering either seam stone highlights the complete logical group with the same geometry.
  await point(page, '0,4').hover();
  const preview = page.locator(
    '.torus-board__endgame-line[data-endgame-status="preview"][data-endgame-temporary="true"]',
  );
  await expect(preview).toHaveCount(2);
  await expect(preview.first()).toHaveAttribute('opacity', '0.42');

  // Selecting by stone exposes exactly one group action set.
  await point(page, '0,4').click();
  await expect(page.getByText('2 stones')).toBeVisible();
  const statuses = page.getByRole('group', { name: 'Selected group status' });

  // Alive on black stones is solid white; status remains freely editable.
  await statuses.getByRole('button', { name: 'Alive', exact: true }).click();
  let blackLines = page.locator('.torus-board__endgame-line[data-endgame-status="alive"]');
  await expect(blackLines).toHaveCount(2);
  await expect(blackLines.first()).toHaveAttribute('stroke', '#ffffff');
  await expect(blackLines.first()).not.toHaveAttribute('stroke-dasharray', /.+/);

  await statuses.getByRole('button', { name: 'Dead', exact: true }).click();
  blackLines = page.locator('.torus-board__endgame-line[data-endgame-status="dead"]');
  await expect(blackLines.first()).toHaveAttribute('stroke', '#d32f2f');

  await statuses.getByRole('button', { name: 'Seki', exact: true }).click();
  blackLines = page.locator('.torus-board__endgame-line[data-endgame-status="seki"]');
  await expect(blackLines.first()).toHaveAttribute('stroke', '#7a7a7a');

  // Select the other group, then re-select black by clicking the already drawn line away from a stone hit radius.
  await point(page, '4,4').click();
  await expect(page.locator('.endgame-selection .stone-chip--white')).toHaveCount(1);
  await clickLineAwayFromStone(page, blackLines.first());
  await expect(page.locator('.endgame-selection .stone-chip--black')).toHaveCount(1);
  await expect(statuses.getByRole('button', { name: 'Seki', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // The new duplicate mode is a renderer-only edge overlay: it must not move or
  // duplicate the interactive endgame geometry. It only mirrors the seam stones.
  const cleanLineCount = await blackLines.count();
  const cleanGeometry = await blackLines.evaluateAll((lines) =>
    lines.map((line) => [
      line.getAttribute('x1'),
      line.getAttribute('y1'),
      line.getAttribute('x2'),
      line.getAttribute('y2'),
    ]),
  );
  await page.getByLabel('Показывать дублирующие области').check();
  await expect(page.locator('.torus-board')).toHaveAttribute('data-duplicate-regions-visible', 'true');
  blackLines = page.locator('.torus-board__endgame-line[data-endgame-status="seki"]');
  await expect(blackLines).toHaveCount(cleanLineCount);
  const duplicateGeometry = await blackLines.evaluateAll((lines) =>
    lines.map((line) => [
      line.getAttribute('x1'),
      line.getAttribute('y1'),
      line.getAttribute('x2'),
      line.getAttribute('y2'),
    ]),
  );
  expect(duplicateGeometry).toEqual(cleanGeometry);
  await expect(
    page.locator('.torus-board__edge-duplicate-stone[data-logical-point-id="8,4"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('.torus-board__edge-duplicate-stone[data-logical-point-id="0,4"]'),
  ).toHaveCount(1);
  expect(
    await blackLines.evaluateAll((lines) =>
      lines.every((line) => line.getAttribute('stroke') === '#7a7a7a'),
    ),
  ).toBe(true);

  // White Alive uses a solid black line.
  await point(page, '4,4').click();
  await statuses.getByRole('button', { name: 'Alive', exact: true }).click();
  const whiteLines = page.locator('.torus-board__endgame-line[data-endgame-status="alive"]');
  await expect(whiteLines.first()).toHaveAttribute('stroke', '#111111');
  await expect(page.getByText('Classified 2 of 2')).toBeVisible();
});
