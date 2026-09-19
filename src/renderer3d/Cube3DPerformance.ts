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
 * The browser diagnostic exercises the real mounted Renderer3D runtime under repeated interaction
 * and lifecycle churn. The same budgets must be rerun unchanged when the proof cube is replaced by
 * the representative gameplay scene; only that later run can establish full-scene performance.
 */
export type Cube3DPerformanceBudget = typeof CUBE_3D_PERFORMANCE_BUDGET;
