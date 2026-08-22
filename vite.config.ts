import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const currentPullRequestLabel = (): string => {
  const githubPullRequest = process.env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\/merge$/)?.[1];
  if (githubPullRequest) return `#${githubPullRequest}`;

  try {
    const latestMergeMessage = execSync('git log --merges -1 --pretty=%B', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const latestMergedPullRequest = latestMergeMessage.match(/Merge pull request #(\d+)/)?.[1];
    if (latestMergedPullRequest) return `#${latestMergedPullRequest}`;
  } catch {
    // Fall through to a neutral label when git metadata is unavailable.
  }

  return '#—';
};

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_PR__: JSON.stringify(currentPullRequestLabel()),
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 50,
        lines: 60,
      },
    },
  },
});
