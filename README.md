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
- `docs/RELEASE_0.1.md` — historical snapshot of the tagged `v0.1.0` release. It is not a current product specification.

A `docs/RELEASE_0.x.md` historical record is created only for an actually completed/tagged release, not in advance as a planning or release-candidate document.

Do not create additional Markdown summaries or mirrors of the three canonical documents unless explicitly requested.
