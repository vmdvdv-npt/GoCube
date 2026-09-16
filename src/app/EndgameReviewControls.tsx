import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import type { EndgameGroupPresentation } from '../presentation/EndgameGroupPresentation';
import type { SharedEndgameDecisions } from './GameSessionControllerFacade';

export const ENDGAME_REVIEW_STATUSES: readonly GroupStatus[] = Object.freeze([
  'alive',
  'dead',
  'seki',
]);

export const endgameReviewStatusLabel = (status: GroupStatus): string =>
  status === 'alive' ? 'Alive' : status === 'dead' ? 'Dead' : 'Seki';

export interface EndgameReviewControlsProps {
  readonly titleId: string;
  readonly reviewReady: boolean;
  readonly groups: readonly EndgameGroupPresentation[];
  readonly decisions: SharedEndgameDecisions;
  readonly selectedGroup: EndgameGroupPresentation | null;
  readonly resolvedCount: number;
  readonly automaticClassified: number;
  readonly canFinish: boolean;
  readonly onDecision: (groupId: string, status: GroupStatus) => void | Promise<void>;
  readonly onFinish: () => void | Promise<void>;
}

export function EndgameReviewControls({
  titleId,
  reviewReady,
  groups,
  decisions,
  selectedGroup,
  resolvedCount,
  automaticClassified,
  canFinish,
  onDecision,
  onFinish,
}: EndgameReviewControlsProps) {
  return (
    <section className="endgame-panel" aria-labelledby={titleId}>
      <div>
        <h2 id={titleId}>Assisted endgame review</h2>
        <p>
          Click any stone to select its whole group. You can change Alive, Dead, or Seki even when the status was proposed automatically.
        </p>
      </div>

      {!reviewReady ? (
        <p className="endgame-empty">Final analysis is still completing.</p>
      ) : groups.length > 0 ? (
        <>
          <div className="endgame-progress" aria-live="polite">
            Resolved {resolvedCount} of {groups.length}
            {automaticClassified > 0 ? ` · ${automaticClassified} automatic proposals` : ''}
          </div>

          {selectedGroup ? (
            <div className="endgame-selection">
              <div className="endgame-selection__identity">
                <span
                  className={`stone-chip stone-chip--${selectedGroup.color}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>Selected group</strong>
                  <span>
                    {selectedGroup.points.length}{' '}
                    {selectedGroup.points.length === 1 ? 'stone' : 'stones'}
                  </span>
                </div>
              </div>
              <div
                className="endgame-statuses"
                role="group"
                aria-label="Selected group status"
              >
                {ENDGAME_REVIEW_STATUSES.map((status) => (
                  <button
                    type="button"
                    key={status}
                    className={decisions[selectedGroup.id] === status ? 'is-selected' : undefined}
                    aria-pressed={decisions[selectedGroup.id] === status}
                    onClick={() => void onDecision(selectedGroup.id, status)}
                  >
                    {endgameReviewStatusLabel(status)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="endgame-empty">Click a stone to review or change its group status.</p>
          )}
        </>
      ) : (
        <p className="endgame-empty">There are no stone groups to review.</p>
      )}

      <button
        type="button"
        className="endgame-finish"
        disabled={!canFinish}
        onClick={() => void onFinish()}
      >
        Finish scoring
      </button>
    </section>
  );
}
