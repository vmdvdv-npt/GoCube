import { describe, expect, it } from 'vitest';
import {
  parseAlphaZeroCheckpointList,
  parseAlphaZeroGeneratedGame,
  parseAlphaZeroHealth,
} from './AlphaZeroProtocol';

const checkpoint = {
  id: 'cube4-run-12',
  runName: 'cube4-run',
  iteration: 12,
  topology: 'cube',
  size: 4,
  ruleSet: 'chinese',
  komi: 7.5,
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

describe('AlphaZero protocol V1', () => {
  it('accepts valid health data', () => {
    expect(parseAlphaZeroHealth({ protocolVersion: 1, service: 'gocube-alphazero', version: '0.1' })).toEqual({
      protocolVersion: 1,
      service: 'gocube-alphazero',
      version: '0.1',
    });
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

  it('accepts a generated game with canonical Cube PointIds', () => {
    expect(parseAlphaZeroGeneratedGame({
      ...generatedGameBase,
      moves: [
        { moveNumber: 1, color: 'black', action: { type: 'place', pointId: 'front:0:0' }, captured: [] },
        { moveNumber: 2, color: 'white', action: { type: 'pass' } },
      ],
    }).moves).toHaveLength(2);
  });

  it('parses terminal result diagnostics when present', () => {
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
});
