import { expect, test } from '@playwright/test';

test('New Game uses the requested effective layout styles', async ({ page }) => {
  await page.goto('/');

  const header = page.locator('.app-header');
  const form = page.locator('.startup-card.new-game-form');
  const settingsGrid = page.getByTestId('new-game-settings-grid');
  const shapeColumn = page.getByTestId('new-game-shape-column');
  const divider = page.getByTestId('new-game-column-divider');
  const detailsColumn = page.getByTestId('new-game-details-column');
  const topologyPreview = page.getByTestId('topology-preview');
  const boardShapeLabel = page.getByText('Board Shape', { exact: true });
  const boardSizeLabel = page.locator('legend').filter({ hasText: 'Board Size' });
  const rulesLabel = page.locator('.new-game-rules-komi label').filter({ hasText: 'Rules' });
  const komiLabel = page.locator('.new-game-rules-komi label').filter({ hasText: 'Komi' });
  const cubeButton = page.getByRole('button', { name: 'Cube', exact: true });
  const torusButton = page.getByRole('button', { name: 'Torus', exact: true });
  const startGameButton = page.getByRole('button', { name: 'Start game', exact: true });
  const rules = page.getByLabel('Rules');
  const komi = page.getByLabel('Komi');

  await expect(page.getByRole('heading', { name: 'New game', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Choose the surface, board size, scoring rules, and komi.', { exact: true }),
  ).toHaveCount(0);

  const [headerStyle, formStyle, gridStyle, dividerStyle, detailsStyle, viewportHeight] =
    await Promise.all([
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
        return {
          columnGap: Number.parseFloat(style.columnGap),
          gridTemplateColumns: style.gridTemplateColumns,
        };
      }),
      divider.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          width: Number.parseFloat(style.width),
          opacity: Number.parseFloat(style.opacity),
          backgroundImage: style.backgroundImage,
        };
      }),
      detailsColumn.evaluate((element) => ({ alignContent: getComputedStyle(element).alignContent })),
      page.evaluate(() => window.innerHeight),
    ]);

  expect(headerStyle.marginBottom).toBeCloseTo(viewportHeight * 0.12, 1);
  expect(formStyle.paddingTop).toBe(10);
  expect(formStyle.paddingRight).toBe(45);
  expect(formStyle.paddingBottom).toBe(30);
  expect(formStyle.paddingLeft).toBe(45);
  expect(formStyle.lineHeight / formStyle.fontSize).toBeCloseTo(1.5, 2);
  expect(gridStyle.columnGap).toBe(0);
  expect(gridStyle.gridTemplateColumns.split(' ')).toHaveLength(3);
  expect(dividerStyle.width).toBe(1);
  expect(dividerStyle.opacity).toBeCloseTo(0.4, 2);
  expect(dividerStyle.backgroundImage).toContain('15%');
  expect(dividerStyle.backgroundImage).toContain('85%');
  expect(detailsStyle.alignContent).toBe('start');

  const [
    shapeBox,
    dividerBox,
    detailsBox,
    previewBox,
    boardShapeBox,
    cubeBox,
    torusBox,
    startGameBox,
    rulesBox,
    komiBox,
  ] = await Promise.all([
    shapeColumn.boundingBox(),
    divider.boundingBox(),
    detailsColumn.boundingBox(),
    topologyPreview.boundingBox(),
    boardShapeLabel.boundingBox(),
    cubeButton.boundingBox(),
    torusButton.boundingBox(),
    startGameButton.boundingBox(),
    rules.boundingBox(),
    komi.boundingBox(),
  ]);

  expect(shapeBox).not.toBeNull();
  expect(dividerBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(boardShapeBox).not.toBeNull();
  expect(cubeBox).not.toBeNull();
  expect(torusBox).not.toBeNull();
  expect(startGameBox).not.toBeNull();
  expect(rulesBox).not.toBeNull();
  expect(komiBox).not.toBeNull();

  if (shapeBox && dividerBox && detailsBox) {
    const contentGap = detailsBox.x - (shapeBox.x + shapeBox.width);
    const dividerCenter = dividerBox.x + dividerBox.width / 2;
    const gapCenter = shapeBox.x + shapeBox.width + contentGap / 2;

    expect(contentGap).toBeCloseTo(80, 0);
    expect(detailsBox.width / shapeBox.width).toBeCloseTo(1.15 / 0.85, 1);
    expect(dividerCenter).toBeCloseTo(gapCenter, 0);
  }

  if (detailsBox && startGameBox) {
    expect(startGameBox.y + startGameBox.height).toBeCloseTo(
      detailsBox.y + detailsBox.height,
      0,
    );
  }

  if (previewBox && boardShapeBox) {
    expect(boardShapeBox.y).toBeGreaterThanOrEqual(previewBox.y + previewBox.height);
  }

  if (boardShapeBox && cubeBox && torusBox) {
    expect(cubeBox.y).toBeGreaterThan(boardShapeBox.y);
    expect(torusBox.y).toBeGreaterThan(boardShapeBox.y);
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

test('New Game grows with additional right-column settings and keeps Start game last', async ({
  page,
}) => {
  await page.goto('/');

  const form = page.locator('.startup-card.new-game-form');
  const detailsColumn = page.getByTestId('new-game-details-column');
  const startGameButton = page.getByRole('button', { name: 'Start game', exact: true });

  const before = await Promise.all([form.boundingBox(), startGameButton.boundingBox()]);

  await detailsColumn.evaluate((element) => {
    const startButton = element.querySelector('.start-game-button');
    if (!startButton) throw new Error('Start game button not found');

    const extraSettings = document.createElement('div');
    extraSettings.dataset.testid = 'simulated-extra-settings';
    extraSettings.style.height = '260px';
    element.insertBefore(extraSettings, startButton);
  });

  const [formBox, detailsBox, startGameBox] = await Promise.all([
    form.boundingBox(),
    detailsColumn.boundingBox(),
    startGameButton.boundingBox(),
  ]);

  expect(before[0]).not.toBeNull();
  expect(before[1]).not.toBeNull();
  expect(formBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(startGameBox).not.toBeNull();

  if (before[0] && before[1] && formBox && detailsBox && startGameBox) {
    expect(startGameBox.y).toBeGreaterThan(before[1].y + 250);
    expect(formBox.height).toBeGreaterThan(before[0].height + 100);
    expect(startGameBox.y + startGameBox.height).toBeCloseTo(
      detailsBox.y + detailsBox.height,
      0,
    );
  }
});
