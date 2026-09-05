export const AND_OR_SEARCH_ALGORITHM = 'and-or-dfs-v1';

export type AndOrNodeType = 'or' | 'and';
export type AndOrResolvedOutcome = 'proved' | 'refuted';
export type AndOrSearchOutcome = AndOrResolvedOutcome | 'unknown';
export type AndOrUnknownReason = 'budget' | 'incomplete' | 'cycle';
export type AndOrTraceSource =
  | 'expanded'
  | 'terminal'
  | 'transposition'
  | 'budget'
  | 'cycle';

export interface AndOrSearchChild<State> {
  readonly move: string;
  readonly state: State;
}

export interface AndOrExpansion<State> {
  readonly children: readonly AndOrSearchChild<State>[];
  readonly complete: boolean;
}

export interface AndOrSearchAdapter<State> {
  readonly stateKey: (state: State) => string;
  readonly nodeType: (state: State) => AndOrNodeType;
  readonly terminal: (state: State) => AndOrResolvedOutcome | null;
  readonly expand: (state: State) => AndOrExpansion<State>;
}

export interface AndOrProofTraceChild {
  readonly move: string;
  readonly outcome: AndOrSearchOutcome;
  readonly unknownReason: AndOrUnknownReason | null;
  readonly trace: AndOrProofTrace;
}

export interface AndOrProofTrace {
  readonly nodeKey: string;
  readonly nodeType: AndOrNodeType;
  readonly outcome: AndOrSearchOutcome;
  readonly unknownReason: AndOrUnknownReason | null;
  readonly source: AndOrTraceSource;
  readonly children: readonly AndOrProofTraceChild[];
}

export interface AndOrSearchOptions {
  readonly maxNodes: number;
  /** External resource guard such as a global wall-clock deadline. True means fail closed as budget. */
  readonly shouldStop?: () => boolean;
}

export interface AndOrSearchResult {
  readonly algorithm: typeof AND_OR_SEARCH_ALGORITHM;
  readonly outcome: AndOrSearchOutcome;
  readonly unknownReason: AndOrUnknownReason | null;
  readonly exploredNodes: number;
  readonly transpositionHits: number;
  readonly maxDepth: number;
  readonly trace: AndOrProofTrace;
}

interface SearchRuntime<State> {
  readonly adapter: AndOrSearchAdapter<State>;
  readonly maxNodes: number;
  readonly shouldStop: () => boolean;
  exploredNodes: number;
  transpositionHits: number;
  maxDepth: number;
  readonly transposition: Map<string, AndOrResolvedOutcome>;
}

interface SearchVerdict {
  readonly outcome: AndOrSearchOutcome;
  readonly unknownReason: AndOrUnknownReason | null;
  readonly trace: AndOrProofTrace;
}

const EMPTY_TRACE_CHILDREN: readonly AndOrProofTraceChild[] = Object.freeze([]);
const cacheKeyFor = (nodeType: AndOrNodeType, nodeKey: string): string => `${nodeType}\u0000${nodeKey}`;
const unknownRank: Readonly<Record<AndOrUnknownReason, number>> = Object.freeze({ budget: 3, incomplete: 2, cycle: 1 });

const selectUnknownReason = (reasons: readonly AndOrUnknownReason[]): AndOrUnknownReason => {
  let selected: AndOrUnknownReason = 'cycle';
  for (const reason of reasons) if (unknownRank[reason] > unknownRank[selected]) selected = reason;
  return selected;
};

const leafTrace = (
  nodeKey: string,
  nodeType: AndOrNodeType,
  outcome: AndOrSearchOutcome,
  unknownReason: AndOrUnknownReason | null,
  source: AndOrTraceSource,
): AndOrProofTrace => Object.freeze({ nodeKey, nodeType, outcome, unknownReason, source, children: EMPTY_TRACE_CHILDREN });

const freezeTraceChild = (move: string, verdict: SearchVerdict): AndOrProofTraceChild =>
  Object.freeze({ move, outcome: verdict.outcome, unknownReason: verdict.unknownReason, trace: verdict.trace });

const expandedTrace = (
  nodeKey: string,
  nodeType: AndOrNodeType,
  outcome: AndOrSearchOutcome,
  unknownReason: AndOrUnknownReason | null,
  children: readonly AndOrProofTraceChild[],
): AndOrProofTrace => Object.freeze({ nodeKey, nodeType, outcome, unknownReason, source: 'expanded' as const, children: Object.freeze([...children]) });

const resolvedVerdict = <State>(
  runtime: SearchRuntime<State>,
  cacheKey: string,
  nodeKey: string,
  nodeType: AndOrNodeType,
  outcome: AndOrResolvedOutcome,
  source: AndOrTraceSource,
  children: readonly AndOrProofTraceChild[] = EMPTY_TRACE_CHILDREN,
): SearchVerdict => {
  runtime.transposition.set(cacheKey, outcome);
  return Object.freeze({
    outcome,
    unknownReason: null,
    trace: source === 'expanded'
      ? expandedTrace(nodeKey, nodeType, outcome, null, children)
      : leafTrace(nodeKey, nodeType, outcome, null, source),
  });
};

