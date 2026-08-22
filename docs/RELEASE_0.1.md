# GoCube 0.1 release acceptance

> **Historical release/checkpoint record — not a source of current requirements.**
>
> For current project truth, read:
> - Architecture: `docs/ARCHITECTURE.md`
> - Roadmap / version scope: `docs/ROADMAP.md`
> - Detailed product behavior: `docs/GAME_CUBE_GO.md`
>
> This file records what was accepted/tested for the 0.1 checkpoint. It may intentionally preserve requirements or implementation expectations that were valid at that time and were changed later. Never use it to override or reconstruct current product requirements. Do not rewrite historical entries merely to mirror a later product change; edit them only to correct the historical record itself.

This checklist records the release gate for 0.1. It supplements implementation validation but does not define or redefine game rules, architecture, or future version scope.

## Automated gate

The exact release commit must pass the repository CI without skipped release steps:

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:e2e`

The release commit must use a committed dependency lockfile so CI installation is reproducible.

## Core game acceptance

- 9×9, 13×13, and 19×19 Torus games start correctly.
- Every logical point has four distinct toroidal neighbors, including all left/right and top/bottom seams.
- Placement, groups, liberties, captures, suicide rejection, repetition/ko handling, turn switching, Pass, Undo, and Redo preserve exact rule-relevant state.
- Captures and legality work across Torus seams.
- A normal move after one Pass resets the consecutive-pass sequence.
- Two consecutive Pass actions enter endgame review/manual classification rather than jumping directly past required classification.
- Undo of the finishing Pass restores play; Redo restores the corresponding endgame/finished state while redo future remains valid.

## Scoring and endgame

- Chinese and Japanese rules both complete a full game.
- Japanese rules are the default new-game selection under the current live 0.1 requirements; Chinese remains available.
- Default komi is 7.5 and the selected komi is preserved/applied to the selected scoring strategy.
- Manual alive/dead/seki classification is authoritative for 0.1.
- Chinese area scoring does not add captures a second time.
- Japanese territory scoring includes prisoners/dead-stone treatment according to the live requirements.
- Final territory and dead-stone annotations remain visible after closing the result dialog and disappear after Undo of game completion.

## Persistence

- A new game is saved with its rule-relevant starting configuration.
- Moves, Pass, Undo/Redo current state, captures, repetition-relevant state/history, and endgame/result state are persisted as required for exact continuation.
- Reload of an unfinished game restores the same rule-relevant state through the defined Continue/startup flow.
- Corrupted/unsupported local persistence fails safely rather than making browser storage part of domain correctness.
- Persistence is accessed through the application storage/repository boundary; `GameEngine` does not read browser storage directly.

## UI / presentation smoke gate

Test at the minimum desktop target equivalent to 1920×1080 at 150% browser scaling (1280×720 CSS viewport), following the current live UI requirements:

- the compact left service panel and board remain fully usable;
- gameplay uses the shared main control panel architecture rather than a renderer-owned Torus-specific panel;
- no unrelated game title/version/status header is shown above the active board during play;
- board-size selector exposes 9×9 / 13×13 / 19×19;
- Pass, Undo, Redo, and New Game remain readable and correctly enabled/disabled, with the current live shared button/panel behavior;
- Pass state is represented by `Pass (1)` rather than a separate visible `Passes` statistics row;
- the ordinary system mouse cursor remains visible;
- valid hover shows the current full stone preview at about 50% opacity and is anchored to the logical intersection;
- forbidden-move marker, last-move marker, and move numbers follow the current live visual semantics;
- zoom and pan operate without changing domain state;
- optional duplicate regions show exactly one wrapped non-interactive row/column at each relevant edge, not the obsolete multi-row duplicate treatment;
- arrow navigation visibly shifts the Torus presentation cyclically while leaving `GameState`, canonical PointIds, and topology unchanged;
- capture and placement animations are presentation effects only;
- final result dialog remains legible in the dark application theme.

## Architecture / test hygiene

- UI sends semantic commands through `GameSession`; it does not change `GameState` directly.
- `GameState` and `ViewState` remain separate.
- `GameEngine` depends on logical contracts, not Renderer/DOM/localStorage.
- Chinese/Japanese scoring remain separate strategies from endgame classification.
- Topology Contract, fixtures, headless tests, and property-based/fuzz checks are part of the release confidence, not renderer-only tests.
- Developer/debug diagnostics may expose PointIds/neighbors/groups/etc. but do not define production game logic.

## Release hygiene

Before tagging this historical 0.1 checkpoint:

1. Use `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and `docs/GAME_CUBE_GO.md` for any current requirement or architecture decision.
2. Treat differences between this file and the canonical documents as historical differences unless the historical record itself is wrong.
3. Keep unrelated renderer refactors and optional cleanup out of the candidate unless needed to fix a confirmed defect.
4. Run the complete automated gate on the exact candidate commit.
5. Perform manual full-game smoke coverage for both Chinese and Japanese rules.
6. Only then create/finalize the corresponding 0.1 release/tag state.
