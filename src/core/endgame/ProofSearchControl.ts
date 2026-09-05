export const DEFAULT_COOPERATIVE_QUANTUM_MILLISECONDS = 8;

export type ProofSearchControlStopReason = 'hard-time-budget' | 'cancelled';

export interface ProofSearchControlOptions {
  readonly analysisId: string;
  readonly startedAt: number;
  readonly hardDeadline: number;
  readonly now?: () => number;
  readonly shouldCancel?: () => boolean;
  readonly cooperativeQuantumMilliseconds?: number;
  readonly yieldControl?: () => Promise<void>;
}

export interface ProofSearchControlSnapshot {
  readonly analysisId: string;
  readonly startedAt: number;
  readonly hardDeadline: number;
  readonly deadlineReachedAt: number | null;
  readonly stopReason: ProofSearchControlStopReason | null;
  readonly lastOperation: string;
  readonly maxObservedCooperativeSliceMilliseconds: number;
}

const defaultNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const defaultYieldControl = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * One request-scoped resource controller shared by every expensive proof-search
 * layer. It owns the absolute hard deadline and the cooperative event-loop
 * quantum. Domain readers only depend on this small interface, never on React or
 * the DOM.
 */
export class ProofSearchControl {
  readonly analysisId: string;
  readonly startedAt: number;
  readonly hardDeadline: number;

  private readonly nowSource: () => number;
  private readonly shouldCancelSource: () => boolean;
  private readonly quantumMilliseconds: number;
  private readonly yieldControl: () => Promise<void>;
  private lastYieldAt: number;
  private deadlineReachedAtValue: number | null = null;
  private stopReasonValue: ProofSearchControlStopReason | null = null;
  private lastOperationValue = 'initializing';
  private maxSliceMilliseconds = 0;

  constructor(options: ProofSearchControlOptions) {
    if (!Number.isFinite(options.startedAt)) throw new Error('startedAt must be finite');
    if (!Number.isFinite(options.hardDeadline) || options.hardDeadline < options.startedAt) {
      throw new Error('hardDeadline must be finite and >= startedAt');
    }
    const quantum = options.cooperativeQuantumMilliseconds
      ?? DEFAULT_COOPERATIVE_QUANTUM_MILLISECONDS;
    if (!Number.isFinite(quantum) || quantum <= 0) {
      throw new Error('cooperativeQuantumMilliseconds must be positive');
    }

    this.analysisId = options.analysisId;
    this.startedAt = options.startedAt;
    this.hardDeadline = options.hardDeadline;
    this.nowSource = options.now ?? defaultNow;
    this.shouldCancelSource = options.shouldCancel ?? (() => false);
    this.quantumMilliseconds = quantum;
    this.yieldControl = options.yieldControl ?? defaultYieldControl;
    this.lastYieldAt = options.startedAt;
  }

  now(): number {
    return this.nowSource();
  }

  setOperation(operation: string): void {
    this.lastOperationValue = operation;
  }

  private observeSlice(at: number): void {
    this.maxSliceMilliseconds = Math.max(this.maxSliceMilliseconds, Math.max(0, at - this.lastYieldAt));
  }

  shouldStop = (): boolean => {
    const at = this.nowSource();
    this.observeSlice(at);
    if (this.shouldCancelSource()) {
      this.stopReasonValue ??= 'cancelled';
      return true;
    }
    if (at >= this.hardDeadline) {
      this.deadlineReachedAtValue ??= at;
      this.stopReasonValue ??= 'hard-time-budget';
      return true;
    }
    return false;
  };

  /** Cheap synchronous checkpoint for bounded loops/preprocessing. */
  syncCheckpoint(operation?: string): boolean {
    if (operation) this.lastOperationValue = operation;
    return this.shouldStop();
  }

  /**
   * Cooperative checkpoint. When one slice reaches the configured quantum the
   * caller yields to the host event loop before continuing. Returning true means
   * the caller must fail closed and stop further computation.
   */
  async checkpoint(operation?: string, forceYield = false): Promise<boolean> {
    if (operation) this.lastOperationValue = operation;
    const before = this.nowSource();
    this.observeSlice(before);
    if (this.shouldStop()) return true;

    if (forceYield || before - this.lastYieldAt >= this.quantumMilliseconds) {
      await this.yieldControl();
      const after = this.nowSource();
      this.observeSlice(after);
      this.lastYieldAt = after;
      return this.shouldStop();
    }
    return false;
  }

  snapshot(): ProofSearchControlSnapshot {
    this.observeSlice(this.nowSource());
    return Object.freeze({
      analysisId: this.analysisId,
      startedAt: this.startedAt,
      hardDeadline: this.hardDeadline,
      deadlineReachedAt: this.deadlineReachedAtValue,
      stopReason: this.stopReasonValue,
      lastOperation: this.lastOperationValue,
      maxObservedCooperativeSliceMilliseconds: this.maxSliceMilliseconds,
    });
  }
}
