# GoCube

Implementation repository for **Game Cube Go**.

## Canonical documentation

Current project truth lives in three repository documents:

- `docs/ARCHITECTURE.md` — architecture, contracts, and module boundaries.
- `docs/ROADMAP.md` — version scope, sequencing, and `introducedIn`.
- `docs/GAME_CUBE_GO.md` — detailed product behavior and requirements.

Do not use this README, release records, issues, PR descriptions, old tasks, or chat excerpts as substitutes for those documents.

## Development

```bash
npm ci
npm run dev
```

Validation:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

## Repository documentation

- `AGENTS.md` — short workflow and documentation rules for coding agents.
- `docs/RELEASE_0.1.md`, `docs/RELEASE_0.2.md` — historical release/checkpoint records. They are not current product specifications.

Do not create additional Markdown summaries or mirrors of the three canonical documents unless explicitly requested.
