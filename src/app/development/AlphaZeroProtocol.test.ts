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
      protocolVersion: 1,
      topology: 'cube',
      size: 4,
      ruleSet: 'chinese',
      komi: 7.5,
      blackCheckpoint: checkpoint.id,
      whiteCheckpoint: checkpoint.id,
      mctsSimulations: 100,
      moves: [
        { moveNumber: 1, color: 'black', action: { type: 'place', pointId: 'front:0:0' }, captured: [] },
        { moveNumber: 2, color: 'white', action: { type: 'pass' } },
      ],
    }).moves).toHaveLength(2);
  });

  it('rejects malformed moves, invalid PointIds, and skipped numbering', () => {
    const base = {
      protocolVersion: 1,
      topology: 'cube',
      size: 4,
      ruleSet: 'chinese',
      komi: 7.5,
      blackCheckpoint: checkpoint.id,
      whiteCheckpoint: checkpoint.id,
      mctsSimulations: 100,
    } as const;

    expect(() => parseAlphaZeroGeneratedGame({
      ...base,
      moves: [{ moveNumber: 1, color: 'black', action: { type: 'place', pointId: 'not-a-point' } }],
    })).toThrow(/PointId/i);
    expect(() => parseAlphaZeroGeneratedGame({
      ...base,
      moves: [{ moveNumber: 2, color: 'black', action: { type: 'pass' } }],
    })).toThrow(/moveNumber/i);
    expect(() => parseAlphaZeroGeneratedGame({
      ...base,
      moves: [{ moveNumber: 1, color: 'green', action: { type: 'pass' } }],
    })).toThrow(/color/i);
  });
});
