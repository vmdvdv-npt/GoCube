import type {
  EndgameClassification,
  EndgameClassifier,
  EndgameProposal,
  EndgameProposalStatus,
  FinalProofSearchProgressListener,
  GroupStatus,
} from '../endgame/EndgameClassifier';
import {
  canonicalizeEndgameGroup,
  compareEndgamePointIds,
  endgameGroupId,
} from '../endgame/EndgameGroupIdentity';
import {
  applyEndgameProposal,
  cloneEndgameReviewState,
  createEndgameReviewState,
  effectiveEndgameStatus,
  resolveEndgameClassification,
  setEndgameReviewDecision as updateEndgameReviewDecision,
  type EndgameReviewState,
} from '../endgame/EndgameReviewState';
import { LinearHistory } from '../history/LinearHistory';
import type { GameRepository } from '../persistence/GameRepository';
import { OrderedGameSaveCoordinator } from '../persistence/OrderedGameSaveCoordinator';
import {
  GAME_SESSION_SNAPSHOT_VERSION,
  type EndgameReviewStateSnapshot,
  type GameSessionRedoEntrySnapshot,
  type GameSessionSnapshot,
} from '../persistence/GameSessionSnapshot';
import type { FinalScore, ScoringStrategy } from '../scoring/Scoring';
import type { PointId } from '../topology/Topology';
import {
  GameEngine,
  type MoveRejectionReason,
} from './GameEngine';
import type { GameState, StoneColor } from './types';

export type GameCommand =
  | Readonly<{ type: 'place-stone'; point: PointId }>
  | Readonly<{ type: 'pass' }>;

export type SessionCommand =
  | Readonly<{ type: 'undo' }>
  | Readonly<{ type: 'redo' }>;

export interface GameSessionPersistenceConfig {
  readonly repository: GameRepository<GameSessionSnapshot>;
  readonly gameId: string;
  readonly now?: () => string;
}

export interface GameSessionConfig {
  readonly endgameClassifier: EndgameClassifier;
  readonly scoringStrategy: ScoringStrategy;
  readonly boardSize?: number;
  readonly komi: number;
  readonly persistence?: GameSessionPersistenceConfig;
}

export type GameSessionRejectionReason =
  | MoveRejectionReason
  | 'nothing-to-undo'
  | 'nothing-to-redo';

export interface GameSessionMoveQueryResult {
  readonly allowed: boolean;
  readonly reason: MoveRejectionReason | null;
}

export interface AcceptedPlaceStoneSessionResult {
  readonly ok: true;
  readonly action: 'place-stone';
  readonly state: GameState;
  readonly captured: readonly PointId[];
}

export interface AcceptedPassSessionResult {
  readonly ok: true;
  readonly action: 'pass';
  readonly state: GameState;
  readonly passedBy: StoneColor;
}

export interface AcceptedUndoSessionResult {
  readonly ok: true;
  readonly action: 'undo';
  readonly state: GameState;
}

export interface AcceptedRedoSessionResult {
  readonly ok: true;
  readonly action: 'redo';
  readonly state: GameState;
}

export interface RejectedGameSessionResult {
  readonly ok: false;
  readonly state: GameState;
  readonly reason: GameSessionRejectionReason;
}

export type GameSessionResult =
  | AcceptedPlaceStoneSessionResult
  | AcceptedPassSessionResult
  | AcceptedUndoSessionResult
  | AcceptedRedoSessionResult
  | RejectedGameSessionResult;

type HistoryMetadata = Readonly<{
  endgameReview: EndgameReviewState | null;
  endgameClassification: EndgameClassification | null;
  finalScore: FinalScore | null;
}>;

const isGroupStatus = (value: unknown): value is GroupStatus =>
  value === 'alive' || value === 'dead' || value === 'seki';

const isProposalStatus = (value: unknown): value is EndgameProposalStatus =>
  isGroupStatus(value) || value === 'unresolved';

const cloneEndgameClassification = (
  classification: EndgameClassification | null | undefined,
): EndgameClassification | null => {
  if (!classification) return null;

  return Object.freeze(
    classification.map((group) =>
      Object.freeze({
        points: canonicalizeEndgameGroup(group.points),
        status: group.status,
        source: group.source,
      }),
    ),
  );
};

