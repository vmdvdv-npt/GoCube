import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import { ConfidenceAutoEndgameClassifier } from '../core/endgame/ConfidenceAutoEndgameClassifier';
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
import {
  CubeTopology,
  isValidCubeSize,
  type CubeSize,
} from '../core/topology/CubeTopology';
import type { PointId } from '../core/topology/Topology';
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

export interface Cube2DGameControllerOptions {
  readonly size?: CubeSize;
  readonly ruleSet?: RuleSet;
  readonly komi?: number;
  readonly persistence?: GameSessionPersistenceConfig;
  readonly snapshot?: GameSessionSnapshot;
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

export type Cube2DEndgameGroup = EndgameGroupPresentation;

export type Cube2DEndgameDecisions = Readonly<
  Partial<Record<string, GroupStatus>>
>;

const EMPTY_CAPTURED: readonly PointId[] = Object.freeze([]);

const scoringFor = (ruleSet: RuleSet, topology: CubeTopology): ScoringStrategy =>
  ruleSet === 'chinese'
    ? new ChineseScoring(topology)
    : new JapaneseScoring(topology);

/**
 * Thin presentation-friendly adapter for Cube 2D.
 * GameSession owns proposal, partial review, final classification and scoring;
 * the controller activates E2-12d confidence auto-selection while keeping every
 * proposed status editable by the user until the review is explicitly finished.
 */
export class Cube2DGameController {
  readonly size: CubeSize;
  readonly topology: CubeTopology;

  private readonly session: GameSession;
  private readonly presentation = new PresentationModel();

  constructor(options: Cube2DGameControllerOptions = {}) {
    const snapshot = options.snapshot;
    const requestedSize = snapshot?.boardSize ?? options.size ?? 4;
    if (!isValidCubeSize(requestedSize)) {
      throw new Error(`Unsupported cube size: ${String(requestedSize)}`);
    }

    const ruleSet = snapshot?.ruleSet ?? options.ruleSet ?? 'chinese';
    if (ruleSet !== 'chinese' && ruleSet !== 'japanese') {
      throw new Error(`Unsupported rule set: ${String(ruleSet)}`);
    }

    const komi = snapshot?.komi ?? options.komi ?? 7.5;
    if (!Number.isFinite(komi)) throw new Error('Komi must be a finite number');

    this.size = requestedSize;
    this.topology = new CubeTopology(this.size);
    const engine = new GameEngine(this.topology);
    const config = {
      endgameClassifier: new ConfidenceAutoEndgameClassifier(),
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

  endgameGroups(): readonly Cube2DEndgameGroup[] {
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

  endgameDecisions(): Cube2DEndgameDecisions {
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

  moveAvailability(point: PointId): Cube2DMoveAvailability {
    const result = this.session.queryPlaceStone(point);
    return Object.freeze({
      allowed: result.allowed,
      reason: result.reason,
    });
  }

  async placeStone(point: PointId): Promise<Cube2DGameActionResult> {
    const result = await this.session.execute({ type: 'place-stone', point });
    return this.present(
      result.ok,
      result.ok ? null : result.reason,
      result.ok && result.action === 'place-stone' ? result.captured : EMPTY_CAPTURED,
    );
  }

  async pass(): Promise<Cube2DGameActionResult> {
    const result = await this.session.execute({ type: 'pass' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async finishEndgame(
    decisions?: Cube2DEndgameDecisions,
  ): Promise<Cube2DGameActionResult> {
    if (decisions && this.viewModel().phase === 'endgame') {
      for (const [groupId, status] of Object.entries(decisions)) {
        if (status && this.viewModel().phase === 'endgame') {
          const current = this.endgameDecisions()[groupId];
          if (current !== status) await this.setEndgameDecision(groupId, status);
        }
      }
    }

    if (this.viewModel().phase !== 'finished') {
      await this.session.finishEndgameReview();
    }
    return this.present(true, null);
  }

  async undo(): Promise<Cube2DGameActionResult> {
    const result = await this.session.executeSessionCommand({ type: 'undo' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async redo(): Promise<Cube2DGameActionResult> {
    const result = await this.session.executeSessionCommand({ type: 'redo' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  private present(
    accepted: boolean,
    reason: GameSessionRejectionReason | null,
    captured: readonly PointId[] = EMPTY_CAPTURED,
  ): Cube2DGameActionResult {
    return Object.freeze({
      accepted,
      reason,
      captured: Object.freeze([...captured]),
      viewModel: this.viewModel(),
    });
  }
}
