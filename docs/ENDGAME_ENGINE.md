# Endgame Engine — engine2 working plan

## Статус

`docs/ENDGAME_ENGINE.md` — единственный рабочий документ активной разработки Endgame Engine в ветке `engine2`.

`engine2` создана **от `main`**, независимо от ветки `engine`. Цель — построить второй вариант движка и позднее сравнить оба подхода на одном independent corpus и одинаковых метриках.

Направление `engine2`: небольшой собственный **graph-native GNU-Go-inspired endgame reader**, а не адаптация внешнего tsumego solver как production foundation.

GNU Go используется только как источник общедоступных алгоритмических идей и decomposition. GPL-код GNU Go в production не копируется и не переносится.

---

# 1. Главный invariant: proof, а не guess

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

Для automatic `alive / dead / seki` сначала требуется precision, затем coverage, затем cost.

---

# 2. Только graph topology

Correctness-зависимый Engine работает только через:

```text
Topology.points()
Topology.neighbors(PointId)
```

Life/death logic не использует renderer coordinates, rectangular edge/corner flags или face geometry.

Следствия:

- Torus seam — обычное graph adjacency;
- Cube edge — обычное graph adjacency;
- string через несколько faces остаётся одной connected component;
- empty/eye region может переходить через seam/edge без special cases.

---

# 3. Текущий pipeline engine2

```text
Position
  ↓
Graph Core
  ↓
strings / liberties / empty regions / relations
  ↓
Benson / pass-alive
  ↓
Specialized Tactical Reading
  1 liberty → strict proof
  2 liberties → reduction facts, currently conservative
  3–4 liberties → later
  ↓
Eye-space min/max + vital points
  ↓
Connection / ladder / net / snapback / sacrifice
  ↓
Semeai / shared-liberty reading
  ↓
Bounded deeper AND/OR search
  ↓
PROVEN_ALIVE / PROVEN_DEAD / PROVEN_SEKI / CRITICAL / KO_DEPENDENT / UNRESOLVED
```

Engine intentionally does not attempt to become a full Go AI. Input is an almost-finished position, and the task is local fate/proof of groups.

---

# 4. GNU-Go-inspired decomposition без GNU Go code

Используются идеи разделения задачи на небольшие independently written layers:

- connected string как базовая tactical unit;
- liberties и соседние strings;
- functional connections;
- tactical attack/defense reading;
- eye-space analysis;
- semeai/shared-liberty analysis;
- deeper search только для оставшихся cases.

Никакой implementation GNU Go не копируется.

---

# 5. Требуемая аналитика группы

Постепенно Engine должен уметь выдавать:

| Fact | Зачем |
|---|---|
| stones / size | identity и структура |
| current liberties | непосредственная свобода |
| short potential liberties | escape potential |
| adjacent enemy strings | capture / counter-capture / semeai |
| nearby friendly strings | connection |
| empty regions | eye-space |
| min/max eyes | proof acceleration |
| attack points | attacker move ordering |
| defense points | defender move ordering |
| forced capture | strict dead evidence |
| forced defense/survival | strict survival evidence |
| shared liberties | semeai/seki |
| ko dependency | conservative stop |
| nodes/depth/PV | observability |

Не обязательно хранить всё в одном mutable object. Разные readers могут выдавать разные доказанные facts.

---

# 6. E2-1 — Endgame Graph Core

Статус: **IMPLEMENTED / INTEGRATED**.

`EndgameGraphCore` строит без классификации:

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
  opposing groupKeys
  liberties

FriendlyConnectionCandidate
  point
  color
  adjacent friendly groupKeys