const cloneFinalScore = (score: FinalScore | null): FinalScore | null => {
  if (!score) return null;

  return Object.freeze({
    ...score,
    territory: Object.freeze({ ...score.territory }),
    territoryPoints: Object.freeze({
      black: Object.freeze([...score.territoryPoints.black]),
      white: Object.freeze([...score.territoryPoints.white]),
      neutral: Object.freeze([...score.territoryPoints.neutral]),
      seki: Object.freeze([...score.territoryPoints.seki]),
    }),
    stonesOnBoard: Object.freeze({ ...score.stonesOnBoard }),
    captures: Object.freeze({ ...score.captures }),
    prisoners: score.prisoners ? Object.freeze({ ...score.prisoners }) : null,
    deadStones: Object.freeze({ ...score.deadStones }),
  });
};

const reviewFromSnapshot = (
  snapshot: EndgameReviewStateSnapshot | null | undefined,
): EndgameReviewState | null => {
  if (!snapshot) return null;

  return Object.freeze({
    groups: Object.freeze(
      snapshot.groups.map((group) => {
        const proposalStatus = group.proposal?.status ?? 'unresolved';
        const userDecision =
          group.userDecision !== undefined
            ? group.userDecision
            : group.status ?? null;

        return Object.freeze({
          points: canonicalizeEndgameGroup(group.points),
          proposal: Object.freeze({
            status: proposalStatus,
            ...(group.proposal?.evidence
              ? { evidence: Object.freeze({ ...group.proposal.evidence }) }
              : {}),
          }),
          userDecision,
        });
      }),
    ),
  });
};

const reviewToSnapshot = (
  review: EndgameReviewState | null | undefined,
): EndgameReviewStateSnapshot | null => {
  if (!review) return null;

  return Object.freeze({
    groups: Object.freeze(
      review.groups.map((group) => {
        const effective = effectiveEndgameStatus(group);
        return Object.freeze({
          points: canonicalizeEndgameGroup(group.points),
          proposal: Object.freeze({
            status: group.proposal.status,
            ...(group.proposal.evidence
              ? { evidence: Object.freeze({ ...group.proposal.evidence }) }
              : {}),
          }),
          userDecision: group.userDecision,
          // Deprecated additive v1 compatibility projection.
          status: effective === 'unresolved' ? null : effective,
        });
      }),
    ),
  });
};

const cloneHistoryMetadata = (metadata: HistoryMetadata): HistoryMetadata =>
  Object.freeze({
    endgameReview: cloneEndgameReviewState(metadata.endgameReview),
    endgameClassification: cloneEndgameClassification(metadata.endgameClassification),
    finalScore: cloneFinalScore(metadata.finalScore),
  });

const historyMetadataFromSnapshot = (
  metadata: Pick<
    GameSessionRedoEntrySnapshot,
    'endgameReview' | 'endgameClassification' | 'finalScore'
  >,
): HistoryMetadata =>
  Object.freeze({
    endgameReview: reviewFromSnapshot(metadata.endgameReview),
    endgameClassification: cloneEndgameClassification(metadata.endgameClassification),
    finalScore: cloneFinalScore(metadata.finalScore),
  });

const assertBoardSize = (boardSize: number): void => {
  if (!Number.isInteger(boardSize) || boardSize <= 0) {
    throw new Error(`Board size must be a positive integer, got ${String(boardSize)}`);
  }
};

const assertSessionRevision = (sessionRevision: number | undefined): void => {
  if (sessionRevision === undefined) return;
  if (!Number.isSafeInteger(sessionRevision) || sessionRevision < 0) {
    throw new Error(
      `Session revision must be a non-negative safe integer, got ${String(sessionRevision)}`,
    );
  }
};

export class GameSession {
  private history: LinearHistory;
  private readonly config: GameSessionConfig;
  private currentFinalScore: FinalScore | null = null;
  private currentEndgameClassification: EndgameClassification | null = null;
  private currentEndgameReview: EndgameReviewState | null = null;
  private finalEndgameAnalysisCompleted = false;
  private readonly futureMetadata: HistoryMetadata[] = [];
  private sessionRevision = 0;
  private readonly saveCoordinator: OrderedGameSaveCoordinator<GameSessionSnapshot> | null;

