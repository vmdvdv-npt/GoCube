import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import { AssistedEndgameClassifier } from '../core/endgame/AssistedEndgameClassifier';
import { effectiveEndgameStatus } from '../core/endgame/EndgameReviewState';
import {
  FinalProofSearchRunController,
  type FinalProofSearchProgressSource,
} from '../core/endgame/FinalProofSearchRunController';
import { GameEngine } from '../core/game/GameEngine';
import {
  GameSession,
  type GameSessionPersistenceConfig,
  type GameSessionRejectionReason,
} from '../core/game/GameSession';
import type { RuleSet } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import { ChineseScoring } from '../core/scoring/ChineseScoring';
import { JapaneseScoring } from '../core/scoring/JapaneseScoring';
import type { ScoringStrategy } from '../core/scoring/Scoring';
import type { PointId, Topology } from '../core/topology/Topology';
import {
  buildEndgameGroupEdges,
  endgameGroupId,
  type EndgameGroupPresentation,
} from '../presentation/EndgameGroupPresentation';
import {
  provisionalEndgameTerritory,
  type EndgameTerritoryOwner,
} from '../presentation/EndgameTerritoryPresentation';
import {
  createGameResultModel,
  type GameResultViewModel,
} from '../presentation/GameResultModel';
import { PresentationModel, type GameViewModel } from '../presentation/PresentationModel';

export interface GameSessionControllerFacadeOptions {
  readonly topology: Topology;
  readonly boardSize: number;
  readonly ruleSet: RuleSet;
  readonly komi: number;
  readonly persistence?: GameSessionPersistenceConfig;
  readonly snapshot?: GameSessionSnapshot;
}

export interface SharedGameActionResult {
  readonly accepted: boolean;
  readonly reason: GameSessionRejectionReason | null;
  readonly captured: readonly PointId[];
  readonly viewModel: GameViewModel;
}

export interface SharedMoveAvailability {
  readonly allowed: boolean;
  readonly reason: GameSessionRejectionReason | null;
}

export type SharedEndgameGroup = EndgameGroupPresentation;
export type SharedEndgameDecisions = Readonly<Partial<Record<string, GroupStatus>>>;

const EMPTY_CAPTURED: readonly PointId[] = Object.freeze([]);

const scoringFor = (ruleSet: RuleSet, topology: Topology): ScoringStrategy =>
  ruleSet === 'chinese' ? new ChineseScoring(topology) : new JapaneseScoring(topology);

/**
 * Owns the gameplay/session lifecycle shared by all local topology controllers.
 * Topology-specific controllers remain thin adapters and do not independently
 * construct or coordinate GameEngine, GameSession, scoring, assisted endgame,
 * presentation, history commands, or Final Proof Search lifetime.
 */
export class GameSessionControllerFacade {
  private readonly session: GameSession;
  private readonly presentation = new PresentationModel();
  private readonly finalAnalysis = new FinalProofSearchRunController();

  constructor(private readonly options: GameSessionControllerFacadeOptions) {
    if (!Number.isInteger(options.boardSize) || options.boardSize <= 0) {
      throw new Error(`Board size must be a positive integer, got ${String(options.boardSize)}`);
    }
    if (options.ruleSet !== 'chinese' && options.ruleSet !== 'japanese') {
      throw new Error(`Unsupported rule set: ${String(options.ruleSet)}`);
    }
    if (!Number.isFinite(options.komi)) throw new Error('Komi must be a finite number');

    const engine = new GameEngine(options.topology);
    const config = {
      endgameClassifier: new AssistedEndgameClassifier({ runController: this.finalAnalysis }),
      scoringStrategy: scoringFor(options.ruleSet, options.topology),
      boardSize: options.boardSize,
      komi: options.komi,
      persistence: options.persistence,
    } as const;
    this.session = options.snapshot
      ? GameSession.fromSnapshot(engine, config, options.snapshot)
      : new GameSession(engine, config);
  }

  finalAnalysisProgressSource(): FinalProofSearchProgressSource {
    return this.finalAnalysis;
  }

  cancelFinalAnalysis(): void {
    this.finalAnalysis.cancelActive();
  }

  dispose(): void {
    this.cancelFinalAnalysis();
  }

  viewModel(): GameViewModel {
    return this.presentation.fromSession(this.session);
  }

  snapshot(): GameSessionSnapshot {
    return this.session.snapshot();
  }

  resultModel(): GameResultViewModel | null {
    return createGameResultModel(this.session.snapshot(), this.options.boardSize);
  }

  canUndo(): boolean {
    return this.session.canUndo();
  }