```

Mappings:

```text
PointId -> StoneString
PointId -> EmptyRegion
```

Сделано:

- deterministic ordering;
- complete-board guard;
- strings/liberties;
- empty regions;
- boundary/vital relations;
- shared liberties;
- direct friendly connection candidates;
- arbitrary graph-edge test;
- Torus/Cube-independent semantics;
- `AssistedEndgameClassifier` использует общий Graph Core вместо собственного parallel extraction.

Benson, current dead proof и current seki proof получают structural facts из этого core.

---

# 7. Proven Alive

Существующий Benson/pass-alive остаётся первым conservative automatic proof:

```text
PROVEN_ALIVE
algorithm = benson-pass-alive-v1
```

Cheap eye count не является competing source of truth.

---

# 8. E2-2 — Strict one-liberty reader

Статус: **IMPLEMENTED / TESTED / CLASSIFIER-INTEGRATED**.

Algorithm:

```text
one-liberty-tactical-reader-v1
```

Для target string с ровно одной liberty полный набор **немедленных** defender-first спасений имеет строгую границу:

1. defender играет в sole liberty — extension и/или connection;
2. defender одним ходом захватывает соседний attacker string, если этот enemy string сам в atari.

Любой другой ход не меняет target и оставляет его немедленно capturable на sole liberty.

### Attacker-first

Attacker пробует sole liberty через authoritative `GameEngine`.

### Defender-first

Каждая legal direct defense проверяется. После неё:

- если target получает 2+ liberties → short proof прекращается как escape;
- если остаётся 1 liberty → attacker reply проверяется через `GameEngine`;
- если все direct defenses illegal/immediately killed → defender-first forced kill доказан.

### Automatic DEAD boundary

`PROVEN_DEAD` разрешён только если одновременно:

```text
attacker-first = definite immediate kill
AND
defender-first = every complete immediate defense loses
```

Если attacker выигрывает первым, но defender первым спасается:

```text
CRITICAL
```

Это **не** seki и **не** dead.

### Connection и counter-capture

E2-2 уже учитывает:

- connection через sole liberty;
- one-move counter-capture соседнего attacker string в atari.

Более глубокие connection/counter-capture sequences относятся к следующим stages.

---

# 9. Ko/history boundary

Ko нельзя превращать в guess.

Для второго ply short line предыдущая board известна, поэтому `GameEngine` получает точный simple-ko context:

```text
previousBoard = board before defender move
```

Для **root first ply** endgame analysis context пока не содержит фактическую preceding board. Поэтому введён conservative guard.

Если first-ply capture имеет structural simple-ko recapture shape:

```text
capture exactly one stone
new played string has one stone
its only liberty = captured point
```

то без known previousBoard результат:

```text
KO_DEPENDENT
```

а не automatic kill/survival.

Nested reader может передать известный `previousBoard`. Тогда structural guess не нужен, и legality проверяется точно через `GameEngine`.

UI-facing conservative interpretation ko-dependent остаётся `unresolved`.

---

# 10. One-liberty observability

Reader уже возвращает:

```text
algorithm
targetGroupKey
crucialStones
attackPoints
defensePoints
attackerFirst
defenderFirst.lines
outcome
exploredNodes
maxDepth
principalVariation
```

Raw outcomes:

```text
proven-dead
critical
ko-dependent
unresolved
```

Classifier использует только `proven-dead`; остальные raw facts не превращаются в automatic status.

---

# 11. E2-3 — Two-liberty reading

Статус: **STARTED / DIAGNOSTIC ONLY**.

Первый безопасный слой реализован как:

```text
two-liberty-reduction-reader-v1
```

Он пока доказывает только attacker-first raw fact.

Для каждой из двух текущих liberties attacker:

1. делает legal move через `GameEngine`;
2. root ko-shaped capture без previousBoard → `ko-dependent`;
3. rebuild Graph Core;
4. если target свёлся ровно к одной liberty — вызывает strict one-liberty reader;
5. nested one-liberty reader получает known `previousBoard = original board`, поэтому simple-ko legality там точная.

Если хотя бы один attack move сводит position к полностью доказанному one-liberty forced kill:

```text
attackerFirst = forced-kill
```

Но это **не даёт automatic DEAD**.

Текущая обязательная граница:

```text
defenderFirst = unresolved
reason = complete-defender-move-set-not-proven

