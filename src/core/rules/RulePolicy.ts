import type { RuleSet } from '../game/types';

export interface RulePolicy {
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly allowSuicide: boolean;
}

export const defaultRulePolicies: Record<RuleSet, RulePolicy> = {
  chinese: { ruleSet: 'chinese', komi: 7.5, allowSuicide: false },
  japanese: { ruleSet: 'japanese', komi: 6.5, allowSuicide: false },
};
