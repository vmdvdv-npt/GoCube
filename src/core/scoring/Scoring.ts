import type { GameState, RuleSet } from '../game/types';

export interface ScoreResult {
  black: number;
  white: number;
  winner: 'black' | 'white' | 'draw';
  margin: number;
}

export interface ScoringStrategy {
  readonly ruleSet: RuleSet;
  score(state: GameState): ScoreResult;
}
