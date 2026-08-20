import type { RuleSet } from '../game/types';

export interface RulePolicy {
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly allowSuicide: boolean;
}

// Product default currently uses komi 7.5. Keep it configurable and persisted
// so rule-specific defaults can be changed later without changing GameEngine.
export const defaultRulePolicies: Record<RuleSet, RulePolicy> = {
  chinese: { ruleSet: 'chinese', komi: 7.5, allowSuicide: false },
  japanese: { ruleSet: 'japanese', komi: 7.5, allowSuicide: false },
};
