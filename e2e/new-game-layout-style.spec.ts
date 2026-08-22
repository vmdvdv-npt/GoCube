import { expect, test } from '@playwright/test';

test('New Game uses the requested effective layout styles', async ({ page }) => {
  await page.goto('/');

  const header = page.locator('.app-header');
  const form = page.locator('.startup-card.new-game-form');
  const settingsGrid = page.getByTestId('new-game-settings-grid');
  const shapeColumn = page.getByTestId('new-game-shape-column');
  const detailsColumn = page.getByTestId('new-game-details-column');
  const topologyPreview = page.getByTestId('topology-preview');
  const boardShapeLabel = page.getByText('Board Shape', { exact: true });
  const boardSizeLabel = page.locator('legend').filter({ hasText: 'Board Size' });
  const rulesLabel = page.locator('.new-game-rules-komi label').filter({ hasText: 'Rules' });
  const komiLabel = page.locator('.new-game-rules-komi label').filter({ hasText: 'Komi' });
  const rules = page.getByLabel('Rules');
  const komi = page.getByLabel('Komi');

  await expect(page.getByRole('heading', { name: 'New game', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Choose the surface, board size, scoring rules, and komi.', { exact: true }),
  ).toHaveCount(0);

  const [headerStyle, formStyle, gridStyle, viewportHeight] = await Promise.all([
    header.evaluate((element) => {
      const style = getComputedStyle(element);
      return { marginBottom: Number.parseFloat(style.marginBottom) };
    }),
    form.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        paddingTop: Number.parseFloat(style.paddingTop),
        paddingRight: Number.parseFloat(style.paddingRight),
        paddingBottom: Number.parseFloat(style.paddingBottom),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        lineHeight: Number.parseFloat(style.lineHeight),
        fontSize: Number.parseFloat(style.fontSize),
      };
    }),
    settingsGrid.evaluate((element) => {
      const style = getComputedStyle(element);
      return { columnGap: Number.parseFloat(style.columnGap) };
    }),
    page.evaluate(() => window.innerHeight),
  ]);

  expect(headerStyle.marginBottom).toBeCloseTo(viewportHeight * 0.12, 1);
  expect(formStyle.paddingTop).toBe(30);
  expect(formStyle.paddingRight).toBe(45);
  expect(formStyle.paddingBottom).toBe(30);
  expect(formStyle.paddingLeft).toBe(45);
  expect(formStyle.lineHeight / formStyle.fontSize).toBeCloseTo(1.5, 2);
  expect(gridStyle.columnGap).toBe(80);

  const [shapeBox, detailsBox, previewBox, boardShapeBox, rulesBox, komiBox] = await Promise.all([
    shapeColumn.boundingBox(),
    detailsColumn.boundingBox(),
    topologyPreview.boundingBox(),
    boardShapeLabel.boundingBox(),
    rules.boundingBox(),
    komi.boundingBox(),
  ]);

  expect(shapeBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(boardShapeBox).not.toBeNull();
  expect(rulesBox).not.toBeNull();
  expect(komiBox).not.toBeNull();

  if (shapeBox && detailsBox) {
    expect(detailsBox.x - (shapeBox.x + shapeBox.width)).toBeCloseTo(80, 0);
    expect(detailsBox.width / shapeBox.width).toBeCloseTo(1.15 / 0.85, 1);
  }

  if (previewBox && boardShapeBox) {
    expect(boardShapeBox.y).toBeGreaterThanOrEqual(previewBox.y + previewBox.height);
  }

  if (rulesBox && komiBox) {
    expect(Math.abs(rulesBox.y - komiBox.y)).toBeLessThanOrEqual(3);
    expect(rulesBox.x).toBeLessThan(komiBox.x);
  }

  const labelStyles = await Promise.all(
    [boardShapeLabel, boardSizeLabel, rulesLabel, komiLabel].map((locator) =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return { fontSize: style.fontSize, fontWeight: style.fontWeight };
      }),
    ),
  );

  for (const style of labelStyles.slice(1)) {
    expect(style.fontSize).toBe(labelStyles[0].fontSize);
    expect(style.fontWeight).toBe(labelStyles[0].fontWeight);
  }
});
