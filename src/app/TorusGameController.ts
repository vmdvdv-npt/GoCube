import type {
  EndgameClassification,
  EndgameClassifier,
} from '../core/endgame/EndgameClassifier';
import { GameEngine } from '../core/game/GameEngine';
import {
  GameSession,
  type GameSessionRejectionReason,
} from '../core/game/GameSession';
import type { RuleSet } from '../core/game/types';
import { SimpleKoPolicy } from '../core/rules/RepetitionPolicy';
import { ChineseScoring } from '../core/scoring/ChineseScoring';
import { JapaneseScoring } from '../core/scoring/JapaneseScoring';
import type { ScoringStrategy } from '../core/scoring/Scoring';
import type { PointId } from '../core/topology/Topology';
import { TorusTopology, type TorusSize } from '../core/topology/TorusTopology';
import {
  PresentationModel,
  type GameViewModel,
} from '../presentation/PresentationModel';

export interface TorusGameControllerOptions {
  readonly size?: TorusSize;
  readonly ruleSet?: RuleSet;
  readonly komi?: number;
}

export interface TorusGameActionResult {
  readonly accepted: boolean;
  readonly reason: GameSessionRejectionReason | null;
  readonly viewModel: GameViewModel;
}

/**
 * 0.1.14 deliberately exposes no Pass command. A second pass requires the real
 * manual endgame-classification UI, which is a later application milestone.
 */
class EndgameUiRequiredClassifier implements EndgameClassifier {
  async classify(
    _groups: readonly (readonly PointId[])[],
  ): Promise<EndgameClassification> {
    throw new Error('Manual endgame classification UI is required before Pass is exposed');
  }
}

const scoringFor = (ruleSet: RuleSet, topology: TorusTopology): ScoringStrategy =>
  ruleSet === 'chinese'
    ? new ChineseScoring(topology)
    : new JapaneseScoring(topology);

/**
 * Thin application adapter used by the React screen.
 * Commands still enter through GameSession; presentation still exits through
 * PresentationModel. The UI never receives GameEngine or mutable GameState.
 */
export class TorusGameController {
  readonly size: TorusSize;

  private readonly session: GameSession;
  private readonly presentation = new PresentationModel();

  constructor(options: TorusGameControllerOptions = {}) {
    this.size = options.size ?? 9;
    const ruleSet = options.ruleSet ?? 'chinese';
    const komi = options.komi ?? 7.5;

    if (!Number.isFinite(komi)) throw new Error('Komi must be a finite number');

    const topology = new TorusTopology(this.size);
    this.session = new GameSession(
      new GameEngine(topology),
      new SimpleKoPolicy(),
      {
        endgameClassifier: new EndgameUiRequiredClassifier(),
        scoringStrategy: scoringFor(ruleSet, topology),
        komi,
      },
    );
  }

  viewModel(): GameViewModel {
    return this.presentation.fromSession(this.session);
  }

  async placeStone(point: PointId): Promise<TorusGameActionResult> {
    const result = await this.session.execute({ type: 'place-stone', point });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async undo(): Promise<TorusGameActionResult> {
    const result = await this.session.execute({ type: 'undo' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  private present(
    accepted: boolean,
    reason: GameSessionRejectionReason | null,
  ): TorusGameActionResult {
    return Object.freeze({
      accepted,
      reason,
      viewModel: this.viewModel(),
    });
  }
}