const unknownVerdict = (
  nodeKey: string,
  nodeType: AndOrNodeType,
  reason: AndOrUnknownReason,
  source: AndOrTraceSource,
  children: readonly AndOrProofTraceChild[] = EMPTY_TRACE_CHILDREN,
): SearchVerdict => Object.freeze({
  outcome: 'unknown' as const,
  unknownReason: reason,
  trace: source === 'expanded'
    ? expandedTrace(nodeKey, nodeType, 'unknown', reason, children)
    : leafTrace(nodeKey, nodeType, 'unknown', reason, source),
});

const search = <State>(
  runtime: SearchRuntime<State>,
  state: State,
  activePath: ReadonlySet<string>,
  depth: number,
): SearchVerdict => {
  runtime.maxDepth = Math.max(runtime.maxDepth, depth);
  const nodeKey = runtime.adapter.stateKey(state);
  const nodeType = runtime.adapter.nodeType(state);
  const cacheKey = cacheKeyFor(nodeType, nodeKey);
  const cached = runtime.transposition.get(cacheKey);

  if (cached) {
    runtime.transpositionHits += 1;
    return Object.freeze({ outcome: cached, unknownReason: null, trace: leafTrace(nodeKey, nodeType, cached, null, 'transposition') });
  }
  if (activePath.has(cacheKey)) return unknownVerdict(nodeKey, nodeType, 'cycle', 'cycle');
  if (runtime.exploredNodes >= runtime.maxNodes || runtime.shouldStop()) {
    return unknownVerdict(nodeKey, nodeType, 'budget', 'budget');
  }
  runtime.exploredNodes += 1;

  const terminal = runtime.adapter.terminal(state);
  if (terminal) return resolvedVerdict(runtime, cacheKey, nodeKey, nodeType, terminal, 'terminal');

  const expansion = runtime.adapter.expand(state);
  const nextPath = new Set(activePath);
  nextPath.add(cacheKey);
  const traceChildren: AndOrProofTraceChild[] = [];
  const unknownReasons: AndOrUnknownReason[] = [];

  if (nodeType === 'or') {
    for (const child of expansion.children) {
      const verdict = search(runtime, child.state, nextPath, depth + 1);
      traceChildren.push(freezeTraceChild(child.move, verdict));
      if (verdict.outcome === 'proved') return resolvedVerdict(runtime, cacheKey, nodeKey, nodeType, 'proved', 'expanded', traceChildren);
      if (verdict.outcome === 'unknown' && verdict.unknownReason) unknownReasons.push(verdict.unknownReason);
    }
    if (!expansion.complete) unknownReasons.push('incomplete');
    if (unknownReasons.length > 0) return unknownVerdict(nodeKey, nodeType, selectUnknownReason(unknownReasons), 'expanded', traceChildren);
    return resolvedVerdict(runtime, cacheKey, nodeKey, nodeType, 'refuted', 'expanded', traceChildren);
  }

  for (const child of expansion.children) {
    const verdict = search(runtime, child.state, nextPath, depth + 1);
    traceChildren.push(freezeTraceChild(child.move, verdict));
    if (verdict.outcome === 'refuted') return resolvedVerdict(runtime, cacheKey, nodeKey, nodeType, 'refuted', 'expanded', traceChildren);
    if (verdict.outcome === 'unknown' && verdict.unknownReason) unknownReasons.push(verdict.unknownReason);
  }
  if (!expansion.complete) unknownReasons.push('incomplete');
  if (unknownReasons.length > 0) return unknownVerdict(nodeKey, nodeType, selectUnknownReason(unknownReasons), 'expanded', traceChildren);
  return resolvedVerdict(runtime, cacheKey, nodeKey, nodeType, 'proved', 'expanded', traceChildren);
};

export const runAndOrSearch = <State>(
  root: State,
  adapter: AndOrSearchAdapter<State>,
  options: AndOrSearchOptions,
): AndOrSearchResult => {
  if (!Number.isInteger(options.maxNodes) || options.maxNodes < 0) {
    throw new RangeError('maxNodes must be a non-negative integer');
  }
  const runtime: SearchRuntime<State> = {
    adapter,
    maxNodes: options.maxNodes,
    shouldStop: options.shouldStop ?? (() => false),
    exploredNodes: 0,
    transpositionHits: 0,
    maxDepth: 0,
    transposition: new Map(),
  };
  const verdict = search(runtime, root, new Set(), 0);
  return Object.freeze({
    algorithm: AND_OR_SEARCH_ALGORITHM,
    outcome: verdict.outcome,
    unknownReason: verdict.unknownReason,
    exploredNodes: runtime.exploredNodes,
    transpositionHits: runtime.transpositionHits,
    maxDepth: runtime.maxDepth,
    trace: verdict.trace,
  });
};