  constructor(
    private readonly engine: GameEngine,
    config: GameSessionConfig,
    initialState: GameState = engine.createInitialState(),
  ) {
    if (config.boardSize !== undefined) assertBoardSize(config.boardSize);
    this.config = Object.freeze({
      endgameClassifier: config.endgameClassifier,
      scoringStrategy: config.scoringStrategy,
      boardSize: config.boardSize,
      komi: config.komi,
      persistence: config.persistence
        ? Object.freeze({
            repository: config.persistence.repository,
            gameId: config.persistence.gameId,
            now: config.persistence.now,
          })
        : undefined,
    });
    this.saveCoordinator = config.persistence
      ? new OrderedGameSaveCoordinator(config.persistence.repository)
      : null;
    this.history = new LinearHistory(initialState);
  }

  static fromSnapshot(
    engine: GameEngine,
    config: GameSessionConfig,
    snapshot: GameSessionSnapshot,
  ): GameSession {
    GameSession.assertCompatibleSnapshot(config, snapshot);

    const [initialState] = snapshot.history;
    if (!initialState) throw new Error('Saved game history must not be empty');

    const redo = snapshot.redo ?? [];
    const session = new GameSession(engine, config, initialState);
    session.history = LinearHistory.fromStates(
      snapshot.history,
      redo.map((entry) => entry.state),
    );
    session.futureMetadata.push(...redo.map(historyMetadataFromSnapshot));
    session.currentEndgameReview = reviewFromSnapshot(snapshot.endgameReview);
    session.currentFinalScore = cloneFinalScore(snapshot.finalScore);
    session.currentEndgameClassification = cloneEndgameClassification(
      snapshot.endgameClassification,
    );
    session.sessionRevision = snapshot.sessionRevision ?? 0;
    return session;
  }

  static async load(
    engine: GameEngine,
    config: GameSessionConfig,
  ): Promise<GameSession | null> {
    const persistence = config.persistence;
    if (!persistence) throw new Error('GameSession persistence is not configured');

    const saved = await persistence.repository.load(persistence.gameId);
    if (!saved) return null;
    if (saved.id !== persistence.gameId) {
      throw new Error(`Saved game id mismatch: expected ${persistence.gameId}, got ${saved.id}`);
    }

    return GameSession.fromSnapshot(engine, config, saved.state);
  }

  state(): GameState {
    return this.history.current();
  }

  finalScore(): FinalScore | null {
    return this.currentFinalScore;
  }

  endgameReview(): EndgameReviewState | null {
    return cloneEndgameReviewState(this.currentEndgameReview);
  }

