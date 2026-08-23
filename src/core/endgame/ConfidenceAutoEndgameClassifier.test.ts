import { describe, expect, it } from 'vitest';
import type { EndgameAnalysisContext } from './EndgameClassifier';
import {
  ConfidenceAutoEndgameClassifier,
  CONFIDENCE_AUTO_ENDGAME_CLASSIFIER_ALGORITHM,
  type ConfidenceAutoEndgameClassifierDependencies,
} from './ConfidenceAutoEndgameClassifier';
import { classifyPositionConfidence } from './EndgameConfidenceClassifier';
import {
  selectAutomaticPositionStatuses,
  type EndgameConfidenceAutoPositionSelectionResult,
  type EndgameConfidenceAutoSelectionResult,
} from './EndgameConfidenceAutoSelector';
import { buildEndgameGraph } from './EndgameGraphCore';
import { endgameGroupId } from './EndgameGroupIdentity';
import {
  buildEngine2ConfidenceCorpus,
  type Engine2ConfidenceCorpusCase,
} from './testlab/Engine2ConfidenceCorpus';

const corpus = buildEngine2ConfidenceCorpus();

const corpusCase = (id: string): Engine2ConfidenceCorpusCase => {
  const found = corpus.find((item) => item.id === id);
  if (!found) throw new Error(`Missing E2-12b fixture: ${id}`);
  return found;
};

const fixtureContext = (id: string) => {
  const fixture = corpusCase(id);
  const graph = buildEndgameGraph(fixture.state, fixture.topology);
  const groupKey = graph.pointOwner.get(fixture.targetPoint);
  if (!groupKey) throw new Error(`Missing target group for ${id}`);
  const groups = Object.freeze(
    [...graph.groups.values()]
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
      .map((group) => group.points),
  );
  const context: EndgameAnalysisContext = Object.freeze({
    state: fixture.state,
    topology: fixture.topology,
    groups,
  });
  return Object.freeze({ fixture, graph, groupKey, context });
};

const analyzeFixture = async (id: string) => {
  const prepared = fixtureContext(id);
  const proposal = await new ConfidenceAutoEndgameClassifier().analyze(prepared.context);
  const target = proposal.find((group) => endgameGroupId(group.points) === prepared.groupKey);
  if (!target) throw new Error(`Missing adapter proposal for ${id}`);
  return Object.freeze({ ...prepared, proposal, target });
};

