import { expect, test, type Page } from '@playwright/test';
import { CUBE_3D_PERFORMANCE_BUDGET } from '../src/renderer3d/Cube3DPerformance';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start game' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'development', exact: true })).toBeVisible();
});

const startCubeGame = async (page: Page) => {
  await page.getByRole('button', { name: 'Cube', exact: true }).click();
  await page.getByRole('button', { name: '3×3', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
};

const cubeViewSwitch = (page: Page) => page.getByRole('group', { name: 'Cube view' });
const ENFORCE_CUBE_3D_INTERACTION_BUDGET = process.env.CUBE3D_ENFORCE_PERF === '1';

test('Cube starts in 2D and switches to the isolated 3D scene without changing the game', async ({ page }) => {
  await startCubeGame(page);

  const view = cubeViewSwitch(page);
  await expect(view.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cube-2d-renderer')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Board display options' })).toContainText(
    'Move numbers',
  );
  await expect(page.getByRole('link', { name: 'development', exact: true })).toHaveCount(0);

  const point = page.locator('.cube-2d-hit-area[data-point-id="front:1:1"]');
  await point.click();
  await expect(page.locator('.cube-2d-stone[data-logical-point-id="front:1:1"]')).toHaveCount(1);

  await view.getByRole('button', { name: '3D' }).click();
  await expect(view.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Cube 3D view')).toBeVisible();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);

  await view.getByRole('button', { name: '2D' }).click();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(0);
  await expect(page.locator('.cube-2d-stone[data-logical-point-id="front:1:1"]')).toHaveCount(1);
  await expect(page.getByText('Move 1', { exact: true })).toBeVisible();
});

test('Three.js stays lazy until the user enters Cube 3D', async ({ page }) => {
  const threeRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/node_modules/.vite/deps/three')) threeRequests.push(url);
  });

  await startCubeGame(page);
  expect(threeRequests).toHaveLength(0);

  await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);
  expect(threeRequests.length).toBeGreaterThan(0);
});

test('Cube 3D anchor, free rotation and zoom survive a temporary switch to 2D', async ({ page }) => {
  await startCubeGame(page);
  const view = cubeViewSwitch(page);
  await view.getByRole('button', { name: '3D' }).click();

  const scene = page.getByLabel('Cube 3D scene');
  const canvas = page.locator('[data-testid="cube-3d-canvas"]');
  await expect(canvas).toHaveCount(1);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.42, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -240);

  const rotation = await scene.getAttribute('data-cube3d-rotation');
  const zoom = await scene.getAttribute('data-cube3d-zoom');
  const anchor = await scene.getAttribute('data-cube3d-anchor');
  expect(rotation).not.toBe('0.000000,0.000000,0.000000,1.000000');
  expect(zoom).not.toBe('1.0000');
  expect(anchor).toBeTruthy();

  await view.getByRole('button', { name: '2D' }).click();
  await expect(canvas).toHaveCount(0);
  await expect(page.locator('[data-cube2d-anchor]')).toHaveAttribute('data-cube2d-anchor', anchor ?? '');

  await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
  await expect(page.getByLabel('Cube 3D scene')).toHaveAttribute('data-cube3d-anchor', anchor ?? '');
  await expect(page.getByLabel('Cube 3D scene')).toHaveAttribute('data-cube3d-rotation', rotation ?? '');
  await expect(page.getByLabel('Cube 3D scene')).toHaveAttribute('data-cube3d-zoom', zoom ?? '');
});

test('Cube 2D navigation becomes the Cube 3D spatial anchor', async ({ page }) => {
  await startCubeGame(page);

  const anchorLayer = page.locator('[data-cube2d-anchor]');
  const moveRight = page.getByRole('button', { name: 'Move cube right' });
  const initialAnchor = await anchorLayer.getAttribute('data-cube2d-anchor');
  await moveRight.click();
  await expect(moveRight).toBeDisabled();
  await expect(moveRight).toBeEnabled();
  const navigatedAnchor = await anchorLayer.getAttribute('data-cube2d-anchor');
  expect(navigatedAnchor).toBeTruthy();
  expect(navigatedAnchor).not.toBe(initialAnchor);

  await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
  await expect(page.getByLabel('Cube 3D scene')).toHaveAttribute(
    'data-cube3d-anchor',
    navigatedAnchor ?? '',
  );
});

test('Cube 3D resize and repeated mount/unmount do not accumulate canvases', async ({ page }) => {
  await startCubeGame(page);

  for (let cycle = 0; cycle < CUBE_3D_PERFORMANCE_BUDGET.automatedLifecycleCycles; cycle += 1) {
    await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
    await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(
      CUBE_3D_PERFORMANCE_BUDGET.maxLiveCanvases,
    );
    await cubeViewSwitch(page).getByRole('button', { name: '2D' }).click();
    await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(
      CUBE_3D_PERFORMANCE_BUDGET.maxResidualCanvasesAfterUnmount,
    );
  }

  await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
  const scene = page.getByLabel('Cube 3D scene');
  const before = await scene.getAttribute('data-cube3d-viewport');
  await page.setViewportSize({ width: 800, height: 600 });
  await expect(scene).not.toHaveAttribute('data-cube3d-viewport', before ?? '');
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);
});

