import type { EndgameResolvedConfidenceLabel } from './EndgameConfidenceClassifier';

export const ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM = 'engine2-confidence-auto-select-v1';

export type EndgameConfidenceBand = 'high' | 'medium' | 'low';

export interface EndgameConfidenceAutoSelectionPolicy {
  readonly algorithm: typeof ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM;
  readonly highScoreThreshold: number;
  readonly mediumScoreThreshold: number;
  readonly highDominanceMargin: number;
  readonly tieBreakOrder: readonly EndgameResolvedConfidenceLabel[];
}

export const DEFAULT_ENDGAME_CONFIDENCE_AUTO_SELECTION_POLICY: EndgameConfidenceAutoSelectionPolicy = Object.freeze({
  algorithm: ENDGAME_CONFIDENCE_AUTO_SELECTOR_ALGORITHM,
  highScoreThreshold: 0.9,
  mediumScoreThreshold: 0.65,
  highDominanceMargin: 0.05,
  tieBreakOrder: Object.freeze(['alive', 'dead', 'seki'] as const),
});
