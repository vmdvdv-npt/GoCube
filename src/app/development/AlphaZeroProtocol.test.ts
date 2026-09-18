import { describe, expect, it } from 'vitest';
import type { AlphaZeroSelectMoveRequest } from './AlphaZeroGateway';
import {
  parseAlphaZeroCheckpointList,
  parseAlphaZeroGeneratedGame,
  parseAlphaZeroHealth,
  parseAlphaZeroSelectedMove,
} from './AlphaZeroProtocol';

const checkpoint = {
  id: 'cube4-run-12',
  runName: 'cube4-run',
  iteration: 12,
  topology: 'cube',
  size: 4,
  ruleSet: 'chinese',
  komi: 7.5,
  lineageStatus: 'ACTIVE',
} as const;

const generatedGameBase = {
  protocolVersion: 1,
  topology: 'cube',
  size: 4,
  ruleSet: 'chinese',
  komi: 7.5,
  blackCheckpoint: checkpoint.id,
  whiteCheckpoint: checkpoint.id,
  mctsSimulations: 100,
} as const;

const torusMoveRequest: AlphaZeroSelectMoveRequest = {
  requestId: 'request-1',
  checkpointId: 'torus9-m88',
  mctsSimulations: 128,
  position: {
    topology: 'torus',
    size: 9,
    ruleSet: 'chinese',
    komi: 0.5,
    moves: [],
  },
};

const selectedMoveBase = {
  protocolVersion: 1,
  requestId: 'request-1',
  checkpointId: 'torus9-m88',
  mctsSims: 128,
  moveNumber: 1,
  color: 'black',
  action: { type: 'place', pointId: '0,0' },
  search: {
    simulations: 128,
    implementationId: 'sequential-puct-v1',
  },
} as const;

