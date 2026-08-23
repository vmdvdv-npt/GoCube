# Endgame Engine — engine2 working plan

## Статус

Этот файл является единственным рабочим документом для активной разработки Endgame Engine в ветке `engine2`.

Ветка `engine2` создана **от `main`**, независимо от ветки `engine`, чтобы позже сравнить два подхода на одинаковом corpus и одинаковых метриках.

Цель `engine2` — проверить альтернативный путь: не адаптировать внешний tsumego solver как основу, а построить небольшой собственный graph-native reader, вдохновлённый архитектурой классических Go engines и литературой.

GNU Go используется только как алгоритмический/reference source. GPL-код GNU Go в production не копируется и не переносится.

---

# 1. Главный принцип

Движок должен доказывать результат, а не угадывать его.

```text
heuristic != proof
candidate != proof
failure to find kill != proof of life
failure to find escape != proof of death
```

Если proof не завершён:

```text
UNRESOLVED
```

Это нормальный результат.

Для production automatic status важнее precision, чем coverage.

---

# 2. Только graph topology

Все correctness-зависимые алгоритмы работают только через:

```text
Topology.points()
Topology.neighbors(PointId)
```

Запрещено строить life/death semantics через rectangular geometry, edge/corner flags или renderer coordinates.

Поэтому:

- Torus seam — обычное graph adjacency;
- Cube edge — обычное graph adjacency;
- string через несколько faces остаётся одной connected component;
- empty region и eye space могут проходить через seam/edge без special cases.

---

# 3. Выбранное направление engine2

Рабочая последовательность:

```text
Position
  ↓
Graph Core
  ↓
strings / liberties / empty regions / relations
  ↓
Benson / pass-alive
  ↓
Tactical Reader for 1–4 liberties
  ↓
Eye-space min/max + vital points
  ↓
Connection / counter-capture / ladder / net / snapback
  ↓
Semeai / shared-liberty reading
  ↓
Bounded deeper AND/OR search
  ↓
PROVEN_ALIVE / PROVEN_DEAD / PROVEN_SEKI / CRITICAL / UNRESOLVED
```

Это намеренно не universal monster solver. Исходная задача GoCube проще обычного full-game AI: анализ начинается на почти законченной позиции и должен отвечать о судьбе конкретных групп.

---

# 4. GNU-Go-inspired decomposition без GNU Go code

Используем идеи разделения на маленькие слои:

- connected stone string как базовая tactical unit;
- functional relations между близкими strings;
- отдельный tactical reading;
- отдельный eye-space analysis;
- отдельный connection reading;
- отдельный semeai layer;
- только после этого более глубокий search.

Нельзя копировать implementation GNU Go. Допустимо использовать общедоступные алгоритмические идеи, papers, наблюдаемую decomposition и independently written code.

---

# 5. Аналитика группы

Для каждого string/group постепенно должны быть доступны следующие факты:

| Факт | Назначение |
|---|---|
| размер | базовая структура |
| текущие liberties | непосредственная свобода |
| потенциальные liberties через короткую линию | возможность убежать |
| соседние enemy strings | counter-capture / semeai |
| nearby friendly strings | connection |
| empty regions | eye-space |
| min/max eyes | proof acceleration |
| attack points | move ordering / tactical proof |
| defense points | move ordering / survival proof |
| forced capture | strict dead evidence |
| forced defense | strict survival evidence |
| shared liberties | semeai/seki |
| ko dependency | unresolved boundary |
| explored nodes / depth / budget stop | observability |

Не все поля обязаны существовать в одном mutable object. Это перечень требуемой аналитики, которую могут выдавать разные слои.

---

# 6. Graph Core

Graph Core сам **не определяет alive/dead**.

Он строит topology-neutral facts:

```text
StoneString
  key
  color
  points
  liberties

EmptyRegion
  points
  boundaryGroups
  boundaryColors
  vitalGroups

SharedLiberties
  opposing groups
  points

FriendlyConnectionCandidate
  color
  empty point
  adjacent friendly groups
```

Дополнительно хранится mapping:

```text
PointId -> StoneString
PointId -> EmptyRegion
```

Acceptance:

- deterministic ordering;
- полное покрытие logical board;
- connected components определяются только `Topology.neighbors()`;
- arbitrary graph edge ведёт себя как обычное соседство;
- никакой renderer dependency.

---

# 7. Proven Alive

Существующий Benson/pass-alive слой сохраняется как ранний conservative proof.

Он использует общий Graph Core, а не собственный параллельный extraction groups/regions.

Результат:

```text
PROVEN_ALIVE
proof = BENSON_PASS_ALIVE
```

Cheap eye heuristics не являются competing source of truth.

---

# 8. Tactical Reader

Основная ставка `engine2` — специализированный short reader для групп с малым числом liberties.

Порядок развития:

```text
1 liberty
2 liberties
3 liberties
4 liberties
```

Для каждого класса разрешено иметь отдельное move ordering и specialised pruning, если proof boundary остаётся строгой.

Kill semantics:

```text
attacker node = OR
  достаточно одного winning move

defender node = AND
  все допустимые relevant defenses должны проигрывать
```

Если хотя бы одна legal defense не исследована и её irrelevance не доказана, `PROVEN_DEAD` запрещён.

Crucial stones исходной target structure фиксируются в начале задачи и не теряют identity после defensive extensions.

---

# 9. Оба порядка первого хода

Каждая спорная local position должна уметь проверяться минимум в двух постановках:

```text
attacker first
defender first
```

Интерпретация raw facts:

| attacker first | defender first | raw result |
|---|---|---|
| kill | kill | strongly dead |
| survives | survives | strongly survives |
| kill | survives | CRITICAL / unsettled |
| ko-dependent | any | KO_DEPENDENT |
| unknown | any | UNRESOLVED |

