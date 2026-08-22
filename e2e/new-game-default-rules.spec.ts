import { expect, test } from '@playwright/test';

test('new game uses board-size buttons and keeps Japanese rules as the default', async ({ page }) => {
  await page.goto('/');

  const sizes = page.locator('.board-size-options');
  const size9 = sizes.getByRole('button', { name: '9×9', exact: true });
  const size13 = sizes.getByRole('button', { name: '13×13', exact: true });
  const size19 = sizes.getByRole('button', { name: '19×19', exact: true });
  await expect(size9).toBeVisible();
  await expect(size13).toBeVisible();
  await expect(size19).toBeVisible();
  await expect(size9).toHaveAttribute('aria-pressed', 'true');

  const [size9Box, size13Box, size19Box] = await Promise.all([
    size9.boundingBox(),
    size13.boundingBox(),
    size19.boundingBox(),
  ]);
  expect(size9Box).not.toBeNull();
  expect(size13Box).not.toBeNull();
  expect(size19Box).not.toBeNull();
  if (size9Box && size13Box && size19Box) {
    expect(size9Box.y).toBeCloseTo(size13Box.y, 0);
    expect(size13Box.y).toBeCloseTo(size19Box.y, 0);
    expect(size9Box.x).toBeLessThan(size13Box.x);
    expect(size13Box.x).toBeLessThan(size19Box.x);
  }

  await size13.click();
  await expect(size13).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('13');
  await page.mouse.move(0, 0);
  await expect(size13).toHaveClass(/is-selected/);
  await expect
    .poll(() =>
      size13.evaluate((element) => getComputedStyle(element).backgroundImage),
    )
    .toContain('rgb(52, 66, 79)');

  const idleBackground = await size19.evaluate((element) => getComputedStyle(element).backgroundImage);
  await size19.hover();
  await expect
    .poll(() =>
      size19.evaluate((element) => getComputedStyle(element).backgroundImage),
    )
    .not.toBe(idleBackground);
  await expect
    .poll(() =>
      size19.evaluate((element) => getComputedStyle(element).backgroundImage),
    )
    .toContain('rgb(39, 53, 66)');

  const rules = page.getByLabel('Rules');
  await expect(rules.locator('option')).toHaveText(['Japanese', 'Chinese']);
  await expect(rules).toHaveValue('japanese');
  await expect(page.getByLabel('Komi')).toHaveValue('7.5');

  const startGame = page.getByRole('button', { name: 'Start game' });
  const startBackground = await startGame.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(startBackground).toContain('rgb(7, 49, 58)');

  await rules.selectOption('chinese');
  await startGame.click();
  await expect(page.getByText('Chinese rules')).toBeVisible();
  await expect(page.getByText('13×13', { exact: true })).toBeVisible();

  const inGameNewGame = page.getByRole('button', { name: 'New game', exact: true });
  const inGameBackground = await inGameNewGame.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(inGameBackground).toBe(startBackground);

  await inGameNewGame.click();
  await expect(page.getByRole('heading', { name: 'Start a new game?' })).toBeVisible();
  const confirmNewGame = page.getByRole('button', { name: 'New Game', exact: true });
  const confirmBackground = await confirmNewGame.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(confirmBackground).toBe(inGameBackground);
  await confirmNewGame.click();

  await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
  await expect(page.getByLabel('Rules').locator('option')).toHaveText(['Japanese', 'Chinese']);
  await expect(page.getByLabel('Rules')).toHaveValue('japanese');
});

