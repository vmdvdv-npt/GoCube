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
- `docs/RELEASE_0.1.md` — historical record of the actually tagged 0.1 release. It is not a current product specification.

A `docs/RELEASE_0.x.md` record is created only after that release is actually completed/tagged. Do not create release records in advance for unreleased versions.

Do not create any new Markdown file anywhere in the repository without explicit user approval for that specific file.
