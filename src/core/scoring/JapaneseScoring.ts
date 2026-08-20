import type { EndgameClassification } from '../endgame/EndgameClassifier';
import type { CaptureCounts, GameState } from '../game/types';
import type { Topology } from '../topology/Topology';
import {
  analyzeScoringPosition,
  finishScore,
  type FinalScore,
  type ScoringStrategy,
} from './Scoring';

export class JapaneseScoring implements ScoringStrategy {
  readonly ruleSet = 'japanese' as const;

  constructor(private readonly topology: Topology) {}

  score(
    state: GameState,
    classification: EndgameClassification,
    komi: number,
  ): FinalScore {
    const position = analyzeScoringPosition(state, classification, this.topology);
    const prisoners: CaptureCounts = {
      black: position.captures.black + position.deadStones.white,
      white: position.captures.white + position.deadStones.black,
    };
    const black = position.territory.black + prisoners.black;
    const white = position.territory.white + prisoners.white + komi;

    return finishScore(this.ruleSet, black, white, komi, position, prisoners);
  }
}
