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
 * Thin application adapter for the full Cube 2D game flow.
 * Game rules, history, session-owned endgame review, validation and scoring remain
 * in the shared GameSession/GameEngine/ManualEndgameClassifier/ScoringStrategy stack.
 * Finalization reads only the session review, and the deferred classifier seam is
 * shared with Torus so 0.3 can add assisted classification behind one boundary.
 */
export class Cube2DGameController {
  readonly size: CubeSize;
  readonly topology: CubeTopology;

  private readonly endgameClassifier = new DeferredEndgameClassifier();
  private readonly session: GameSession;
  private readonly presentation = new PresentationModel();
  private pendingEndgameCompletion: Promise<void> | null = null;

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

  endgameGroups(): readonly Cube2DEndgameGroup[] {
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

  endgameDecisions(): Cube2DEndgameDecisions {
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

  moveAvailability(point: PointId): Cube2DMoveAvailability {
    if (this.pendingEndgameCompletion) {
      return Object.freeze({ allowed: false, reason: 'not-playing' });
    }

    const result = this.session.queryPlaceStone(point);
    return Object.freeze({
      allowed: result.allowed,
      reason: result.reason,
    });
  }

  async placeStone(point: PointId): Promise<Cube2DGameActionResult> {
    if (this.pendingEndgameCompletion) return this.present(false, 'not-playing');

    const result = await this.session.execute({ type: 'place-stone', point });
    return this.present(
      result.ok,
      result.ok ? null : result.reason,
      result.ok && result.action === 'place-stone' ? result.captured : EMPTY_CAPTURED,
    );
  }

  async pass(): Promise<Cube2DGameActionResult> {
    if (this.pendingEndgameCompletion) return this.present(false, 'not-playing');

    const completion = this.session.execute({ type: 'pass' });

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

  async finishEndgame(
    decisions?: Cube2DEndgameDecisions,
  ): Promise<Cube2DGameActionResult> {
    const completion = this.pendingEndgameCompletion;
    const groups = this.endgameClassifier.pendingGroups();
    if (!completion || !groups || this.session.state().phase !== 'endgame') {
      throw new Error('No manual endgame classification is pending');
    }

    // Compatibility for existing 0.2 callers: a batch supplied at finish is
    // committed through GameSession/autosave before classification. Scoring never
    // consumes the caller-owned object directly.
    if (decisions) {
      for (const [groupId, status] of Object.entries(decisions)) {
        if (status) await this.setEndgameDecision(groupId, status);
      }
    }

    const review = this.session.endgameReview();
    if (!review) throw new Error('No manual endgame review state is available');

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

  async undo(): Promise<Cube2DGameActionResult> {
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

  async redo(): Promise<Cube2DGameActionResult> {
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