overall outcome = unresolved
```

Two-liberty reader пока не подключён к classifier.

Причина: для исходной 2-liberty позиции нельзя без proof completeness считать, что defender обязан играть только в одну из двух liberties. Возможны counter-captures, connections и preparation moves, которые меняют tactical result.

---

# 12. Следующий E2-3 checkpoint — defender-first completeness

До любого automatic dead promotion для 2 liberties нужно формально определить и протестировать полный relevance/candidate boundary defender-first.

Нужно отдельно исследовать минимум:

- play either target liberty;
- connection moves, которые меняют target connectivity/liberties;
- immediate captures of adjacent attacker strings;
- moves creating a counter-capture threat that actually prevents forced kill;
- snapback/sacrifice interactions;
- ko-sensitive moves;
- whether any move outside a provable local interaction set can change the short tactical result.

Правило:

```text
не исследован relevant defender move
→ kill proof запрещён
```

Если complete local defender set нельзя доказать дешёво, 2-lib reader остаётся diagnostic and falls through to later bounded AND/OR search.

Только после этого имеет смысл переносить ту же схему на 3 и 4 liberties.

---

# 13. Eye-space stage

После short tactical layers нужен graph-native eye-space analysis.

Для small closed regions предпочтителен exact enumeration/lookup по local graph shape.

Нужные facts:

```text
minEyes
maxEyes
attackVitalPoints
defenseVitalPoints
```

Working usage:

```text
minEyes >= 2 -> candidate for strict alive proof
maxEyes < 2  -> prioritize kill reading
minEyes = 1, maxEyes = 2 -> read vital points first
```

Eye count становится proof только там, где exact algorithm гарантирует semantics. Иначе это ordering/evidence.

---

# 14. Connection / tactical extensions

Следующие specialised layers должны покрыть:

- forced connection to proven-safe group;
- cut/disconnection;
- ladder;
- net;
- snapback;
- short sacrifice;
- deeper counter-capture.

Forced connection к `PROVEN_ALIVE` structure может стать strict survival proof.

---

# 15. Semeai / seki

Если слабые opposing groups взаимодействуют через shared liberties, нужен multi-group reader.

Relevant facts:

- exclusive liberties;
- shared liberties;
- approach moves;
- captures changing liberties;
- eye state;
- connection options;
- side to move;
- ko dependency.

Простое сравнение liberty counts не является общим proof.

Seki рассматривается после ordinary alive/dead/tactical passes.

```text
failure to prove kill for both sides != seki
```

Сомнительный seki → `UNRESOLVED`.

---

# 16. Bounded deeper search

После specialised readers остающиеся local conflicts могут перейти в generic bounded AND/OR search.

Working progression:

```text
v1 deterministic AND/OR DFS
v2 memo/transposition + stronger move ordering/relevance
v3 df-pn only if benchmarks justify
```

Node budget должен быть deterministic для correctness tests. Wall-clock — только дополнительный production safety limit.

Budget exhaustion:

```text
UNRESOLVED
```

---

# 17. Validation state

На текущем checkpoint `engine2`:

- `EndgameGraphCore` integrated;
- one-liberty strict reader integrated;
- ko-dependent root guard added;
- two-liberty attacker-first reduction added but NOT classifier-integrated;
- hardening suite recognizes new automatic proof algorithm;
- Torus/Cube topology integration coverage present.

Последний Engine-capable CI pass, где coverage был специально запущен перед известным base typecheck blocker:

```text
67 test files passed
516 / 516 tests passed
```

`core/endgame` coverage на этом checkpoint была примерно:

```text
statements 92.85%
lines      94.10%
```

После coverage стандартный repository typecheck останавливается на **pre-existing `main` UI error**, не связанном с Engine:

```text
src/app/Cube2DVisualEffects.tsx
EndgameVisualStatus "unknown" is not assignable to GroupStatus
```

Этот base defect в `engine2` не исправляется, чтобы не загрязнять альтернативную Engine-ветку посторонней UI-правкой.

Временная перестановка CI steps, использованная только чтобы получить Engine coverage до base blocker, после проверки возвращена к исходному `main` workflow.

---

# 18. Сравнение `engine` vs `engine2`

Выбор победителя делается только после сопоставимого practical coverage на одном corpus.

Минимальные метрики:

- false automatic statuses;
- precision alive/dead/seki;
- known-answer coverage;
- median/p95/max nodes;
- median/p95 runtime;
- unresolved by budget;
- unresolved by ko/boundary;
- implementation complexity;
- dependency/license surface;
- maintainability;
- Cube/Torus graph-isomorphism consistency.

Главный gate:

```text
precision first
coverage second
cost third
```

---

# 19. External references policy

## GNU Go

Разрешено использовать:

- architecture/decomposition ideas;
- tactical-reading concepts;
- optics/eye-space concepts;
- connection/semeai concepts;
- external regression/oracle behavior where useful.

Нельзя копировать GPL production code.

## tsumego.js / Darkforest / research solvers

Могут использоваться как benchmark/reference/oracle. `engine2` не строится вокруг их board/search implementation.

## KataGo / AI

Только differential oracle/diagnostics. Не production proof authority.

---

# 20. Текущий следующий шаг

**E2-3 defender-first completeness for 2 liberties.**

Цель следующего work chunk:

1. определить conservative candidate/relevance set defender moves;
2. добавить explicit counterexamples против naïve `only play liberties` assumption;
3. доказать, какие classes moves можно безопасно исключить;
4. если complete set получается — читать каждый defender branch;
5. только после этого разрешать 2-liberty `PROVEN_DEAD`;
6. если complete set не получается — оставить 2-lib diagnostic и перейти к generic local AND/OR framework раньше.

Этот документ обновляется при каждом изменении Engine direction, proof boundary, search semantics, benchmark conclusion или implementation checkpoint.
