import type {
  FinalProofSearchProgressListener,
  GroupStatus,
} from '../core/endgame/EndgameClassifier';
import { AssistedEndgameClassifier } from '../core/endgame/AssistedEndgameClassifier';
import { effectiveEndgameStatus } from '../core/endgame/EndgameReviewState';
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
import type { PointId } from '../core/topology/Topology';
import {
  TORUS_SIZES,
  TorusTopology,
  type TorusSize,
} from '../core/topology/TorusTopology';
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
import {
  PresentationModel,
  type GameViewModel,
} from '../presentation/PresentationModel';

export interface TorusGameControllerOptions {
  readonly size?: TorusSize;
  readonly ruleSet?: RuleSet;
  readonly komi?: number;
  readonly persistence?: GameSessionPersistenceConfig;
  readonly snapshot?: GameSessionSnapshot;
}

export interface TorusGameActionResult {
  readonly accepted: boolean;
  readonly reason: GameSessionRejectionReason | null;
  readonly viewModel: GameViewModel;
}

export interface TorusMoveAvailability {
  readonly allowed: boolean;
  readonly reason: GameSessionRejectionReason | null;
}

export type TorusEndgameGroup = EndgameGroupPresentation;

export type TorusEndgameDecisions = Readonly<
  Partial<Record<string, GroupStatus>>
>;

const isTorusSize = (value: number): value is TorusSize =>
  TORUS_SIZES.some((size) => size === value);

const scoringFor = (ruleSet: RuleSet, topology: TorusTopology): ScoringStrategy =>
  ruleSet === 'chinese'
    ? new ChineseScoring(topology)
    : new JapaneseScoring(topology);

/**
 * Thin presentation-friendly adapter for Torus 2D.
 * GameSession owns proposal, partial review, final classification and scoring;
 * the controller activates assisted classification while keeping every proposed
 * status editable by the user until the review is explicitly finished.
 */
export class TorusGameController {
  readonly size: TorusSize;

  private readonly topology: TorusTopology;
  private readonly session: GameSession;
  private readonly presentation = new PresentationModel();

  constructor(options: TorusGameControllerOptions = {}) {
    const snapshot = options.snapshot;
    const requestedSize = snapshot?.boardSize ?? options.size ?? 9;
    if (!isTorusSize(requestedSize)) {
      throw new Error(`Unsupported saved torus size: ${String(requestedSize)}`);
    }

    this.size = requestedSize;
    const ruleSet = snapshot?.ruleSet ?? options.ruleSet ?? 'chinese';
    const komi = snapshot?.komi ?? options.komi ?? 7.5;

    if (ruleSet !== 'chinese' && ruleSet !== 'japanese') {
      throw new Error(`Unsupported rule set: ${String(ruleSet)}`);
    }
    if (!Number.isFinite(komi)) throw new Error('Komi must be a finite number');

    this.topology = new TorusTopology(this.size);
    const engine = new GameEngine(this.topology);
    const config = {
      endgameClassifier: new AssistedEndgameClassifier(),
      scoringStrategy: scoringFor(ruleSet, this.topology),
      boardSize: this.size,
      komi,
      persistence: options.persistence,
    } as const;

    this.session = snapshot
      ? GameSession.fromSnapshot(engine, config, snapshot)
      : new GameSession(engine, config);
  }

  viewModel(): GameViewModel {
    return this.presentation.fromSession(this.session);
  }

  snapshot(): GameSessionSnapshot {
    return this.session.snapshot();
  }

  resultModel(): GameResultViewModel | null {
    return createGameResultModel(this.session.snapshot(), this.size);
  }

  canUndo(): boolean {
    return this.session.canUndo();
  }

  canRedo(): boolean {
    return this.session.canRedo();
  }

  endgameGroups(): readonly TorusEndgameGroup[] {
    const review = this.session.endgameReview();
    if (!review) return Object.freeze([]);

    const viewModel = this.viewModel();
    const occupancyByPoint = new Map(
      viewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
    );

    return Object.freeze(
      review.groups.map((group) => {
        const occupancy = occupancyByPoint.get(group.points[0]!);
        if (occupancy !== 'black' && occupancy !== 'white') {
          throw new Error(`Endgame group does not begin with a stone: ${group.points[0]}`);
        }

        return Object.freeze({
          id: endgameGroupId(group.points),
          points: Object.freeze([...group.points]),
          color: occupancy,
          edges: buildEndgameGroupEdges(group.points, this.topology),
        });
      }),
    );
  }

  endgameDecisions(): TorusEndgameDecisions {
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
      topology: this.topology,
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

  moveAvailability(point: PointId): TorusMoveAvailability {
    const result = this.session.queryPlaceStone(point);
    return Object.freeze({
      allowed: result.allowed,
      reason: result.reason,
    });
  }

  async placeStone(point: PointId): Promise<TorusGameActionResult> {
    const result = await this.session.execute({ type: 'place-stone', point });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async pass(): Promise<TorusGameActionResult> {
    const result = await this.session.execute({ type: 'pass' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async finishEndgame(
    onProgress?: FinalProofSearchProgressListener,
  ): Promise<TorusGameActionResult> {
    if (this.viewModel().phase !== 'finished') {
      await this.session.finishEndgameReview(onProgress);
    }
    return this.present(true, null);
  }

  async undo(): Promise<TorusGameActionResult> {
    const result = await this.session.executeSessionCommand({ type: 'undo' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async redo(): Promise<TorusGameActionResult> {
    const result = await this.session.executeSessionCommand({ type: 'redo' });
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
