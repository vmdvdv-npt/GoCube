import { useEffect, useRef, useState } from 'react';
import {
  analyzeEngine2PlaytestGroup,
  DEFAULT_ENGINE2_PLAYTEST_NODE_BUDGET,
  type Engine2PlaytestDiagnostic,
  type Engine2PlaytestVerdict,
} from '../core/endgame/Engine2PlaytestDiagnostic';
import type { GameSessionSnapshot } from '../core/persistence/GameSessionSnapshot';
import { CubeTopology } from '../core/topology/CubeTopology';
import type { PointId, Topology } from '../core/topology/Topology';
import { TORUS_SIZES, TorusTopology, type TorusSize } from '../core/topology/TorusTopology';
import './engine2-playtest-diagnostics.css';

type SurfaceMode = 'torus' | 'cube';

type Selection = Readonly<{
  mode: SurfaceMode;
  pointId: PointId;
}>;

type TimedDiagnostic = Readonly<{
  diagnostic: Engine2PlaytestDiagnostic;
  runtimeMs: number;
}>;

const CURRENT_GAME_STORAGE_KEY = 'gocube:game:current';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const surfaceMode = (): SurfaceMode =>
  document.querySelector('.cube-2d-game') ? 'cube' : 'torus';

const pointIdFromClick = (target: EventTarget | null): PointId | null => {
  if (!(target instanceof Element)) return null;
  const element = target.closest(
    '[data-logical-point-id], .cube-2d-hit-area[data-point-id]',
  );
  return (
    element?.getAttribute('data-logical-point-id') ??
    element?.getAttribute('data-point-id') ??
    null
  );
};

const isOccupiedLogicalPoint = (mode: SurfaceMode, pointId: PointId): boolean => {
  const selector = mode === 'cube'
    ? '.cube-2d-stone[data-logical-point-id][data-occupancy]'
    : '.torus-board__stone[data-logical-point-id][data-occupancy]';
  return [...document.querySelectorAll<Element>(selector)].some(
    (element) => element.getAttribute('data-logical-point-id') === pointId,
  );
};

const topologyForMode = (mode: SurfaceMode): Topology | null => {
  if (mode === 'cube') {
    const raw = Number(
      document.querySelector('.cube-2d-renderer')?.getAttribute('data-cube-size'),
    );
    if (!Number.isSafeInteger(raw) || raw < 2) return null;
    try {
      return new CubeTopology(raw);
    } catch {
      return null;
    }
  }

  const pointCount = document.querySelectorAll(
    '.torus-board__hit-target[data-copy-role="primary"]',
  ).length;
  const raw = Math.round(Math.sqrt(pointCount));
  if (!TORUS_SIZES.includes(raw as TorusSize)) return null;
  return new TorusTopology(raw as TorusSize);
};

const readCurrentSnapshot = (): GameSessionSnapshot => {
  const raw = localStorage.getItem(CURRENT_GAME_STORAGE_KEY);
  if (!raw) throw new Error('Current game snapshot is not available.');

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !isRecord(parsed.state) || !isRecord(parsed.state.snapshot)) {
    throw new Error('Current game snapshot has an unexpected format.');
  }
  const snapshot = parsed.state.snapshot;
  if (!Array.isArray(snapshot.history) || snapshot.history.length === 0) {
    throw new Error('Current game snapshot has no game history.');
  }
  return snapshot as unknown as GameSessionSnapshot;
};

const verdictLabel = (verdict: Engine2PlaytestVerdict): string => {
  switch (verdict) {
    case 'proven-dead':
      return 'PROVEN DEAD';
    case 'proven-alive':
      return 'PROVEN ALIVE';
    case 'proven-seki':
      return 'PROVEN SEKI';
    case 'first-player-dependent':
      return 'FIRST-PLAYER DEPENDENT';
    case 'ko-dependent':
      return 'KO DEPENDENT';
    case 'budget-exhausted':
      return 'BUDGET EXHAUSTED';
    case 'unresolved':
      return 'UNRESOLVED';
  }
};

const outcomeLabel = (outcome: string): string =>
  outcome.replaceAll('-', ' ').toUpperCase();