`CRITICAL` нельзя автоматически превращать в seki.

---

# 10. Eye-space

После short tactical facts добавляется graph-native eye-space analysis.

Для небольших closed regions предпочтительно exact enumeration/lookup по local graph shape.

Нужные результаты:

```text
minEyes
maxEyes
attackVitalPoints
defenseVitalPoints
```

Рабочая логика:

```text
minEyes >= 2 -> candidate for strict alive proof
maxEyes < 2  -> high-priority kill reading
minEyes = 1, maxEyes = 2 -> read vital points first
```

Само число глаз должно использоваться как proof только там, где алгоритм действительно гарантирует semantics; иначе это move ordering/evidence.

---

# 11. Connection и counter-capture

Tactical reader не должен считать sole liberty единственным смыслом позиции.

Перед объявлением dead нужно учитывать:

- захват соседней enemy group;
- соединение с friendly string;
- forced connection to a proven-safe group;
- cut/disconnection;
- snapback;
- sacrifice;
- ladder/net escape.

Forced connection к `PROVEN_ALIVE` structure может быть самостоятельным short survival proof.

---

# 12. Semeai и seki

Если две слабые стороны взаимодействуют через shared liberties, запускается отдельный multi-group reader.

Relevant facts:

- exclusive liberties;
- shared liberties;
- approach moves;
- captures changing liberty count;
- eyes;
- connection options;
- side to move;
- ko dependency.

Простое сравнение liberty counts не является общим proof.

Seki рассматривается только после ordinary alive/dead/tactical passes.

Failure to prove a kill обеими сторонами не означает seki.

Сомнительный seki:

```text
UNRESOLVED
```

---

# 13. Ko, history и budget

Ko/repetition нельзя угадывать.

Если local result зависит от внешнего ko или недоступной history semantics:

```text
KO_DEPENDENT -> UI unresolved
```

Search должен иметь deterministic node budget. Для correctness tests node budget предпочтительнее wall-clock.

Budget exhausted:

```text
UNKNOWN_BUDGET / UNRESOLVED
```

---

# 14. Proof observability

Reader должен постепенно перейти к единой диагностике вида:

```text
ProofResult {
  outcome
  algorithm
  target/crucial stones
  exploredNodes
  maxDepth
  principalVariation
  attackPoints
  defensePoints
  proofReason
}
```

Это внутренний working contract, не public API.

---

# 15. Порядок работ engine2

## E2-1 — Graph Core

Статус: **IMPLEMENTED / INTEGRATED**.

Сделано:

- topology-neutral stone strings;
- liberties;
- empty regions;
- boundary/vital relations;
- shared liberties;
- direct friendly connection candidates;
- deterministic point/group ordering;
- partial-board guard;
- graph-edge topology test;
- `AssistedEndgameClassifier` переведён на общий Graph Core для Benson/dead/seki proofs.

Следующий шаг — E2-2.

## E2-2 — Tactical facts + 1-liberty reader

Статус: **NEXT**.

- immediate capture;
- legal atari escape;
- counter-capture;
- connection at sole liberty;
- proof trace.

## E2-3 — Specialized 2/3/4-liberty readers

- deterministic attack move ordering;
- all relevant defenses;
- short forced capture/survival;
- both first-player orders.

## E2-4 — Eye-space

- small closed graph regions;
- min/max eye values;
- attack/defense vital points;
- known two-eye / false-eye / nakade fixtures.

## E2-5 — Tactical extensions

- forced connection;
- cut;
- ladder;
- net;
- snapback;
- short sacrifice.

## E2-6 — Semeai / seki

- shared-liberty races;
- simple approach moves;
- basic strict seki;
- ko remains unresolved.

## E2-7 — Deeper bounded search

- generic AND/OR DFS;
- memo/transposition;
- relevance expansion if needed;
- df-pn only if benchmark data justifies it.

## E2-8 — Comparison against `engine`

Обе ветки сравниваются на одном independent corpus.

Нельзя выбирать победителя по одному screenshot или одному class of positions.

---

# 16. Метрики сравнения engine vs engine2

Минимум:

- false automatic statuses;
- alive/dead/seki precision;
- coverage по known-answer corpus;
- nodes median/p95/max;
- runtime median/p95;
- unresolved by budget;
- unresolved by ko/boundary;
- implementation complexity;
- dependency/license surface;
- maintainability;
- Cube/Torus graph-isomorphism consistency.

Главный gate:

```text
precision first, then coverage, then cost
```

---

# 17. External references policy

### GNU Go

Можно использовать:

- architecture ideas;
- tactical-reading decomposition;
- optics/eye-space concepts;
- connection/semeai concepts;
- regression/oracle behavior where useful.

Нельзя копировать GPL production code.

### Other solvers

`tsumego.js`, Darkforest, research solvers и другие implementations могут использоваться как benchmark/reference/oracle, но `engine2` не строится вокруг их board/search implementation.

### KataGo / AI

Только differential oracle/diagnostics. Не production proof authority.

---

# 18. Текущий прогресс

На текущем состоянии `engine2`:

- branch создана от актуального `main`;
- старый `engine` не является источником изменений `engine2`;
- выбран независимый GNU-Go-inspired graph-native path;
- standalone Graph Core реализован;
- существующие Benson/dead/seki proofs используют новый Graph Core;
- следующий implementation target — tactical facts и strict 1-liberty reader;
- сравнение с `engine` выполняется только после появления сопоставимого practical coverage.

Этот документ должен обновляться при каждом изменении направления, search semantics, benchmark conclusion или существенном Engine-specific решении.
