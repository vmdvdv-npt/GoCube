import { expect, test } from '@playwright/test';

test('New Game uses the requested effective layout styles', async ({ page }) => {
  await page.goto('/');

  const header = page.locator('.app-header');
  const form = page.locator('.startup-card.new-game-form');
  const settingsGrid = page.getByTestId('new-game-settings-grid');
  const shapeColumn = page.getByTestId('new-game-shape-column');
  const detailsColumn = page.getByTestId('new-game-details-column');
  const rules = page.getByLabel('Rules');
  const komi = page.getByLabel('Komi');

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

  expect(headerStyle.marginBottom).toBeCloseTo(viewportHeight * 0.06, 1);
  expect(formStyle.paddingTop).toBe(30);
  expect(formStyle.paddingRight).toBe(45);
  expect(formStyle.paddingBottom).toBe(30);
  expect(formStyle.paddingLeft).toBe(45);
  expect(formStyle.lineHeight / formStyle.fontSize).toBeCloseTo(1.5, 2);
  expect(gridStyle.columnGap).toBe(50);

  const [shapeBox, detailsBox, rulesBox, komiBox] = await Promise.all([
    shapeColumn.boundingBox(),
    detailsColumn.boundingBox(),
    rules.boundingBox(),
    komi.boundingBox(),
  ]);

  expect(shapeBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(rulesBox).not.toBeNull();
  expect(komiBox).not.toBeNull();

  if (shapeBox && detailsBox) {
    expect(detailsBox.x - (shapeBox.x + shapeBox.width)).toBeCloseTo(50, 0);
    expect(detailsBox.width / shapeBox.width).toBeCloseTo(1.15 / 0.85, 1);
  }

  if (rulesBox && komiBox) {
    expect(Math.abs(rulesBox.y - komiBox.y)).toBeLessThanOrEqual(3);
    expect(rulesBox.x).toBeLessThan(komiBox.x);
  }
});
