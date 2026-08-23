import { describe, expect, it } from 'vitest';
import { TorusTopology } from '../core/topology/TorusTopology';
import type { EndgameGroupPresentation } from './EndgameGroupPresentation';
import { provisionalEndgameTerritory } from './EndgameTerritoryPresentation';
import type { GameViewModel } from './PresentationModel';

const viewModel = (
  occupied: Readonly<Record<string, 'black' | 'white'>>,
): GameViewModel => {
  const topology = new TorusTopology(9);
  return Object.freeze({
    points: Object.freeze(
      topology.points().map((logicalPointId) => Object.freeze({
        logicalPointId,
        occupancy: occupied[logicalPointId] ?? 'empty',
      })),
    ),
    currentPlayer: 'black',
    moveNumber: 0,
    consecutivePasses: 2,
    phase: 'endgame',
    captures: Object.freeze({ black: 0, white: 0 }),
    ruleSet: 'chinese',
    komi: 7.5,
    finalScore: null,
  });
};

const group = (
  id: string,
  color: 'black' | 'white',
  points: readonly string[],
): EndgameGroupPresentation => Object.freeze({
  id,
  color,
  points: Object.freeze([...points]),
  edges: Object.freeze([]),
});

describe('provisionalEndgameTerritory', () => {
  it('shows a region only after every touching group has a resolved non-seki status', () => {
    const topology = new TorusTopology(9);
    const blackRing = [
      '3,3', '4,3', '5,3',
      '3,4',        '5,4',
      '3,5', '4,5', '5,5',
    ];
    const groups = [group('black-ring', 'black', blackRing)];
    const vm = viewModel(Object.fromEntries(blackRing.map((point) => [point, 'black'])));

    expect(provisionalEndgameTerritory({
      viewModel: vm,
      topology,
      groups,
      decisions: {},
    }).has('4,4')).toBe(false);

    expect(provisionalEndgameTerritory({
      viewModel: vm,
      topology,
      groups,
      decisions: { 'black-ring': 'alive' },
    }).get('4,4')).toBe('black');
  });

  it('keeps territory touching seki neutral', () => {
    const topology = new TorusTopology(9);
    const blackRing = [
      '3,3', '4,3', '5,3',
      '3,4',        '5,4',
      '3,5', '4,5', '5,5',
    ];
    const groups = [group('seki-ring', 'black', blackRing)];
    const vm = viewModel(Object.fromEntries(blackRing.map((point) => [point, 'black'])));

    expect(provisionalEndgameTerritory({
      viewModel: vm,
      topology,
      groups,
      decisions: { 'seki-ring': 'seki' },
    }).has('4,4')).toBe(false);
  });

  it('uses dead groups as empty space but does not put review dots on the still-visible dead stones', () => {
    const topology = new TorusTopology(9);
    const whiteRing = [
      '3,3', '4,3', '5,3',
      '3,4',        '5,4',
      '3,5', '4,5', '5,5',
    ];
    const deadBlack = ['4,4'];
    const groups = [
      group('white-ring', 'white', whiteRing),
      group('dead-black', 'black', deadBlack),
    ];
    const vm = viewModel({
      ...Object.fromEntries(whiteRing.map((point) => [point, 'white'] as const)),
      '4,4': 'black',
    });

    const territory = provisionalEndgameTerritory({
      viewModel: vm,
      topology,
      groups,
      decisions: { 'white-ring': 'alive', 'dead-black': 'dead' },
    });

    expect(territory.has('4,4')).toBe(false);
  });
});
