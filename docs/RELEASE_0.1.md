# GoCube 0.1 release acceptance

> **Historical snapshot of the tagged `v0.1.0` release — not a source of current requirements.**
>
> The acceptance record below is preserved from the `v0.1.0` tag. Later product or architecture changes must not be backported into this file merely to keep it aligned with current behavior. Edit the historical body only if the record of `v0.1.0` itself is factually wrong.
>
> For current project truth, use `docs/GAME_CUBE_GO.md`, `docs/ROADMAP.md`, and `docs/ARCHITECTURE.md`.

This checklist is the final gate for the immutable `0.1.0` release. It supplements `README.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`; it does not redefine game rules.

## Automated gate

The exact release commit must pass the repository CI without skipped release steps:

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e`

The release commit must use a committed dependency lockfile so the CI install is reproducible. Do not tag `0.1.0` while direct dependencies are floating on `latest` without a lockfile.

## Core game acceptance

- 9×9, 13×13, and 19×19 Torus games start correctly.
- Every logical point has four toroidal neighbors, including all left/right and top/bottom seams.
- Placement, groups, liberties, captures, suicide rejection, simple ko, turn switching, Pass, Undo, and Redo preserve exact rule-relevant state.
- Captures and legality work across torus seams.
- A normal move after one Pass resets the consecutive-pass sequence.
- Two consecutive Pass actions enter manual endgame classification.
- Undo of the finishing Pass restores play; Redo restores the endgame/finished state when applicable.

## Scoring and endgame

- Chinese and Japanese rules both complete a full game.
- Komi is preserved and applied to the selected scoring strategy.
- Manual alive/dead/seki classification is authoritative for 0.1.
- Chinese area scoring does not add captures a second time.
- Japanese territory scoring includes prisoners correctly.
- Final territory and dead-stone annotations remain visible after closing the result dialog and disappear after Undo of game completion.

## Persistence

- A new game is saved immediately with size, rules, and komi.
- Moves, Pass, Undo/Redo current state, captures, repetition-relevant history, and endgame/result state are persisted as required for exact continuation.
- Reload of an unfinished game offers Continue and restores the same rule-relevant state.
- A corrupted local save is discarded without blocking startup.

## UI / presentation smoke gate

Test at the minimum desktop target equivalent to 1920×1080 at 150% browser scaling (1280×720 CSS viewport):

- compact left service panel and board remain fully usable;
- no game title/status header is shown above the board during play;
- board-size selector exposes 9×9 / 13×13 / 19×19;
- Pass, Redo, Undo, and New game controls remain readable and correctly enabled/disabled;
- Pass state is represented by `Pass (1)` rather than a visible `Passes` statistics cell;
- hover preview, forbidden-move marker, last-move marker, move numbers, limited zoom, and four-direction pan behave correctly;
- optional duplicate regions show only the current one-line wrapped border treatment and remain non-interactive;
- pan, stone placement, and capture animations do not change domain state;
- final result dialog remains legible in the dark application theme.

## Release hygiene

Before tagging:

1. Remove obsolete production-only test hooks that no longer represent UI requirements.
2. Keep broad renderer refactors and optional cleanup out of the release candidate unless needed to fix a confirmed defect.
3. Commit the dependency lockfile and use it in CI.
4. Run the complete automated gate on the exact candidate commit.
5. Perform one manual full-game smoke test in Chinese rules and one in Japanese rules.
6. Only then create the immutable `0.1.0` tag and close the completed 0.1 milestone issues.