describe('E2-12d ConfidenceAutoEndgameClassifier', () => {
  it('maps every whole-position group exactly once into a deterministic resolved proposal', async () => {
    const { context, proposal } = await analyzeFixture('torus19-two-stone-open-space');
    expect(proposal).toHaveLength(context.groups.length);
    expect(new Set(proposal.map((group) => endgameGroupId(group.points))).size).toBe(context.groups.length);
    expect(proposal.every((group) => group.status !== 'unresolved')).toBe(true);
    expect(proposal.map((group) => endgameGroupId(group.points))).toEqual(
      [...proposal.map((group) => endgameGroupId(group.points))].sort(),
    );
    expect(proposal.every((group) => group.evidence?.algorithm === 'engine2-confidence-auto-select-v1')).toBe(true);
    expect(proposal.every((group) => group.evidence?.adapterAlgorithm === CONFIDENCE_AUTO_ENDGAME_CLASSIFIER_ALGORITHM)).toBe(true);
  });

  it('turns a normal raw unresolved result into a resolved automatic proposal instead of requiring manual input', async () => {
    const { target } = await analyzeFixture('ambiguous-three-liberty-contact');
    expect(target.status).not.toBe('unresolved');
    expect(target.source).toBe('automatic');
    expect(target.evidence).toMatchObject({
      outcome: 'selected',
      rawLabel: 'unresolved',
      mode: 'confidence',
    });
    expect(['high', 'medium', 'low']).toContain(target.evidence?.confidenceBand);
  });

  it('preserves strict alive, dead and seki authority from E2-12b/E2-12c', async () => {
    const alive = await analyzeFixture('benson-two-vital-regions');
    const dead = await analyzeFixture('one-liberty-strict-dead');
    const seki = await analyzeFixture('strict-seki-black');

    expect(alive.target).toMatchObject({ status: 'alive', source: 'automatic' });
    expect(alive.target.evidence).toMatchObject({ mode: 'strict-proof', confidenceBand: 'high' });
    expect(dead.target).toMatchObject({ status: 'dead', source: 'automatic' });
    expect(dead.target.evidence).toMatchObject({ mode: 'strict-proof', confidenceBand: 'high' });
    expect(seki.target).toMatchObject({ status: 'seki', source: 'automatic' });
    expect(seki.target.evidence).toMatchObject({ mode: 'strict-proof', confidenceBand: 'high' });
  });

  it('preserves canonical Torus seam and Cube face-edge group identity', async () => {
    const torus = await analyzeFixture('torus19-seam-open-space');
    const cube = await analyzeFixture('cube5-face-edge-open-space');

    expect(torus.graph.groups.get(torus.groupKey)?.points).toEqual(['0,9', '18,9']);
    expect(torus.target.points).toEqual(['0,9', '18,9']);
    expect(torus.target.status).toBe('alive');

    expect(cube.graph.groups.get(cube.groupKey)?.points).toEqual(cube.target.points);
    expect(cube.target.points).toHaveLength(2);
    expect(cube.target.status).toBe('alive');
  });

  it('runs one position analysis and one selector composition, while mapping technical failure to unresolved', async () => {
    const prepared = fixtureContext('torus9-isolated-open-space');
    let analysisCalls = 0;
    let selectorCalls = 0;

    const dependencies: ConfidenceAutoEndgameClassifierDependencies = Object.freeze({
      classifyPosition: (state, topology) => {
        analysisCalls += 1;
        return classifyPositionConfidence(state, topology);
      },
      selectPosition: (position) => {
        selectorCalls += 1;
        const selected = selectAutomaticPositionStatuses(position);
        const first = selected.decisions[0];
        if (!first) throw new Error('Expected a selector decision');
        const failure: EndgameConfidenceAutoSelectionResult = Object.freeze({
          outcome: 'technical-failure' as const,
          selectorAlgorithm: selected.selectorAlgorithm,
          sourceAlgorithm: first.sourceAlgorithm,
          groupKey: first.groupKey,
          rawLabel: first.rawLabel,
          failure: 'invalid-input' as const,
          reasons: Object.freeze(['synthetic-e2-12d-technical-failure']),
          scores: first.scores,
          diagnostics: Object.freeze({
            additionalGraphBuilds: 0 as const,
            additionalConfidenceAnalyses: 0 as const,
            deepProofSearchInvocations: 0 as const,
          }),
        });
        const result: EndgameConfidenceAutoPositionSelectionResult = Object.freeze({
          ...selected,
          decisions: Object.freeze([failure, ...selected.decisions.slice(1)]),
          diagnostics: Object.freeze({
            ...selected.diagnostics,
            automaticSelections: selected.diagnostics.automaticSelections - 1,
            technicalFailures: selected.diagnostics.technicalFailures + 1,
          }),
        });
        return result;
      },
    });

    const proposal = await new ConfidenceAutoEndgameClassifier(dependencies).analyze(prepared.context);
    expect(analysisCalls).toBe(1);
    expect(selectorCalls).toBe(1);
    expect(proposal.filter((group) => group.status === 'unresolved')).toHaveLength(1);
    expect(proposal.find((group) => group.status === 'unresolved')?.evidence).toMatchObject({
      outcome: 'technical-failure',
      failure: 'invalid-input',
      analysisDiagnostics: {
        sourceGraphBuilds: 1,
        additionalGraphBuilds: 0,
        additionalConfidenceAnalyses: 0,
        selectorDeepProofSearchInvocations: 0,
      },
    });
  });

  it('is byte-stable across repeated application analysis', async () => {
    const prepared = fixtureContext('torus19-narrow-contested-exit');
    const classifier = new ConfidenceAutoEndgameClassifier();
    const first = await classifier.analyze(prepared.context);
    const second = await classifier.analyze(prepared.context);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('rejects missing selector coverage instead of guessing a status', async () => {
    const prepared = fixtureContext('torus9-isolated-open-space');
    const dependencies: ConfidenceAutoEndgameClassifierDependencies = Object.freeze({
      classifyPosition: classifyPositionConfidence,
      selectPosition: (position) => {
        const selected = selectAutomaticPositionStatuses(position);
        return Object.freeze({ ...selected, decisions: Object.freeze(selected.decisions.slice(1)) });
      },
    });
    await expect(new ConfidenceAutoEndgameClassifier(dependencies).analyze(prepared.context)).rejects.toThrow(
      'omitted endgame groups',
    );
  });
});
