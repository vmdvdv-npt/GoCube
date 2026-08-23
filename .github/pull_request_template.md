## What changed


## Why


## CI mode

Choose via PR title:

- `[no-test]` — no automated test suite for this PR
- no marker — standard CI: lint, typecheck, unit/integration coverage, build, Chromium E2E
- `[full]` — full CI: standard checks plus Chromium, Firefox, and WebKit E2E; use only when the user explicitly requests Full CI for this PR

Do not select `[full]` because a PR seems complex, risky, large, architectural, or renderer-related. Release finalization always runs full CI automatically regardless of PR title.

## Verification

- [ ] TypeScript/build passes, or `N/A` for `[no-test]`
- [ ] Unit tests pass, or `N/A` for `[no-test]`
- [ ] Relevant manual/e2e check completed, or `N/A` for `[no-test]`

## Documentation check

Complete all three checks. If a category is not affected, mark it as `N/A` in the PR description rather than leaving it implicit.

- [ ] Product behavior, UI/UX, controls, rules, visuals, or animations changed → `docs/GAME_CUBE_GO.md` updated, or `N/A`
- [ ] Version scope, sequencing, milestones/checkpoints, or `introducedIn` changed → `docs/ROADMAP.md` updated, or `N/A`
- [ ] Architecture, contracts, module responsibilities, state boundaries, persistence/testing architecture, or technical principles changed → `docs/ARCHITECTURE.md` updated, or `N/A`

## Architecture check

- [ ] Core remains independent from React/renderers/storage
- [ ] Topology-specific behavior stays behind `Topology`
- [ ] No undocumented product requirement was changed
