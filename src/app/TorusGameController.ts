import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import { DeferredEndgameClassifier } from '../core/endgame/DeferredEndgameClassifier';
import {
  ManualEndgameClassifier,
  type ManualGroupDecision,
} from '../core/endgame/ManualEndgameClassifier';
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
 * Thin application adapter used by the React screen.
 * Commands enter through GameSession; presentation exits through PresentationModel.
 * Manual review decisions are session-owned/autosaved. Finalization reads only
 * that authoritative review state before ManualEndgameClassifier validates it.
 * The deferred classifier seam is shared with Cube and can be replaced/composed
 * by the assisted classifier introduced in 0.3 without changing this UI boundary.
 */
export class TorusGameController {
  readonly size: TorusSize;

  private readonly topology: TorusTopology;
  private readonly endgameClassifier = new DeferredEndgameClassifier();
  private readonly session: GameSession;
  private readonly presentation = new PresentationModel();
  private pendingEndgameCompletion: Promise<void> | null = null;

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
      endgameClassifier: this.endgameClassifier,
      scoringStrategy: scoringFor(ruleSet, this.topology),
      boardSize: this.size,
      komi,
      persistence: options.persistence,
    } as const;

    this.session = snapshot
      ? GameSession.fromSnapshot(engine, config, snapshot)
      : new GameSession(engine, config);

    if (this.session.state().phase === 'endgame') {
      this.pendingEndgameCompletion = this.session.resumeEndgame();
    }
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
    const groups = this.endgameClassifier.pendingGroups();
    if (!groups) return Object.freeze([]);

    const viewModel = this.viewModel();
    const occupancyByPoint = new Map(
      viewModel.points.map((point) => [point.logicalPointId, point.occupancy]),
    );

    return Object.freeze(
      groups.map((points) => {
        const occupancy = occupancyByPoint.get(points[0]!);
        if (occupancy !== 'black' && occupancy !== 'white') {
          throw new Error(`Endgame group does not begin with a stone: ${points[0]}`);
        }

        return Object.freeze({
          id: endgameGroupId(points),
          points: Object.freeze([...points]),
          color: occupancy,
          edges: buildEndgameGroupEdges(points, this.topology),
        });
      }),
    );
  }

  endgameDecisions(): TorusEndgameDecisions {
    const review = this.session.endgameReview();
    if (!review) return Object.freeze({});

    return Object.freeze(
      Object.fromEntries(
        review.groups.flatMap((group) =>
          group.status ? [[endgameGroupId(group.points), group.status] as const] : [],
        ),
      ),
    );
  }

  async setEndgameDecision(groupId: string, status: GroupStatus): Promise<void> {
    const group = this.endgameGroups().find((candidate) => candidate.id === groupId);
    if (!group) throw new Error(`Unknown manual endgame group: ${groupId}`);
    await this.session.setEndgameReviewDecision(group.points, status);
  }

  moveAvailability(point: PointId): TorusMoveAvailability {
    if (this.pendingEndgameCompletion) {
      return Object.freeze({ allowed: false, reason: 'not-playing' });
    }

    const result = this.session.queryPlaceStone(point);
    return Object.freeze({
      allowed: result.allowed,
      reason: result.reason,
    });
  }

  async placeStone(point: PointId): Promise<TorusGameActionResult> {
    if (this.pendingEndgameCompletion) return this.present(false, 'not-playing');

    const result = await this.session.execute({ type: 'place-stone', point });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async pass(): Promise<TorusGameActionResult> {
    if (this.pendingEndgameCompletion) return this.present(false, 'not-playing');

    const completion = this.session.execute({ type: 'pass' });

    // GameSession pushes the second Pass and invokes the classifier synchronously
    // before awaiting persistence/classification, so the intermediate endgame state
    // is immediately available without exposing GameEngine or GameState to the UI.
    if (this.session.state().phase === 'endgame') {
      this.pendingEndgameCompletion = completion.then((result) => {
        if (!result.ok) {
          throw new Error(`Endgame Pass was rejected: ${result.reason}`);
        }
      });
      return this.present(true, null);
    }

    const result = await completion;
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async finishEndgame(): Promise<TorusGameActionResult> {
    const completion = this.pendingEndgameCompletion;
    const groups = this.endgameClassifier.pendingGroups();
    const review = this.session.endgameReview();
    if (!completion || !groups || !review || this.session.state().phase !== 'endgame') {
      throw new Error('No manual endgame classification is pending');
    }

    const decisionsByGroup = new Map(
      review.groups.map((group) => [endgameGroupId(group.points), group.status] as const),
    );
    const manualDecisions: ManualGroupDecision[] = groups.map((points) => {
      const id = endgameGroupId(points);
      const status = decisionsByGroup.get(id);
      if (!status) {
        throw new Error(`Missing manual endgame decision for group: ${id}`);
      }

      return Object.freeze({
        points: Object.freeze([...points]),
        status,
      });
    });

    const classification = await new ManualEndgameClassifier(
      this.session.state(),
      this.topology,
      manualDecisions,
    ).classify(groups);

    this.endgameClassifier.resolve(classification);

    try {
      await completion;
      return this.present(true, null);
    } finally {
      this.pendingEndgameCompletion = null;
    }
  }

  async undo(): Promise<TorusGameActionResult> {
    const pendingCompletion = this.pendingEndgameCompletion;
    if (pendingCompletion) {
      if (this.session.state().phase !== 'endgame') {
        return this.present(false, 'not-playing');
      }

      this.endgameClassifier.cancel();
      this.pendingEndgameCompletion = null;
      void pendingCompletion.catch(() => undefined);
    }

    const result = await this.session.executeSessionCommand({ type: 'undo' });
    return this.present(result.ok, result.ok ? null : result.reason);
  }

  async redo(): Promise<TorusGameActionResult> {
    if (this.pendingEndgameCompletion) return this.present(false, 'not-playing');

    const result = await this.session.executeSessionCommand({ type: 'redo' });
    if (!result.ok) return this.present(false, result.reason);

    if (result.state.phase === 'endgame') {
      this.pendingEndgameCompletion = this.session.resumeEndgame();
    }

    return this.present(true, null);
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
