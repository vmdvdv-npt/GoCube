export const SHARED_3D_PERFORMANCE_BUDGET = Object.freeze({
  referenceViewport: Object.freeze({ width: 1920, height: 1080, browserZoomPercent: 150 }),
  maxDevicePixelRatio: 2,
  motionMaxPixelRatio: 1,
  motionMaxPixels: 1_500_000,
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

export type Shared3DPerformanceBudget = typeof SHARED_3D_PERFORMANCE_BUDGET;

/** Bound fragment work while the object is moving; resting views keep their full DPR. */
export const shared3DMotionPixelRatio = (idleRatio: number, width: number, height: number): number =>
  Math.min(
    idleRatio,
    SHARED_3D_PERFORMANCE_BUDGET.motionMaxPixelRatio,
    Math.sqrt(SHARED_3D_PERFORMANCE_BUDGET.motionMaxPixels / Math.max(1, width * height)),
  );
