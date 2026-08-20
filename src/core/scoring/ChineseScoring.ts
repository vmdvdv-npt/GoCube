import type { EndgameClassification } from '../endgame/EndgameClassifier';
import type { GameState } from '../game/types';
import type { Topology } from '../topology/Topology';
import {
  analyzeScoringPosition,
  finishScore,
  type FinalScore,
  type ScoringStrategy,
} from './Scoring';

export class ChineseScoring implements ScoringStrategy {
  readonly ruleSet = 'chinese' as const;

  constructor(private readonly topology: Topology) {}

  score(
    state: GameState,
    classification: EndgameClassification,
    komi: number,
  ): FinalScore {
    const position = analyzeScoringPosition(state, classification, this.topology);
    const black = position.stonesOnBoard.black + position.territory.black;
    const white = position.stonesOnBoard.white + position.territory.white + komi;

    return finishScore(this.ruleSet, black, white, komi, position, null);
  }
}
