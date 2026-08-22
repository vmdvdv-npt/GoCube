## What changed


## Why


## Verification

- [ ] TypeScript/build passes
- [ ] Unit tests pass
- [ ] Relevant manual/e2e check completed

## Documentation check

Complete all three checks. If a category is not affected, mark it as `N/A` in the PR description rather than leaving it implicit.

- [ ] Product behavior, UI/UX, controls, rules, visuals, or animations changed → `docs/GAME_CUBE_GO.md` updated, or `N/A`
- [ ] Version scope, sequencing, milestones/checkpoints, or `introducedIn` changed → `docs/ROADMAP.md` updated, or `N/A`
- [ ] Architecture, contracts, module responsibilities, state boundaries, persistence/testing architecture, or technical principles changed → `docs/ARCHITECTURE.md` updated, or `N/A`

## Architecture check

- [ ] Core remains independent from React/renderers/storage
- [ ] Topology-specific behavior stays behind `Topology`
- [ ] No undocumented product requirement was changed