describe('AlphaZero protocol V1', () => {
  it('accepts valid health data', () => {
    expect(parseAlphaZeroHealth({ protocolVersion: 1, service: 'gocube-alphazero', version: '0.1' })).toEqual({
      protocolVersion: 1,
      service: 'gocube-alphazero',
      version: '0.1',
    });
  });

  it('accepts health capabilities and keeps legacy health compatible', () => {
    expect(parseAlphaZeroHealth({
      protocolVersion: 1,
      service: 'gocube-alphazero',
      version: 'cuda',
      capabilities: { generateGame: true, selectMove: true },
    }).capabilities).toEqual({ generateGame: true, selectMove: true });

    expect(parseAlphaZeroHealth({
      protocolVersion: 1,
      service: 'gocube-alphazero',
      version: 'cpu',
    }).capabilities).toBeUndefined();
  });

  it('rejects malformed health capabilities', () => {
    expect(() => parseAlphaZeroHealth({
      protocolVersion: 1,
      service: 'gocube-alphazero',
      version: 'cpu',
      capabilities: { generateGame: true, selectMove: 'yes' },
    })).toThrow(/selectMove/i);
  });

  it('rejects an unsupported protocol version', () => {
    expect(() => parseAlphaZeroHealth({ protocolVersion: 2, service: 'x', version: '1' })).toThrow(/unsupported/i);
  });

  it('accepts a valid checkpoint list and rejects an invalid descriptor', () => {
    expect(parseAlphaZeroCheckpointList({ protocolVersion: 1, checkpoints: [checkpoint] })).toEqual([checkpoint]);
    expect(() => parseAlphaZeroCheckpointList({
      protocolVersion: 1,
      checkpoints: [{ ...checkpoint, size: 1 }],
    })).toThrow(/size/i);
  });

  it('accepts archived and discarded lineage status and rejects unknown status', () => {
    expect(parseAlphaZeroCheckpointList({
      protocolVersion: 1,
      checkpoints: [
        { ...checkpoint, id: 'archived', lineageStatus: 'ARCHIVED' },
        { ...checkpoint, id: 'discarded', lineageStatus: 'DISCARDED' },
      ],
    }).map((item) => item.lineageStatus)).toEqual(['ARCHIVED', 'DISCARDED']);

    expect(() => parseAlphaZeroCheckpointList({
      protocolVersion: 1,
      checkpoints: [{ ...checkpoint, lineageStatus: 'CLOSED' }],
    })).toThrow(/lineageStatus/i);
  });

  it('accepts a generated game with canonical Cube PointIds', () => {
    expect(parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [
        { moveNumber: 1, color: 'black', action: { type: 'place', pointId: 'front:0:0' }, captured: [] },
        { moveNumber: 2, color: 'white', action: { type: 'pass' } },
      ],
    }).moves).toHaveLength(2);
  });

  it('parses legacy scored terminal diagnostics with V2-safe defaults', () => {
    const game = parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [],
      result: {
        winner: 'white',
        fallbackCount: 4,
        score: {
          ruleSet: 'chinese',
          black: 20,
          white: 24.5,
          komi: 7.5,
          winner: 'white',
          margin: 4.5,
        },
      },
    });

    expect(game.result).toEqual({
      winner: 'white',
      fallbackCount: 4,
      unresolvedCount: 0,
      cleanupMoveCount: 0,
      noResult: false,
      score: {
        ruleSet: 'chinese',
        black: 20,
        white: 24.5,
        komi: 7.5,
        winner: 'white',
        margin: 4.5,
      },
    });
  });

  it('parses Japanese V2 scored diagnostics', () => {
    const game = parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      ruleSet: 'japanese',
      moves: [],
      result: {
        winner: 'black',
        adjudicatorId: 'gocube-japanese-cleanup-v2',
        fallbackCount: 0,
        unresolvedCount: 0,
        cleanupMoveCount: 11,
        noResult: false,
        score: {
          ruleSet: 'japanese',
          black: 18,
          white: 16.5,
          komi: 7.5,
          winner: 'black',
          margin: 1.5,
        },
      },
    });

    expect(game.result).toMatchObject({
      adjudicatorId: 'gocube-japanese-cleanup-v2',
      cleanupMoveCount: 11,
      unresolvedCount: 0,
      noResult: false,
      score: { ruleSet: 'japanese', winner: 'black' },
    });
  });

  it('accepts Japanese V2 no-result without fabricating a scored draw', () => {
    const rawResult = {
      winner: 'draw',
      adjudicatorId: 'gocube-japanese-cleanup-v2',
      fallbackCount: 0,
      unresolvedCount: 2,
      cleanupMoveCount: 14,
      noResult: true,
      score: null,
    };
    const game = parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      ruleSet: 'japanese',
      moves: [],
      result: rawResult,
    });

    expect(game.result).toBeUndefined();
    expect(game.terminal).toEqual(rawResult);
  });

  it('rejects malformed terminal result diagnostics', () => {
    expect(() => parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [],
      result: { winner: 'white', fallbackCount: 1 },
    })).toThrow(/result\.score/i);

    expect(() => parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [],
      result: {
        winner: 'white',
        fallbackCount: -1,
        score: {
          ruleSet: 'chinese', black: 1, white: 7.5, komi: 7.5, winner: 'white', margin: 6.5,
        },
      },
    })).toThrow(/fallbackCount/i);

    expect(() => parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [],
      result: {
        winner: 'draw', fallbackCount: 0, unresolvedCount: 0, noResult: true, score: null,
      },
    })).toThrow(/unresolvedCount/i);
  });

  it('rejects malformed moves, invalid PointIds, and skipped numbering', () => {
    expect(() => parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [{ moveNumber: 1, color: 'black', action: { type: 'place', pointId: 'not-a-point' } }],
    })).toThrow(/PointId/i);
    expect(() => parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [{ moveNumber: 2, color: 'black', action: { type: 'pass' } }],
    })).toThrow(/moveNumber/i);
    expect(() => parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [{ moveNumber: 1, color: 'green', action: { type: 'pass' } }],
    })).toThrow(/color/i);
  });

  it('parses a valid Torus selected place move', () => {
    expect(parseAlphaZeroSelectedMove(selectedMoveBase, torusMoveRequest)).toEqual({
      protocolVersion: 1,
      requestId: 'request-1',
      checkpointId: 'torus9-m88',
      mctsSimulations: 128,
      moveNumber: 1,
      color: 'black',
      action: { type: 'place', pointId: '0,0' },
      search: { simulations: 128, implementationId: 'sequential-puct-v1' },
    });
  });

  it('parses a valid selected pass move', () => {
    expect(parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      action: { type: 'pass' },
    }, torusMoveRequest).action).toEqual({ type: 'pass' });
  });

  it('validates canonical Cube PointIds for selected moves', () => {
    const cubeRequest: AlphaZeroSelectMoveRequest = {
      ...torusMoveRequest,
      position: { ...torusMoveRequest.position, topology: 'cube', size: 4 },
    };
    expect(parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      action: { type: 'place', pointId: 'front:0:0' },
    }, cubeRequest).action).toEqual({ type: 'place', pointId: 'front:0:0' });
    expect(() => parseAlphaZeroSelectedMove(selectedMoveBase, cubeRequest)).toThrow(/PointId/i);
  });

  it('validates canonical Torus PointIds for selected moves', () => {
    expect(() => parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      action: { type: 'place', pointId: 'front:0:0' },
    }, torusMoveRequest)).toThrow(/PointId/i);
  });

  it('rejects selected move identity and numbering mismatches as protocol errors', () => {
    for (const response of [
      { ...selectedMoveBase, requestId: 'wrong-request' },
      { ...selectedMoveBase, checkpointId: 'wrong-checkpoint' },
      { ...selectedMoveBase, moveNumber: 2 },
    ]) {
      try {
        parseAlphaZeroSelectedMove(response, torusMoveRequest);
        throw new Error('expected protocol validation failure');
      } catch (error) {
        expect(error).toMatchObject({ kind: 'protocol' });
      }
    }
  });

  it('rejects invalid selected move color and action', () => {
    expect(() => parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      color: 'green',
    }, torusMoveRequest)).toThrow(/color/i);
    expect(() => parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      action: { type: 'resign' },
    }, torusMoveRequest)).toThrow(/action\.type/i);
  });

  it('rejects selected move simulation mismatches and empty implementation id', () => {
    expect(() => parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      mctsSims: 64,
    }, torusMoveRequest)).toThrow(/mctsSims/i);
    expect(() => parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      search: { ...selectedMoveBase.search, simulations: 64 },
    }, torusMoveRequest)).toThrow(/search\.simulations/i);
    expect(() => parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      search: { ...selectedMoveBase.search, implementationId: '' },
    }, torusMoveRequest)).toThrow(/implementationId/i);
  });

  it('uses history length to validate selected move numbering', () => {
    const request: AlphaZeroSelectMoveRequest = {
      ...torusMoveRequest,
      position: {
        ...torusMoveRequest.position,
        moves: [{ moveNumber: 1, color: 'black', action: { type: 'pass' } }],
      },
    };
    expect(parseAlphaZeroSelectedMove({
      ...selectedMoveBase,
      moveNumber: 2,
      color: 'white',
      action: { type: 'pass' },
    }, request).moveNumber).toBe(2);
  });
});
