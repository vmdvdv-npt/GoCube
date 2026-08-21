import type { EndgameClassification, EndgameClassifier } from '../core/endgame/EndgameClassifier';
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
import {
  CUBE_SIZES,
  CubeTopology,
  type CubeSize,
} from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
import {
  PresentationModel,
  type GameViewModel,
} from '../presentation/PresentationModel';

export interface Cube2DGameControllerOptions {
  readonly size?: CubeSize;
  readonly ruleSet?: RuleSet;
  readonly komi?: number;
}

export interface Cube2DGameActionResult {
  readonly accepted: boolean;
  readonly reason: GameSessionRejectionReason | null;
  readonly captured: readonly PointId[];
  readonly viewModel: GameViewModel;
}

export interface Cube2DMoveAvailability {
  readonly allowed: boolean;
  readonly reason: GameSessionRejectionReason | null;
}

const isCubeSize = (value: number): value is CubeSize =>
  CUBE_SIZES.some((size) => size === value);

class PreviewEndgameClassifier implements EndgameClassifier {
  async classify(groups: readonly (readonly PointId[])[]): Promise<EndgameClassification> {
    return Object.freeze(
      groups.map((points) =>
        Object.freeze({
          points: Object.freeze([...points]),
          status: 'alive' as const,
          source: 'automatic' as const,
        }),
      ),
    );
  }
}

const scoringFor = (ruleSet: RuleSet, topology: CubeTopology): ScoringStrategy =>
  ruleSet === 'chinese'
    ? new ChineseScoring(topology)
    : new JapaneseScoring(topology);

/**
 * Thin application adapter for Cube 2D gameplay.
 * It deliberately reuses GameSession + GameEngine + PresentationModel and only swaps in CubeTopology.
 */
export class Cube2DGameController {
  readonly size: CubeSize;
  readonly topology: CubeTopology;

  private readonly session: GameSession;
  private readonly presentation = new PresentationModel();

  constructor(options: Cube2DGameControllerOptions = {}) {
    const requestedSize = options.size ?? 4;
    if (!isCubeSize(requestedSize)) {
      throw new Error(`Unsupported cube size: ${String(requestedSize)}`);
    }

    const ruleSet = options.ruleSet ?? 'chinese';
    if (ruleSet !== 'chinese' && ruleSet !== 'japanese') {
      throw new Error(`Unsupported rule set: ${String(ruleSet)}`);
    }

    const komi = options.komi ?? 7.5;
    if (!Number.isFinite(komi)) throw new Error('Komi must be a finite number');

    this.size = requestedSize;
    this.topology = new CubeTopology(this.size);
    const engine = new GameEngine(this.topology);
    this.session = new GameSession(engine, new SimpleKoPolicy(), {
      endgameClassifier: new PreviewEndgameClassifier(),
      scoringStrategy: scoringFor(ruleSet, this.topology),
      boardSize: this.size,
      komi,
    });
  }

  viewModel(): GameViewModel {
    return this.presentation.fromSession(this.session);
  }

  moveAvailability(point: PointId): Cube2DMoveAvailability {
    const result = this.session.queryPlaceStone(point);
    return Object.freeze({
      allowed: result.allowed,
      reason: result.reason,
    });
  }

  async placeStone(point: PointId): Promise<Cube2DGameActionResult> {
    const result = await this.session.execute({ type: 'place-stone', point });
    return Object.freeze({
      accepted: result.ok,
      reason: result.ok ? null : result.reason,
      captured: result.ok && result.action === 'place-stone' ? result.captured : Object.freeze([]),
      viewModel: this.viewModel(),
    });
  }
}
