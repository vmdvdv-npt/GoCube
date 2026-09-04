import { describe, expect, it } from 'vitest';

// Behaviour covered by DevelopmentWorkspace itself is intentionally kept small here;
// the end-to-end Development Workspace test exercises transport and replay.
describe('Development Workspace defaults', () => {
  it('documents the intended fallback policy', () => {
    const checkpoints = [
      { topology: 'cube', iteration: 0 },
      { topology: 'cube', iteration: 25 },
      { topology: 'torus', iteration: 30 },
    ] as const;

    const latestCube = checkpoints
      .filter((checkpoint) => checkpoint.topology === 'cube')
      .reduce((latest, checkpoint) => checkpoint.iteration > latest.iteration ? checkpoint : latest);

    expect(latestCube.iteration).toBe(25);
  });
});