test('new game uses a compact two-column layout with animated topology preview', async ({ page }) => {
  await page.goto('/');

  const preview = page.getByTestId('topology-preview');
  const previewImage = page.getByTestId('topology-preview-image');
  const cube = page.getByRole('button', { name: 'Cube', exact: true });
  const torus = page.getByRole('button', { name: 'Torus', exact: true });
  const shapeColumn = page.getByTestId('new-game-shape-column');
  const detailsColumn = page.getByTestId('new-game-details-column');

  await expect(page.getByRole('group', { name: 'Board Shape' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Board Size' })).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toHaveCount(1);
  await expect(previewImage).toHaveAttribute('src', '/assets/board/torus.svg');
  await expect(previewImage).toHaveAttribute('alt', 'Torus topology preview');
  await expect(cube.locator('img, svg')).toHaveCount(0);
  await expect(torus.locator('img, svg')).toHaveCount(0);

  const [cubeBox, torusBox, previewBox, shapeBox, detailsBox] = await Promise.all([
    cube.boundingBox(),
    torus.boundingBox(),
    preview.boundingBox(),
    shapeColumn.boundingBox(),
    detailsColumn.boundingBox(),
  ]);
  expect(cubeBox).not.toBeNull();
  expect(torusBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(shapeBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  if (cubeBox && torusBox) {
    expect(cubeBox.y).toBeCloseTo(torusBox.y, 0);
    expect(cubeBox.x).toBeLessThan(torusBox.x);
    expect(cubeBox.height).toBeGreaterThanOrEqual(38);
    expect(cubeBox.height).toBeLessThanOrEqual(52);
  }
  if (shapeBox && detailsBox) {
    expect(shapeBox.y).toBeCloseTo(detailsBox.y, 0);
    expect(shapeBox.x).toBeLessThan(detailsBox.x);
    expect(detailsBox.width).toBeGreaterThan(shapeBox.width);
  }

  await cube.click();
  await expect(cube).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('4');
  await expect(preview.locator('.topology-preview__image--exit-right')).toHaveAttribute(
    'src',
    '/assets/board/torus.svg',
  );
  await expect(preview.locator('.topology-preview__image--enter-from-left')).toHaveAttribute(
    'src',
    '/assets/board/cube.svg',
  );
  await expect(preview.locator('img')).toHaveCount(1, { timeout: 1_000 });
  await expect(page.getByTestId('topology-preview-image')).toHaveAttribute(
    'src',
    '/assets/board/cube.svg',
  );

  const cubePreviewBox = await preview.boundingBox();
  expect(cubePreviewBox).not.toBeNull();
  if (previewBox && cubePreviewBox) {
    expect(cubePreviewBox.height).toBeCloseTo(previewBox.height, 0);
  }

  await torus.click();
  await expect(torus).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('9');
  await expect(preview.locator('.topology-preview__image--exit-left')).toHaveAttribute(
    'src',
    '/assets/board/cube.svg',
  );
  await expect(preview.locator('.topology-preview__image--enter-from-right')).toHaveAttribute(
    'src',
    '/assets/board/torus.svg',
  );

  await cube.click();
  await torus.click();
  await cube.click();
  await expect(cube).toHaveAttribute('aria-pressed', 'true');
  await expect(preview.locator('img')).toHaveCount(1, { timeout: 1_000 });
  await expect(page.getByTestId('topology-preview-image')).toHaveAttribute(
    'src',
    '/assets/board/cube.svg',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test('normalizes committed komi and remembers the normalized value for the next game', async ({ page }) => {
  await page.goto('/');

  const cases = [
    ['6.9', '6.5'],
    ['7.0', '7.5'],
    ['3.1415', '3.5'],
    ['7.5', '7.5'],
  ] as const;

  for (const [input, expected] of cases) {
    await page.getByLabel('Komi').fill(input);
    await page.getByRole('button', { name: 'Start game' }).click();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Continue saved game?' })).toBeVisible();
    await expect(page.locator('.startup-card p')).toContainText(`Komi ${expected}`);

    await page.getByRole('button', { name: 'New game', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New game' })).toBeVisible();
    await expect(page.getByLabel('Komi')).toHaveValue(expected);
  }

  await page.reload();
  await expect(page.getByLabel('Komi')).toHaveValue('7.5');
});

test('Cube adds 6×6 and 7×7 beside 5×5 in the second size row', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube', exact: true }).click();

  const size5 = page.getByRole('button', { name: '5×5', exact: true });
  const size6 = page.getByRole('button', { name: '6×6', exact: true });
  const size7 = page.getByRole('button', { name: '7×7', exact: true });

  await expect(size5).toBeVisible();
  await expect(size6).toBeVisible();
  await expect(size7).toBeVisible();

  const [size5Box, size6Box, size7Box] = await Promise.all([
    size5.boundingBox(),
    size6.boundingBox(),
    size7.boundingBox(),
  ]);
  expect(size5Box).not.toBeNull();
  expect(size6Box).not.toBeNull();
  expect(size7Box).not.toBeNull();
  if (size5Box && size6Box && size7Box) {
    expect(size5Box.y).toBeCloseTo(size6Box.y, 0);
    expect(size6Box.y).toBeCloseTo(size7Box.y, 0);
    expect(size5Box.x).toBeLessThan(size6Box.x);
    expect(size6Box.x).toBeLessThan(size7Box.x);
  }

  await size6.click();
  await expect(size6).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('6');

  await size7.click();
  await expect(size7).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('7');
});

test('remembers the last started board type and board size separately for Torus and Cube', async ({ page }) => {
  await page.goto('/');

  const torus = page.getByRole('button', { name: 'Torus', exact: true });
  const cube = page.getByRole('button', { name: 'Cube', exact: true });

  await expect(torus).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('topology-preview-image')).toHaveAttribute(
    'src',
    '/assets/board/torus.svg',
  );
  await page.getByRole('button', { name: '13×13', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(torus).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('13');
  await expect(page.getByTestId('topology-preview-image')).toHaveAttribute(
    'src',
    '/assets/board/torus.svg',
  );

  await cube.click();
  await expect(page.getByLabel('Board size')).toHaveValue('4');
  await page.getByRole('button', { name: '6×6', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();

  await page.getByRole('button', { name: 'New game', exact: true }).click();
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await expect(cube).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('6');
  await expect(page.getByTestId('topology-preview-image')).toHaveAttribute(
    'src',
    '/assets/board/cube.svg',
  );

  await torus.click();
  await expect(page.getByLabel('Board size')).toHaveValue('13');
  await cube.click();
  await expect(page.getByLabel('Board size')).toHaveValue('6');

  await page.reload();
  await expect(cube).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Board size')).toHaveValue('6');
  await expect(page.getByTestId('topology-preview-image')).toHaveAttribute(
    'src',
    '/assets/board/cube.svg',
  );
});