test('Cube 3D Chromium diagnostic records interaction metrics and enforces heap budget', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium CDP is required for deterministic heap diagnostics.');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: CUBE_3D_PERFORMANCE_BUDGET.referenceViewport.width,
    height: CUBE_3D_PERFORMANCE_BUDGET.referenceViewport.height,
    deviceScaleFactor: CUBE_3D_PERFORMANCE_BUDGET.referenceViewport.browserZoomPercent / 100,
    mobile: false,
  });

  await startCubeGame(page);
  await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
  await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);

  const interaction = await page.evaluate(
    async ({ warmupFrames, sampleFrames }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="cube-3d-canvas"]');
      if (!canvas) throw new Error('Cube 3D canvas is not mounted');

      const frameTimes: number[] = [];
      let previous = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      const totalFrames = warmupFrames + sampleFrames;

      for (let frame = 0; frame < totalFrames; frame += 1) {
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: frame % 2 === 0 ? -1 : 1,
            bubbles: true,
            cancelable: true,
          }),
        );
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        if (frame >= warmupFrames) frameTimes.push(now - previous);
        previous = now;
      }

      const sorted = [...frameTimes].sort((a, b) => a - b);
      const averageFrameMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
      const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      return {
        fps: 1000 / averageFrameMs,
        p95FrameMs: sorted[p95Index] ?? Number.POSITIVE_INFINITY,
      };
    },
    {
      warmupFrames: CUBE_3D_PERFORMANCE_BUDGET.benchmarkWarmupFrames,
      sampleFrames: CUBE_3D_PERFORMANCE_BUDGET.benchmarkSampleFrames,
    },
  );

  console.log(
    'CUBE_3D_INTERACTION_DIAGNOSTIC',
    JSON.stringify({
      ...interaction,
      targetFps: CUBE_3D_PERFORMANCE_BUDGET.interactionTargetFps,
      targetP95FrameMs: CUBE_3D_PERFORMANCE_BUDGET.interactionP95FrameMs,
      absoluteBudgetEnforced: ENFORCE_CUBE_3D_INTERACTION_BUDGET,
    }),
  );
  expect(interaction.fps).toBeGreaterThan(0);
  expect(Number.isFinite(interaction.p95FrameMs)).toBe(true);
  if (ENFORCE_CUBE_3D_INTERACTION_BUDGET) {
    expect(interaction.fps).toBeGreaterThanOrEqual(CUBE_3D_PERFORMANCE_BUDGET.interactionTargetFps);
    expect(interaction.p95FrameMs).toBeLessThanOrEqual(
      CUBE_3D_PERFORMANCE_BUDGET.interactionP95FrameMs,
    );
  }

  await cubeViewSwitch(page).getByRole('button', { name: '2D' }).click();
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const heapBefore = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };

  for (let cycle = 0; cycle < CUBE_3D_PERFORMANCE_BUDGET.diagnosticLifecycleCycles; cycle += 1) {
    await cubeViewSwitch(page).getByRole('button', { name: '3D' }).click();
    await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(1);
    await cubeViewSwitch(page).getByRole('button', { name: '2D' }).click();
    await expect(page.locator('[data-testid="cube-3d-canvas"]')).toHaveCount(0);
  }

  await cdp.send('HeapProfiler.collectGarbage');
  const heapAfter = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
  const heapDriftMb = (heapAfter.usedSize - heapBefore.usedSize) / (1024 * 1024);
  console.log(
    'CUBE_3D_HEAP_DIAGNOSTIC',
    JSON.stringify({
      heapDriftMb,
      cycles: CUBE_3D_PERFORMANCE_BUDGET.diagnosticLifecycleCycles,
      maxHeapDriftMb: CUBE_3D_PERFORMANCE_BUDGET.maxHeapDriftMbAfterDiagnosticCycles,
    }),
  );
  expect(heapDriftMb).toBeLessThanOrEqual(
    CUBE_3D_PERFORMANCE_BUDGET.maxHeapDriftMbAfterDiagnosticCycles,
  );
});

test('Torus does not expose the Cube 2D/3D switch', async ({ page }) => {
  await page.getByRole('button', { name: 'Torus', exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('group', { name: 'Cube view' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Board display options' })).toContainText(
    'Move numbers',
  );
  await expect(page.getByRole('link', { name: 'development', exact: true })).toHaveCount(0);
});