export function Engine2PlaytestDiagnostics() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [result, setResult] = useState<TimedDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runTokenRef = useRef(0);

  useEffect(() => {
    const clearWhenReviewEnds = (): void => {
      if (document.querySelector('.endgame-panel')) return;
      runTokenRef.current += 1;
      setSelection(null);
      setResult(null);
      setBusy(false);
      setError(null);
    };

    const handleClick = (event: MouseEvent): void => {
      if (!document.querySelector('.endgame-panel')) return;
      const pointId = pointIdFromClick(event.target);
      if (!pointId) return;
      const mode = surfaceMode();
      if (!isOccupiedLogicalPoint(mode, pointId)) return;

      runTokenRef.current += 1;
      setSelection(Object.freeze({ mode, pointId }));
      setResult(null);
      setBusy(false);
      setError(null);
    };

    document.addEventListener('click', handleClick);
    const root = document.getElementById('root');
    const observer = new MutationObserver(clearWhenReviewEnds);
    if (root) observer.observe(root, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('click', handleClick);
      observer.disconnect();
    };
  }, []);

  const runDiagnostic = (): void => {
    if (!selection || busy) return;
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    setBusy(true);
    setResult(null);
    setError(null);

    window.setTimeout(() => {
      if (runTokenRef.current !== token) return;
      try {
        const topology = topologyForMode(selection.mode);
        if (!topology) throw new Error('Could not resolve the active board topology.');
        const snapshot = readCurrentSnapshot();
        const startedAt = performance.now();
        const diagnostic = analyzeEngine2PlaytestGroup(
          snapshot,
          topology,
          selection.pointId,
          Object.freeze({ nodeBudget: DEFAULT_ENGINE2_PLAYTEST_NODE_BUDGET }),
        );
        const runtimeMs = performance.now() - startedAt;
        if (!diagnostic) throw new Error('Engine 2 could not resolve the selected stone group.');
        if (runTokenRef.current !== token) return;
        setResult(Object.freeze({ diagnostic, runtimeMs }));
      } catch (cause) {
        if (runTokenRef.current !== token) return;
        setError(cause instanceof Error ? cause.message : 'Engine 2 diagnostic failed.');
      } finally {
        if (runTokenRef.current === token) setBusy(false);
      }
    }, 0);
  };

  if (!selection || !document.querySelector('.endgame-panel')) return null;

  const diagnostic = result?.diagnostic ?? null;
  const provenSekiCount = diagnostic?.semeai.filter(
    (analysis) => analysis.seki.status === 'proven-seki',
  ).length ?? 0;

  return (
    <aside
      className="engine2-playtest-diagnostic"
      data-testid="engine2-playtest-diagnostic"
      aria-label="Engine 2 playtest diagnostic"
    >
      <div className="engine2-playtest-diagnostic__heading">
        <div>
          <strong>Engine 2 diagnostic</strong>
          <span>Diagnostic only · does not change scoring</span>
        </div>
        <span className="engine2-playtest-diagnostic__budget">
          budget {DEFAULT_ENGINE2_PLAYTEST_NODE_BUDGET}
        </span>
      </div>

      <button
        type="button"
        className="engine2-playtest-diagnostic__run"
        disabled={busy}
        onClick={runDiagnostic}
      >
        {busy ? 'Analyzing…' : result ? 'Analyze again' : 'Analyze selected group'}
      </button>

      {error ? (
        <p className="engine2-playtest-diagnostic__error" role="alert">{error}</p>
      ) : null}

      {diagnostic ? (
        <div className="engine2-playtest-diagnostic__result" aria-live="polite">
          <strong className="engine2-playtest-diagnostic__verdict">
            {verdictLabel(diagnostic.verdict)}
          </strong>
          <span>
            {diagnostic.color} · {diagnostic.points.length} stones · {diagnostic.liberties.length} liberties
          </span>
          <span>
            runtime {result!.runtimeMs.toFixed(1)} ms · exact previous board {diagnostic.previousBoardKnown ? 'yes' : 'no'}
          </span>

          <dl>
            <div>
              <dt>Attacker first</dt>
              <dd>
                {outcomeLabel(diagnostic.attackerFirst.result.outcome)} · {diagnostic.attackerFirst.result.exploredNodes} nodes
              </dd>
            </div>
            <div>
              <dt>Defender first</dt>
              <dd>
                {outcomeLabel(diagnostic.defenderFirst.result.outcome)} · {diagnostic.defenderFirst.result.exploredNodes} nodes
              </dd>
            </div>
            <div>
              <dt>Eye space</dt>
              <dd>
                {diagnostic.eyeSpace
                  ? `${diagnostic.eyeSpace.minEyes}–${diagnostic.eyeSpace.maxEyes} eyes · ${diagnostic.eyeSpace.complete ? 'complete' : 'incomplete'}`
                  : 'not available'}
              </dd>
            </div>
            <div>
              <dt>Semeai / seki</dt>
              <dd>
                {diagnostic.semeai.length === 0
                  ? 'no shared-liberty opponent'
                  : `${diagnostic.semeai.length} pair(s) · ${provenSekiCount} proven seki`}
              </dd>
            </div>
          </dl>

          <details>
            <summary>Proof details</summary>
            <div className="engine2-playtest-diagnostic__details">
              <span>Attacker: {diagnostic.attackerFirst.result.reason}</span>
              <span>Defender: {diagnostic.defenderFirst.result.reason}</span>
              <span>
                Attacker PV: {diagnostic.attackerFirst.result.principalVariation.join(' → ') || '—'}
              </span>
              <span>
                Defender PV: {diagnostic.defenderFirst.result.principalVariation.join(' → ') || '—'}
              </span>
              {diagnostic.eyeSpace?.unresolvedReasons.length ? (
                <span>Eye unresolved: {diagnostic.eyeSpace.unresolvedReasons.join(', ')}</span>
              ) : null}
              {diagnostic.semeai.map((analysis) => (
                <span key={analysis.groupKeys.join('|')}>
                  Seki pair: {analysis.seki.status} · {analysis.seki.reason}
                </span>
              ))}
            </div>
          </details>
        </div>
      ) : (
        <p className="engine2-playtest-diagnostic__hint">
          Select a group after two Passes, then run the proof stack.
        </p>
      )}
    </aside>
  );
}