  historyLength(): number {
    return this.history.length();
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  /** Read-only legality query for presentation/hover feedback. */
  queryPlaceStone(point: PointId): GameSessionMoveQueryResult {
    const currentState = this.history.current();
    const result = this.engine.placeStone(
      currentState,
      point,
      currentState.currentPlayer,
      this.history.simpleKoContext(),
    );

    return Object.freeze({
      allowed: result.ok,
      reason: result.ok ? null : result.reason,
    });
  }

  async setEndgameReviewDecision(
    points: readonly PointId[],
    status: GroupStatus,
  ): Promise<void> {
    if (this.history.current().phase !== 'endgame' || !this.currentEndgameReview) {
      throw new Error('No manual endgame review is active');
    }
    if (!isGroupStatus(status)) {
      throw new Error(`Invalid manual endgame status: ${String(status)}`);
    }

    const updated = updateEndgameReviewDecision(this.currentEndgameReview, points, status);
    if (updated === this.currentEndgameReview) return;
    this.currentEndgameReview = updated;
    await this.persist();
  }

  async finishEndgameReview(
    onProgress?: FinalProofSearchProgressListener,
  ): Promise<void> {
    const state = this.history.current();
    if (state.phase !== 'endgame' || !this.currentEndgameReview) {
      throw new Error('No endgame review is active');
    }

    const finalAnalyzer = this.config.endgameClassifier.analyzeFinal;
    if (finalAnalyzer && !this.finalEndgameAnalysisCompleted) {
      const groups = this.groupsForClassification(state);
      const currentProposal = Object.freeze(
        this.currentEndgameReview.groups.map((group) =>
          Object.freeze({
            points: group.points,
            status: group.proposal.status,
            ...(group.proposal.evidence
              ? { evidence: group.proposal.evidence }
              : {}),
          }),
        ),
      );
      const proposal = await finalAnalyzer.call(
        this.config.endgameClassifier,
        Object.freeze({
          state,
          topology: this.engine.logicalTopology(),
          groups,
          simpleKoContext: this.history.simpleKoContext(),
          proposal: currentProposal,
        }),
        onProgress,
      );

      if (this.history.current() !== state || state.phase !== 'endgame') {
        throw new Error('Endgame state changed while final proof analysis was pending');
      }
      this.assertProposalMatchesGroups(groups, proposal);
      this.currentEndgameReview = applyEndgameProposal(this.currentEndgameReview, proposal);
      this.finalEndgameAnalysisCompleted = true;
      await this.persist();
    }

    const classification = resolveEndgameClassification(this.currentEndgameReview);
    if (!classification) return;
    await this.completeEndgame(state, classification);
  }

  snapshot(): GameSessionSnapshot {
    const futureStates = this.history.futureStates();
    if (futureStates.length !== this.futureMetadata.length) {
      throw new Error('Redo state and metadata stacks are out of sync');
    }

    const redo = Object.freeze(
      futureStates.map((state, index) => {
        const metadata = this.futureMetadata[index]!;
        return Object.freeze({
          state,
          endgameReview: reviewToSnapshot(metadata.endgameReview),
          endgameClassification: cloneEndgameClassification(metadata.endgameClassification),
          finalScore: cloneFinalScore(metadata.finalScore),
        });
      }),
    );

    return Object.freeze({
      version: GAME_SESSION_SNAPSHOT_VERSION,
      boardSize: this.config.boardSize,
      sessionRevision: this.sessionRevision,
      ruleSet: this.config.scoringStrategy.ruleSet,
      komi: this.config.komi,
      history: this.history.states(),
      redo,
      endgameReview: reviewToSnapshot(this.currentEndgameReview),
      endgameClassification: cloneEndgameClassification(this.currentEndgameClassification),
      finalScore: cloneFinalScore(this.currentFinalScore),
    });
  }

  async execute(command: GameCommand): Promise<GameSessionResult> {
    switch (command.type) {
      case 'place-stone':
        return this.placeStone(command.point);
      case 'pass':
        return this.pass();
    }
  }

  async executeSessionCommand(command: SessionCommand): Promise<GameSessionResult> {
    switch (command.type) {
      case 'undo':
        return this.undo();
      case 'redo':
        return this.redo();
    }
  }

  /** Compatibility entry point for restored legacy endgame snapshots missing proposal data. */
  async resumeEndgame(): Promise<void> {
    const state = this.history.current();
    if (state.phase !== 'endgame') {
      throw new Error('Only an endgame snapshot can resume endgame review');
    }
    if (this.currentEndgameReview) return;

    await this.startEndgameReview(state);
    await this.persist();
  }

  private async placeStone(point: PointId): Promise<GameSessionResult> {
    const currentState = this.history.current();
    const result = this.engine.placeStone(
      currentState,
      point,
      currentState.currentPlayer,
      this.history.simpleKoContext(),
    );

    if (!result.ok) {
      return Object.freeze({
        ok: false,
        state: currentState,
        reason: result.reason,
      });
    }

    const state = this.history.push(result.state);
    this.futureMetadata.length = 0;
    this.currentEndgameReview = null;
    this.currentEndgameClassification = null;
    this.currentFinalScore = null;
    this.finalEndgameAnalysisCompleted = false;
    await this.persist();
    return Object.freeze({
      ok: true,
      action: 'place-stone',
      state,
      captured: result.captured,
    });
  }

  private async pass(): Promise<GameSessionResult> {
    const currentState = this.history.current();
    const result = this.engine.pass(currentState);

    if (!result.ok) {
      return Object.freeze({
        ok: false,
        state: currentState,
        reason: result.reason,
      });
    }

    const state = this.history.push(result.state);
    this.futureMetadata.length = 0;
    this.currentEndgameClassification = null;
    this.currentFinalScore = null;
    this.finalEndgameAnalysisCompleted = false;

    if (state.phase !== 'endgame') {
      this.currentEndgameReview = null;
      await this.persist();
      return Object.freeze({
        ok: true,
        action: 'pass',
        state,
        passedBy: result.passedBy,
      });
    }

    await this.startEndgameReview(state);
    await this.persist();

    return Object.freeze({
      ok: true,
      action: 'pass',
      state: this.history.current(),
      passedBy: result.passedBy,
    });
  }

  private async undo(): Promise<GameSessionResult> {
    const metadata = cloneHistoryMetadata(
      Object.freeze({
        endgameReview: this.currentEndgameReview,
        endgameClassification: this.currentEndgameClassification,
        finalScore: this.currentFinalScore,
      }),
    );
    const state = this.history.undo();

    if (!state) {
      return Object.freeze({
        ok: false,
        state: this.history.current(),
        reason: 'nothing-to-undo',
      });
    }

    this.futureMetadata.push(metadata);
    this.currentEndgameReview = null;
    this.currentFinalScore = null;
    this.currentEndgameClassification = null;
    this.finalEndgameAnalysisCompleted = false;
    await this.persist();
    return Object.freeze({
      ok: true,
      action: 'undo',
      state,
    });
  }

  private async redo(): Promise<GameSessionResult> {
    const state = this.history.redo();

    if (!state) {
      return Object.freeze({
        ok: false,
        state: this.history.current(),
        reason: 'nothing-to-redo',
      });
    }

    const metadata = this.futureMetadata.pop();
    this.currentEndgameReview = cloneEndgameReviewState(metadata?.endgameReview);
    this.currentEndgameClassification = cloneEndgameClassification(
      metadata?.endgameClassification,
    );
    this.currentFinalScore = cloneFinalScore(metadata?.finalScore ?? null);
    this.finalEndgameAnalysisCompleted = false;
    await this.persist();
    return Object.freeze({
      ok: true,
      action: 'redo',
      state,
    });
  }

  private async startEndgameReview(state: GameState): Promise<void> {
    const groups = this.groupsForClassification(state);
    const proposal = await this.config.endgameClassifier.analyze(
      Object.freeze({
        state,
        topology: this.engine.logicalTopology(),
        groups,
        simpleKoContext: this.history.simpleKoContext(),
      }),
    );

    if (this.history.current() !== state || state.phase !== 'endgame') {
      throw new Error('Endgame state changed while analysis was pending');
    }

    this.assertProposalMatchesGroups(groups, proposal);
    this.currentEndgameReview = createEndgameReviewState(proposal);
    this.finalEndgameAnalysisCompleted = false;
  }

  private async completeEndgame(
    state: GameState,
    classification: EndgameClassification,
  ): Promise<void> {
    if (this.history.current() !== state || state.phase !== 'endgame') {
      throw new Error('Endgame state changed before scoring');
    }

    const finalScore = this.config.scoringStrategy.score(
      state,
      classification,
      this.config.komi,
    );
    const completion = this.engine.completeEndgame(state);
    if (!completion.ok) {
      throw new Error(`GameEngine rejected endgame completion: ${completion.reason}`);
    }

    this.history.replaceCurrent(completion.state);
    this.currentEndgameReview = null;
    this.currentEndgameClassification = cloneEndgameClassification(classification);
    this.currentFinalScore = finalScore;
    this.finalEndgameAnalysisCompleted = true;
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (this.sessionRevision >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Session revision overflow');
    }
    this.sessionRevision += 1;

    const persistence = this.config.persistence;
    const coordinator = this.saveCoordinator;
    if (!persistence || !coordinator) return;

    const snapshot = this.snapshot();
    const savedAt = (persistence.now ?? (() => new Date().toISOString()))();
    await coordinator.save({
      id: persistence.gameId,
      savedAt,
      state: snapshot,
    });
  }

  private groupsForClassification(
    state: GameState,
  ): readonly (readonly PointId[])[] {
    const visited = new Set<PointId>();
    const groups: (readonly PointId[])[] = [];

    for (const point of Object.keys(state.board).sort(compareEndgamePointIds)) {
      if (visited.has(point) || state.board[point] === 'empty') continue;

      const group = this.engine.groupAt(state, point);
      if (!group) continue;

      const points = canonicalizeEndgameGroup(group.points);
      for (const groupPoint of points) visited.add(groupPoint);
      groups.push(points);
    }

    return Object.freeze(groups);
  }

  private assertProposalMatchesGroups(
    groups: readonly (readonly PointId[])[],
    proposal: EndgameProposal,
  ): void {
    const expected = groups.map(endgameGroupId).sort();
    const actual: string[] = [];
    const seen = new Set<string>();

    for (const group of proposal) {
      if (!Array.isArray(group.points) || group.points.length === 0) {
        throw new Error('Endgame proposal group must contain points');
      }
      if (!isProposalStatus(group.status)) {
        throw new Error(`Invalid endgame proposal status: ${String(group.status)}`);
      }
      const id = endgameGroupId(group.points);
      if (seen.has(id)) throw new Error(`Duplicate endgame proposal group: ${id}`);
      seen.add(id);
      actual.push(id);
    }

    actual.sort();
    if (
      actual.length !== expected.length ||
      actual.some((id, index) => id !== expected[index])
    ) {
      throw new Error('Endgame proposal does not match all stone groups exactly once');
    }
  }

  private static assertCompatibleSnapshot(
    config: GameSessionConfig,
    snapshot: GameSessionSnapshot,
  ): void {
    if (snapshot.version !== GAME_SESSION_SNAPSHOT_VERSION) {
      throw new Error(`Unsupported saved game version: ${String(snapshot.version)}`);
    }
    if (snapshot.boardSize !== undefined) assertBoardSize(snapshot.boardSize);
    assertSessionRevision(snapshot.sessionRevision);
    if (
      config.boardSize !== undefined &&
      snapshot.boardSize !== undefined &&
      snapshot.boardSize !== config.boardSize
    ) {
      throw new Error(
        `Saved board size mismatch: expected ${config.boardSize}, got ${snapshot.boardSize}`,
      );
    }
    if (snapshot.ruleSet !== config.scoringStrategy.ruleSet) {
      throw new Error(
        `Saved rule set mismatch: expected ${config.scoringStrategy.ruleSet}, got ${snapshot.ruleSet}`,
      );
    }
    if (snapshot.komi !== config.komi) {
      throw new Error(`Saved komi mismatch: expected ${config.komi}, got ${snapshot.komi}`);
    }
    if (snapshot.history.length === 0) {
      throw new Error('Saved game history must not be empty');
    }

    GameSession.assertStateMetadata(
      snapshot.history[snapshot.history.length - 1]!,
      snapshot.endgameReview ?? null,
      snapshot.endgameClassification ?? null,
      snapshot.finalScore,
      snapshot.ruleSet,
      snapshot.komi,
      'current saved state',
    );

    for (const entry of snapshot.redo ?? []) {
      GameSession.assertStateMetadata(
        entry.state,
        entry.endgameReview ?? null,
        entry.endgameClassification,
        entry.finalScore,
        snapshot.ruleSet,
        snapshot.komi,
        'saved Redo state',
      );
    }
  }

  private static assertStateMetadata(
    state: GameState,
    endgameReview: EndgameReviewStateSnapshot | null,
    endgameClassification: EndgameClassification | null,
    finalScore: FinalScore | null,
    ruleSet: GameSessionSnapshot['ruleSet'],
    komi: number,
    label: string,
  ): void {
    if (state.phase === 'finished' && !finalScore) {
      throw new Error(`Finished ${label} must include FinalScore`);
    }
    if (state.phase !== 'finished' && finalScore) {
      throw new Error(`Unfinished ${label} must not include FinalScore`);
    }
    if (state.phase !== 'finished' && endgameClassification !== null) {
      throw new Error(`Unfinished ${label} must not include endgame classification`);
    }
    if (state.phase !== 'endgame' && endgameReview !== null) {
      throw new Error(`Non-endgame ${label} must not include partial endgame review`);
    }
    if (endgameReview) {
      const seen = new Set<string>();
      for (const group of endgameReview.groups) {
        if (!Array.isArray(group.points) || group.points.length === 0) {
          throw new Error(`Endgame review group for ${label} must contain points`);
        }
        if (group.status !== undefined && group.status !== null && !isGroupStatus(group.status)) {
          throw new Error(`Endgame review group for ${label} has invalid legacy status`);
        }
        if (group.userDecision !== undefined && group.userDecision !== null && !isGroupStatus(group.userDecision)) {
          throw new Error(`Endgame review group for ${label} has invalid user decision`);
        }
        if (group.proposal && !isProposalStatus(group.proposal.status)) {
          throw new Error(`Endgame review group for ${label} has invalid proposal status`);
        }

        const id = endgameGroupId(group.points);
        if (seen.has(id)) {
          throw new Error(`Endgame review for ${label} contains duplicate groups`);
        }
        seen.add(id);
      }
    }
    if (finalScore && (finalScore.ruleSet !== ruleSet || finalScore.komi !== komi)) {
      throw new Error(`Saved FinalScore for ${label} does not match saved game configuration`);
    }
  }
}
