import { expect, test, type Page } from '@playwright/test';

const cubeHit = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-hit-area[data-point-id="${pointId}"]`);

const cubeStone = (page: Page, pointId: string) =>
  page.locator(`.cube-2d-stone[data-logical-point-id="${pointId}"]`);

const startCube = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cube 2D', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByLabel('Rules').selectOption('chinese');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-cube-size', '3');
};

const startTorus = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.getByLabel('Board size').selectOption('9');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.torus-board')).toBeVisible();
};

const wheelAt = async (page: Page, locator: ReturnType<Page['locator']>, deltaY: number) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Expected wheel target bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
};

const comparePngScreenshots = async (
  page: Page,
  before: Buffer,
  after: Buffer,
): Promise<Readonly<{ sameDimensions: boolean; meanChannelDelta: number; changedPixelRatio: number }>> =>
  page.evaluate(
    async ({ beforeBase64, afterBase64 }) => {
      const load = async (base64: string): Promise<HTMLImageElement> => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Could not decode screenshot PNG'));
        });
        return image;
      };

      const [beforeImage, afterImage] = await Promise.all([load(beforeBase64), load(afterBase64)]);
      if (
        beforeImage.naturalWidth !== afterImage.naturalWidth ||
        beforeImage.naturalHeight !== afterImage.naturalHeight
      ) {
        return { sameDimensions: false, meanChannelDelta: Number.POSITIVE_INFINITY, changedPixelRatio: 1 };
      }

      const width = beforeImage.naturalWidth;
      const height = beforeImage.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas 2D context is unavailable');

      context.clearRect(0, 0, width, height);
      context.drawImage(beforeImage, 0, 0);
      const beforePixels = context.getImageData(0, 0, width, height).data;
      context.clearRect(0, 0, width, height);
      context.drawImage(afterImage, 0, 0);
      const afterPixels = context.getImageData(0, 0, width, height).data;

      let totalChannelDelta = 0;
      let changedPixels = 0;
      for (let index = 0; index < beforePixels.length; index += 4) {
        let pixelDelta = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(beforePixels[index + channel]! - afterPixels[index + channel]!);
          totalChannelDelta += delta;
          pixelDelta = Math.max(pixelDelta, delta);
        }
        if (pixelDelta > 8) changedPixels += 1;
      }

      return {
        sameDimensions: true,
        meanChannelDelta: totalChannelDelta / beforePixels.length,
        changedPixelRatio: changedPixels / (width * height),
      };
    },
    { beforeBase64: before.toString('base64'), afterBase64: after.toString('base64') },
  );

const expectCubeVectorSteadyState = async (page: Page, zoom: number): Promise<void> => {
  const stage = page.locator('.cube-2d-game__stage');
  await expect(stage).toHaveAttribute('data-view-zoom', zoom.toFixed(3));
  const state = await page.evaluate(() => {
    const stageElement = document.querySelector<HTMLElement>('.cube-2d-game__stage')!;
    const board = document.querySelector<HTMLElement>('.cube-2d-board')!;
    return {
      stageTransform: getComputedStyle(stageElement).transform,
      boardWillChange: getComputedStyle(board).willChange,
    };
  });
  expect(state.stageTransform).toBe('none');
  expect(state.boardWillChange).toBe('auto');

  const hit = cubeHit(page, 'front:1:1');
  const box = await hit.boundingBox();
  if (!box) throw new Error('Expected Cube hit target bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(
    page.locator('.cube-2d-preview-stone[data-logical-point-id="front:1:1"]'),
  ).toHaveCount(1);
};

for (const [zoom, deltaY] of [
  [0.78, 1000],
  [1, 0],
  [1.35, -1000],
] as const) {
  test(`Cube zoom ${zoom} uses real layout size and keeps hit-testing aligned`, async ({ page }) => {
    await startCube(page);
    if (deltaY !== 0) await wheelAt(page, page.locator('.cube-2d-game__viewport'), deltaY);
    await expectCubeVectorSteadyState(page, zoom);

    await page.getByRole('button', { name: 'Move cube right' }).click();
    await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'true');
    const movingWillChange = await page.locator('.cube-2d-board--moving').first().evaluate(
      (element) => getComputedStyle(element).willChange,
    );
    expect(movingWillChange).toContain('transform');
    await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'false', {
      timeout: 1000,
    });
    await expectCubeVectorSteadyState(page, zoom);

    const slot = page.locator('.cube-2d-anchor-slot[data-layout-row="0"][data-layout-column="0"]');
    await slot.click();
    await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-vertical-anchor-column', '0', {
      timeout: 1000,
    });
    await expect(page.locator('.cube-2d-renderer')).toHaveAttribute('data-animating', 'false');
    await expectCubeVectorSteadyState(page, zoom);
  });
}

for (const [zoom, deltaY] of [
  [0.7, 1000],
  [1, 0],
  [1.5, -Math.log(1.5) / 0.0015],
  [2.5, -1000],
] as const) {
  test(`Torus zoom ${zoom} uses an SVG viewBox camera and preserves hit-testing`, async ({ page }) => {
    await startTorus(page);
    const svg = page.locator('.torus-board');
    if (deltaY !== 0) await wheelAt(page, svg, deltaY);

    const actualZoom = Number(await svg.getAttribute('data-view-zoom'));
    expect(actualZoom).toBeCloseTo(zoom, 2);
    await expect(svg).toHaveAttribute('data-vector-camera', 'viewBox');
    const state = await svg.evaluate((element) => {
      const root = element as SVGSVGElement;
      return {
        transform: getComputedStyle(root).transform,
        scale: getComputedStyle(root).scale,
        viewBox: root.getAttribute('viewBox'),
      };
    });
    expect(state.transform).toBe('none');
    expect(state.scale === 'none' || state.scale === '1').toBe(true);
    expect(state.viewBox).not.toBe('0 0 1000 1000');

    const center = page.locator(
      '.torus-board__hit-target[data-logical-point-id="4,4"][data-copy-role="primary"]',
    );
    await center.hover();
    await expect(
      page.locator('.torus-board__preview-stone[data-logical-point-id="4,4"]'),
    ).toHaveCount(1);
  });
}

const captureParityAtCurrentDpr = async (page: Page): Promise<void> => {
  await startCube(page);
  await wheelAt(page, page.locator('.cube-2d-game__viewport'), -1000);
  await expect(page.locator('.cube-2d-game__stage')).toHaveAttribute('data-view-zoom', '1.350');

  const movesBeforeCapture = [
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
  ];
  for (const pointId of movesBeforeCapture) await cubeHit(page, pointId).click();

  const candidates = ['front:1:2', 'right:1:0'] as const;
  const before = new Map<string, { box: NonNullable<Awaited<ReturnType<ReturnType<typeof cubeStone>['boundingBox']>>>; screenshot: Buffer; filter: string }>();
  for (const pointId of candidates) {
    const locator = cubeStone(page, pointId);
    const box = await locator.boundingBox();
    if (!box) throw new Error(`Expected pre-capture stone ${pointId}`);
    before.set(pointId, {
      box,
      screenshot: await locator.screenshot(),
      filter: await locator.evaluate((element) => getComputedStyle(element).filter),
    });
  }

  await page.evaluate(() => {
    const state = window as unknown as { __cubeCapturePaused?: boolean; __cubeCaptureObserver?: MutationObserver };
    const observer = new MutationObserver(() => {
      const captureSvg = document.querySelector<SVGSVGElement>('.cube-2d-effects__capture-stage');
      if (!captureSvg) return;
      captureSvg.pauseAnimations();
      state.__cubeCapturePaused = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    state.__cubeCaptureObserver = observer;
  });

  await cubeHit(page, 'right:1:1').click();
  const captures = page.locator('.cube-2d-captured-stone');
  await expect(captures).toHaveCount(2);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __cubeCapturePaused?: boolean }).__cubeCapturePaused),
  );

  const delays = await captures.evaluateAll((elements) =>
    elements.map((element) => Number(element.getAttribute('data-capture-delay-ms'))),
  );
  expect(delays).toEqual([0, 150]);

  const directions = await captures.evaluateAll((elements) =>
    elements.map((element) => ({
      color: element.getAttribute('data-captured-color'),
      direction: element.getAttribute('data-capture-direction'),
      artwork: element.getAttribute('data-stone-artwork'),
      fill: element.getAttribute('fill'),
      stroke: element.getAttribute('stroke'),
    })),
  );
  for (const item of directions) {
    expect(item.direction).toBe(item.color === 'white' ? 'left' : 'right');
    expect(item.artwork).toBe('custom-svg');
    expect(item.fill).toMatch(/^url\(#cube-2d-capture-artwork-/);
    expect(item.stroke).toBe('none');
  }

  const firstCapture = captures.first();
  const capturedPointId = await firstCapture.getAttribute('data-logical-point-id');
  if (!capturedPointId) throw new Error('Capture effect is missing PointId');
  const normal = before.get(capturedPointId);
  if (!normal) throw new Error(`No pre-capture screenshot for ${capturedPointId}`);
  const captureBox = await firstCapture.boundingBox();
  if (!captureBox) throw new Error('Expected first-frame capture bounding box');

  const centerDeltaX = Math.abs(
    normal.box.x + normal.box.width / 2 - (captureBox.x + captureBox.width / 2),
  );
  const centerDeltaY = Math.abs(
    normal.box.y + normal.box.height / 2 - (captureBox.y + captureBox.height / 2),
  );
  expect(centerDeltaX).toBeLessThanOrEqual(0.5);
  expect(centerDeltaY).toBeLessThanOrEqual(0.5);
  expect(await firstCapture.evaluate((element) => getComputedStyle(element).filter)).toBe(normal.filter);

  const captureScreenshot = await firstCapture.screenshot();
  const visualDelta = await comparePngScreenshots(page, normal.screenshot, captureScreenshot);
  expect(visualDelta.sameDimensions).toBe(true);
  expect(visualDelta.meanChannelDelta).toBeLessThanOrEqual(2);
  // The source and capture circles live in different SVG viewports. Chromium can
  // cover a one-device-pixel antialias fringe differently even with identical
  // geometry and paint. Keep a narrow allowance for that fringe while the exact
  // center, bounding box, shared artwork, stroke and drop-shadow are asserted above.
  expect(visualDelta.changedPixelRatio).toBeLessThanOrEqual(0.06);

  await page.waitForTimeout(850);
  await expect(captures).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(captures).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(captures).toHaveCount(0);
};

test.describe('Cube capture first-frame screenshot DPR 1', () => {
  test.use({ deviceScaleFactor: 1 });
  test('matches the normal shared-artwork stone without a position jump', async ({ page }) => {
    await captureParityAtCurrentDpr(page);
  });
});

test.describe('Cube capture first-frame screenshot DPR 1.5', () => {
  test.use({ deviceScaleFactor: 1.5 });
  test('matches the normal shared-artwork stone without a position jump', async ({ page }) => {
    await captureParityAtCurrentDpr(page);
  });
});