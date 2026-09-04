export type ReplaySpeed = 1 | 5 | 10;

export interface ReplayControlsProps {
  readonly position: number;
  readonly total: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
  readonly disabled?: boolean;
  readonly onJumpStart: () => void;
  readonly onPrevious: () => void;
  readonly onTogglePlay: () => void;
  readonly onNext: () => void;
  readonly onJumpEnd: () => void;
  readonly onSeek: (position: number) => void;
  readonly onSpeedChange: (speed: ReplaySpeed) => void;
}

const SPEEDS: readonly ReplaySpeed[] = [1, 5, 10];

export function ReplayControls({
  position,
  total,
  playing,
  speed,
  disabled = false,
  onJumpStart,
  onPrevious,
  onTogglePlay,
  onNext,
  onJumpEnd,
  onSeek,
  onSpeedChange,
}: ReplayControlsProps) {
  return (
    <section className="developer-replay-controls" aria-label="Replay controls">
      <div className="developer-replay-controls__transport">
        <button type="button" aria-label="Replay start" disabled={disabled || position === 0} onClick={onJumpStart}>|←</button>
        <button type="button" aria-label="Previous move" disabled={disabled || position === 0} onClick={onPrevious}>←</button>
        <button type="button" aria-label={playing ? 'Pause replay' : 'Play replay'} disabled={disabled || total === 0} onClick={onTogglePlay}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" aria-label="Next move" disabled={disabled || position >= total} onClick={onNext}>→</button>
        <button type="button" aria-label="Replay end" disabled={disabled || position >= total} onClick={onJumpEnd}>→|</button>
        <output className="developer-replay-controls__position" aria-live="polite">{position} / {total}</output>
      </div>

      <label className="developer-replay-controls__slider">
        Replay position
        <input
          type="range"
          min={0}
          max={Math.max(0, total)}
          step={1}
          value={Math.min(position, total)}
          disabled={disabled || total === 0}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </label>

      <div className="developer-replay-controls__speeds" role="group" aria-label="Replay speed">
        {SPEEDS.map((candidate) => (
          <button
            type="button"
            key={candidate}
            aria-pressed={speed === candidate}
            className={speed === candidate ? 'is-selected' : undefined}
            disabled={disabled}
            onClick={() => onSpeedChange(candidate)}
          >
            {candidate}×
          </button>
        ))}
      </div>
    </section>
  );
}