  canRedo(): boolean {
    return this.session.canRedo();
  }

  endgameGroups(): readonly SharedEndgameGroup[] {
    const review = this.session.endgameReview();
    if (!review) return Object.freeze([]);

    const viewModel = this.viewModel();
    const occupancyByPoint = new Map(
      viewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
    );

    return Object.freeze(
      review.groups.map((group) => {
        const firstPoint = group.points[0];
        if (!firstPoint) throw new Error('Endgame group must contain at least one stone');
        const occupancy = occupancyByPoint.get(firstPoint);
        if (occupancy !== 'black' && occupancy !== 'white') {
          throw new Error(`Endgame group does not begin with a stone: ${firstPoint}`);
        }

        return Object.freeze({
          id: endgameGroupId(group.points),
          points: Object.freeze([...group.points]),
          color: occupancy,
          edges: buildEndgameGroupEdges(group.points, this.options.topology),
        });
      }),
    );
  }

  endgameDecisions(): SharedEndgameDecisions {
    const review = this.session.endgameReview();
    if (!review) return Object.freeze({});

    return Object.freeze(
      Object.fromEntries(
        review.groups.flatMap((group) => {
          const status = effectiveEndgameStatus(group);
          return status === 'unresolved'
            ? []
            : [[endgameGroupId(group.points), status] as const];
        }),
      ),
    );
  }

  endgameTerritory(): ReadonlyMap<PointId, EndgameTerritoryOwner> {
    const viewModel = this.viewModel();
    if (viewModel.phase !== 'endgame') return new Map();

    return provisionalEndgameTerritory({
      viewModel,
      topology: this.options.topology,
      groups: this.endgameGroups(),
      decisions: this.endgameDecisions(),
    });
  }

  endgameManualGroupIds(): readonly string[] {
    const review = this.session.endgameReview();
    if (!review) return Object.freeze([]);

    return Object.freeze(
      review.groups
        .filter((group) => group.proposal.status === 'unresolved')
        .map((group) => endgameGroupId(group.points)),
    );
  }

  nextUnresolvedEndgameGroupId(): string | null {
    const review = this.session.endgameReview();
    if (!review) return null;

    const group = review.groups.find(
      (candidate) => effectiveEndgameStatus(candidate) === 'unresolved',
    );
    return group ? endgameGroupId(group.points) : null;
  }

  async setEndgameDecision(groupId: string, status: GroupStatus): Promise<void> {
    const review = this.session.endgameReview();
    const reviewGroup = review?.groups.find(
      (candidate) => endgameGroupId(candidate.points) === groupId,
    );
    if (!reviewGroup) throw new Error(`Unknown endgame group: ${groupId}`);

    await this.session.setEndgameReviewDecision(reviewGroup.points, status);
  }

  moveAvailability(point: PointId): SharedMoveAvailability {
    const result = this.session.queryPlaceStone(point);
    return Object.freeze({ allowed: result.allowed, reason: result.reason });
  }

  async placeStone(point: PointId): Promise<SharedGameActionResult> {
    const result = await this.session.execute({ type: 'place-stone', point });
    return this.present(
      result.ok,
      result.ok ? null : result.reason,
      result.ok && result.action === 'place-stone' ? result.captured : EMPTY_CAPTURED,
    );
  }

  async pass(): Promise<SharedGameActionResult> {
    const result = await this.session.execute({ type: 'pass' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async finishEndgame(decisions?: SharedEndgameDecisions): Promise<SharedGameActionResult> {
    if (decisions && this.viewModel().phase === 'endgame') {
      for (const [groupId, status] of Object.entries(decisions)) {
        if (
          status &&
          this.viewModel().phase === 'endgame' &&
          this.endgameDecisions()[groupId] !== status
        ) {
          await this.setEndgameDecision(groupId, status);
        }
      }
    }

    if (this.viewModel().phase !== 'finished') await this.session.finishEndgameReview();
    return this.present(true, null);
  }

  async undo(): Promise<SharedGameActionResult> {
    const result = await this.session.executeSessionCommand({ type: 'undo' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async redo(): Promise<SharedGameActionResult> {
    const result = await this.session.executeSessionCommand({ type: 'redo' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  private present(
    accepted: boolean,
    reason: GameSessionRejectionReason | null,
    captured: readonly PointId[] = EMPTY_CAPTURED,
  ): SharedGameActionResult {
    return Object.freeze({
      accepted,
      reason,
      captured: Object.freeze([...captured]),
      viewModel: this.viewModel(),
    });
  }
}
