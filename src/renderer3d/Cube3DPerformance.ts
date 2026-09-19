export const CUBE_3D_PERFORMANCE_BUDGET = Object.freeze({
  referenceViewport: Object.freeze({ width: 1920, height: 1080, browserZoomPercent: 150 }),
  maxDevicePixelRatio: 2,
  interactionTargetFps: 55,
  interactionP95FrameMs: 25,
  automatedLifecycleCycles: 8,
  diagnosticLifecycleCycles: 20,
  maxLiveCanvases: 1,
  maxResidualCanvasesAfterUnmount: 0,
  maxHeapDriftMbAfterDiagnosticCycles: 10,
});

/**
 * FPS/heap values are local diagnostic targets until the representative gameplay scene exists.
 * Deterministic CI gates use lifecycle/resource counts, lazy loading and resize/state preservation.
 */
export type Cube3DPerformanceBudget = typeof CUBE_3D_PERFORMANCE_BUDGET;
