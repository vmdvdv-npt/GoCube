import type {
  EndgameClassification,
  EndgameClassifier,
  GroupStatus,
} from '../core/endgame/EndgameClassifier';
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
import type { RuleSet, StoneColor } from '../core/game/types';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import { SimpleKoPolicy } from '../core/rules/RepetitionPolicy';
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

export interface TorusEndgameGroup {
  readonly id: string;
  readonly points: readonly PointId[];
  readonly color: StoneColor;
}

export type TorusEndgameDecisions = Readonly<
  Partial<Record<string, GroupStatus>>
>;

const groupId = (points: readonly PointId[]): string => JSON.stringify(points);

const isTorusSize = (value: number): value is TorusSize =>
  TORUS_SIZES.some((size) => size === value);

class DeferredEndgameClassifier implements EndgameClassifier {
  private groups: readonly (readonly PointId[])[] | null = null;
  private resolvePending:
    | ((classification: EndgameClassification) => void)
    | null = null;

  classify(
    groups: readonly (readonly PointId[])[],
  ): Promise<EndgameClassification> {
    if (this.resolvePending) {
      return Promise.reject(new Error('Endgame classification is already pending'));
    }

    this.groups = Object.freeze(
      groups.map((group) => Object.freeze([...group])),
    );

    return new Promise((resolve) => {
      this.resolvePending = resolve;
    });
  }

  pendingGroups(): readonly (readonly PointId[])[] | null {
    return this.groups;
  }

  resolve(classification: EndgameClassification): void {
    const resolve = this.resolvePending;
    if (!resolve || !this.groups) {
      throw new Error('No endgame classification is pending');
    }

    this.groups = null;
    this.resolvePending = null;
    resolve(classification);
  }
}

const scoringFor = (ruleSet: RuleSet, topology: TorusTopology): ScoringStrategy =>
  ruleSet === 'chinese'
    ? new ChineseScoring(topology)
    : new JapaneseScoring(topology);

/**
 * Thin application adapter used by the React screen.
 * Commands enter through GameSession; presentation exits through PresentationModel.
 * Manual endgame decisions are validated by ManualEndgameClassifier before the
 * deferred GameSession endgame flow is allowed to continue to scoring.
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
    const repetitionPolicy = new SimpleKoPolicy();
    const config = {
      endgameClassifier: this.endgameClassifier,
      scoringStrategy: scoringFor(ruleSet, this.topology),
      boardSize: this.size,
      komi,
      persistence: options.persistence,
    } as const;

    this.session = snapshot
      ? GameSession.fromSnapshot(engine, repetitionPolicy, config, snapshot)
      : new GameSession(engine, repetitionPolicy, config);

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
          id: groupId(points),
          points: Object.freeze([...points]),
          color: occupancy,
        });
      }),
    );
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

  async finishEndgame(
    decisions: TorusEndgameDecisions,
  ): Promise<TorusGameActionResult> {
    const completion = this.pendingEndgameCompletion;
    const groups = this.endgameClassifier.pendingGroups();
    if (!completion || !groups || this.session.state().phase !== 'endgame') {
      throw new Error('No manual endgame classification is pending');
    }

    const manualDecisions: ManualGroupDecision[] = groups.map((points) => {
      const status = decisions[groupId(points)];
      if (!status) {
        throw new Error(`Missing manual endgame decision for group: ${groupId(points)}`);
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
    if (this.pendingEndgameCompletion) return this.present(false, 'not-playing');

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
