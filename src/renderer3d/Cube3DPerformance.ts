export const CUBE_3D_PERFORMANCE_BUDGET = Object.freeze({
  referenceViewport: Object.freeze({ width: 1920, height: 1080, browserZoomPercent: 150 }),
  maxDevicePixelRatio: 2,
  interactionTargetFps: 55,
  interactionP95FrameMs: 25,
  benchmarkWarmupFrames: 15,
  benchmarkSampleFrames: 90,
  automatedLifecycleCycles: 8,
  diagnosticLifecycleCycles: 20,
  maxLiveCanvases: 1,
  maxResidualCanvasesAfterUnmount: 0,
  maxHeapDriftMbAfterDiagnosticCycles: 10,
});

/**
 * Chromium CI always records real mounted Renderer3D interaction and heap metrics. Shared hosted
 * runners are not a representative GPU/browser environment, so absolute FPS/p95 targets are only
 * hard-enforced when CUBE3D_ENFORCE_PERF=1. Lifecycle/resource cleanup remains a deterministic CI
 * gate. The same targets must be rerun unchanged on the representative gameplay scene; only that
 * later run can establish full-scene performance.
 */
export type Cube3DPerformanceBudget = typeof CUBE_3D_PERFORMANCE_BUDGET;
