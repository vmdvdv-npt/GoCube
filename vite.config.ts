import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
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
});
