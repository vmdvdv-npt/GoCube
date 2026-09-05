import type { FinalProofSearchProgress } from './FinalProofSearch';

export type FinalProofSearchProgressListener = (
  progress: FinalProofSearchProgress | null,
) => void;

export interface FinalProofSearchRunHandle {
  readonly analysisId: string;
  readonly shouldStop: () => boolean;
  readonly publish: (progress: FinalProofSearchProgress) => void;
  readonly finish: () => void;
}

export interface FinalProofSearchProgressSource {
  current(): FinalProofSearchProgress | null;
  subscribe(listener: FinalProofSearchProgressListener): () => void;
}

const createAnalysisId = (): string => {
  const cryptoSource = globalThis.crypto;
  if (cryptoSource && typeof cryptoSource.randomUUID === 'function') {
    return cryptoSource.randomUUID();
  }
  return `final-proof-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

interface ActiveRun {
  readonly analysisId: string;
  cancelled: boolean;
  progress: FinalProofSearchProgress | null;
}

/**
 * Controller-owned progress/cancellation channel. There is deliberately no
 * module-level active analysis: two GameSessions/controllers can run in parallel
 * without sharing progress or cancellation state.
 */
export class FinalProofSearchRunController implements FinalProofSearchProgressSource {
  private active: ActiveRun | null = null;
  private readonly listeners = new Set<FinalProofSearchProgressListener>();

  current(): FinalProofSearchProgress | null {
    return this.active?.progress ?? null;
  }

  subscribe(listener: FinalProofSearchProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => this.listeners.delete(listener);
  }

  begin(): FinalProofSearchRunHandle {
    this.cancelActive();
    const active: ActiveRun = {
      analysisId: createAnalysisId(),
      cancelled: false,
      progress: null,
    };
    this.active = active;

    const publish = (progress: FinalProofSearchProgress): void => {
      if (this.active !== active || active.cancelled) return;
      if (progress.analysisId !== active.analysisId) {
        throw new Error('Final proof progress analysisId does not match its owning run');
      }
      active.progress = progress;
      for (const listener of this.listeners) listener(progress);
    };

    const finish = (): void => {
      if (this.active !== active) return;
      this.active = null;
      for (const listener of this.listeners) listener(null);
    };

    return Object.freeze({
      analysisId: active.analysisId,
      shouldStop: () => active.cancelled,
      publish,
      finish,
    });
  }

  cancelActive(): void {
    const active = this.active;
    if (!active) return;
    active.cancelled = true;
    this.active = null;
    for (const listener of this.listeners) listener(null);
  }
}
