# Endgame Engine — engine2 working plan

## Статус

`docs/ENDGAME_ENGINE.md` — единственный рабочий документ активной разработки Endgame Engine в ветке `engine2`.

`engine2` — независимая экспериментальная линия. Рабочие изменения выполняются только через ветки `engine2-*` с PR обратно в `engine2`. Код, commits и решения из `engine` не переносятся в эту линию.

Направление `engine2`: собственный **graph-native proof-oriented endgame reader** для Torus/Cube. GNU Go и другие solvers могут использоваться только как внешние источники общедоступных идей, benchmark/reference/oracle; production implementation пишется независимо.

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

Для automatic `alive / dead / seki` приоритеты неизменны:

```text
1. correctness / precision
2. coverage
3. performance
```

Ложный automatic status хуже, чем `UNRESOLVED`.

---

# 2. Только graph topology

Correctness-зависимый Engine работает только через:

```text
Topology.points()
Topology.neighbors(PointId)
```

Life/death logic не использует renderer coordinates, rectangular edge/corner flags, SVG geometry, face numbers или визуальное положение Cube faces.

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
  2 liberties → exhaustive correctness oracle; safe relevance pruning next
  3–4 liberties → later Generic Proof Search
  ↓
Exact small eye-space analysis
  ↓
Connection / ladder / net / snapback / sacrifice
  ↓
Semeai / shared-liberty / seki proof
  ↓
Generic bounded AND/OR Proof Search
  ↓
PROVEN_ALIVE / PROVEN_DEAD / PROVEN_SEKI / KO_DEPENDENT / UNRESOLVED
```

Engine intentionally does not attempt to become a full Go AI. Input is an almost-finished position, and the task is strict group-fate proof.

---

# 4. GNU-Go-inspired decomposition без GNU Go code

Используются независимо реализованные идеи decomposition:

- connected string как tactical unit;
- liberties и соседние strings;
- functional connections;
- tactical attack/defense reading;
- eye-space analysis;
- semeai/shared-liberty analysis;
- deeper search только для оставшихся cases.

GPL production code не копируется.

---

# 5. Требуемая аналитика группы

Постепенно Engine должен уметь выдавать:

| Fact | Зачем |
|---|---|
| stones / size | identity и структура |
| current liberties | непосредственная свобода |
| adjacent friendly/enemy groups | connection / capture / semeai |
| shared liberties | semeai/seki |
| potential/proven connections | strict survival boundary |
| empty regions | eye-space |
| min/max eyes | proof acceleration |
| attack points | attacker move ordering |
| defense points | defender move ordering |
| ko dependency | conservative stop |
| explored nodes / depth / PV | observability |
| unresolved reason | diagnostics / benchmark |

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
- arbitrary graph-edge tests;
- Torus/Cube-independent semantics;
- `AssistedEndgameClassifier` использует общий Graph Core.

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

Для target string с ровно одной liberty полный набор немедленных defender-first спасений имеет строгую границу:

1. defender играет в sole liberty — extension и/или connection;
2. defender одним ходом захватывает соседний attacker string, если тот сам в atari.

Любой другой ход не меняет target и оставляет его немедленно capturable на sole liberty.

### Attacker-first

Attacker пробует sole liberty через authoritative `GameEngine`.

### Defender-first

Каждая legal direct defense проверяется. После неё:

- если target получает 2+ liberties → short proof прекращается как escape;
- если остаётся 1 liberty → attacker reply проверяется через `GameEngine`;
- если все complete immediate defenses illegal/immediately killed → forced kill доказан.

### Automatic DEAD boundary

`PROVEN_DEAD` разрешён только если одновременно:

```text
attacker-first = definite kill
AND
defender-first = every complete immediate defense loses
```

Если attacker выигрывает первым, но defender первым спасается, это не dead и не seki.

---

# 9. Ko/history boundary

Ko нельзя превращать в guess.

Для nested ply, когда предыдущая board известна, `GameEngine` получает точный simple-ko context:

```text
previousBoard = board before current branch move
```

Для root first ply endgame analysis context пока не содержит фактическую preceding board. Поэтому сохраняется conservative guard.

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

Unknown ko legality никогда не заменяется предположением.

---

# 10. One-liberty observability

Reader возвращает:

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

Classifier использует только strict `proven-dead`; остальные raw facts не превращаются в automatic status.

---

# 11. E2-3 — Two-liberty exhaustive reader v2

Статус: **IMPLEMENTED / HARDENED / BENCHMARKED / NOT CLASSIFIER-INTEGRATED**.

Текущий algorithm:

```text
two-liberty-exhaustive-reader-v2
```

Он заменяет старое описание diagnostic-only reduction reader.

## Attacker-first

Для каждой из двух текущих liberties attacker:

1. делает legal move через `GameEngine`;
2. root ko-shaped capture без previousBoard → `ko-dependent`;
3. rebuild Graph Core;
4. если target captured → kill;
5. если target свёлся ровно к одной liberty → вызывает strict one-liberty reader с известным `previousBoard`;
6. attack move считается winning только если дальнейший one-liberty branch полностью доказан.

Для attacker OR-node специализированный неполный список атакующих moves допустим: найденный winning move даёт existence proof, а пропущенный winning move только уменьшает coverage.

## Defender-first completeness baseline

Defender-first **не предполагает locality**.

Текущий correctness baseline перечисляет:

```text
all empty logical points from Topology.points()
+
Pass
```

Каждый placement проверяется authoritative `GameEngine`.

Это закрывает принципиальный counterexample к naïve `only play target liberties`: defender может подготовить connection, counter-capture, ko или иной tactical resource в другой части графа.

После каждого legal defender move:

- target with 1 liberty → strict one-liberty attacker-first kill check;
- target with 2 liberties → two-lib attacker-first reduction check;
- target with 3+ liberties → branch not proven losing;
- root ko-shaped defense without previousBoard → `KO_DEPENDENT`.

`Pass` является отдельной defender branch.

## Budget

Default deterministic placement budget:

```text
512
```

Если число empty logical points превышает budget:

```text
defenderFirst = budget-exhausted
overall = UNRESOLVED
```

Budget exhaustion никогда не превращается в dead.

## Automatic proof boundary внутри reader

Raw `proven-dead` разрешён только когда:

```text
attacker-first has proven kill
AND
every defender-first legal placement + Pass has proven losing continuation
AND
no branch is ko-dependent
AND
budget is not exhausted
```

Reader **не подключён к `AssistedEndgameClassifier`**. E2-3c performance gate выбрал Variant B, поэтому exhaustive implementation сохраняется как correctness oracle для validation/benchmark и не становится production automatic classifier path.

---

# 12. E2-3c performance gate

Статус: **COMPLETED — VARIANT B SELECTED**.

Benchmark выполнялся отдельным opt-in harness `TwoLibertyTacticalReader.benchmark.test.ts` на GitHub Actions Ubuntu 24.04 / Node 22.23.2. Для каждого case: 2 warm-up запуска и 20 измерительных запусков. Проверялись deterministic result/nodes/depth/defender counts и отсутствие false `proven-dead` в stress fixtures.

Workloads:

- `dense-local` — у target ровно две liberties и только они пусты;
- `sparse-max-empty` — у target ровно две liberties, а почти вся остальная topology пуста; это намеренно неблагоприятный case для полного defender-first enumeration.

Все значения runtime ниже — milliseconds на **один** вызов reader для одной target group.

| Case | Workload | Empty | Examined / legal defenses | Nodes | Depth | Median ms | p95 ms | Max ms | Budget exhausted |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Torus 9×9 | dense-local | 2 | 2 / 2 | 18 | 3 | 3.609 | 10.410 | 10.652 | 0 |
| Torus 9×9 | sparse-max-empty | 78 | 78 / 78 | 546 | 3 | 93.856 | 95.461 | 100.264 | 0 |
| Torus 13×13 | dense-local | 2 | 2 / 2 | 18 | 3 | 7.880 | 8.102 | 8.154 | 0 |
| Torus 13×13 | sparse-max-empty | 166 | 166 / 166 | 1162 | 3 | 458.336 | 464.715 | 502.325 | 0 |
| Torus 19×19 | dense-local | 2 | 2 / 2 | 18 | 3 | 18.196 | 18.498 | 18.501 | 0 |
| Torus 19×19 | sparse-max-empty | 358 | 358 / 358 | 2506 | 3 | 2257.245 | 2269.888 | 2276.010 | 0 |
| Cube 2×2 | dense-local | 2 | 2 / 2 | 18 | 3 | 2.311 | 4.098 | 4.637 | 0 |
| Cube 2×2 | sparse-max-empty | 21 | 21 / 21 | 147 | 3 | 13.722 | 14.678 | 16.365 | 0 |
| Cube 4×4 | dense-local | 2 | 2 / 2 | 18 | 3 | 6.974 | 7.589 | 7.716 | 0 |
| Cube 4×4 | sparse-max-empty | 93 | 93 / 93 | 651 | 3 | 249.166 | 250.677 | 250.747 | 0 |
| Cube 5×5 | dense-local | 2 | 2 / 2 | 18 | 3 | 10.693 | 11.057 | 11.522 | 0 |
| Cube 5×5 | sparse-max-empty | 147 | 147 / 147 | 1029 | 3 | 648.778 | 651.653 | 652.027 | 0 |
| Cube 7×7 | dense-local | 2 | 2 / 2 | 18 | 3 | 21.458 | 21.827 | 22.994 | 0 |
| Cube 7×7 | sparse-max-empty | 291 | 291 / 291 | 2037 | 3 | 2470.457 | 2486.760 | 2490.738 | 0 |

Benchmark command:

```text
npm run benchmark:engine2:two-lib
```

Benchmark run itself: 14/14 cases PASS; standard suite on the same work head: 521/521 unit/coverage tests PASS, `typecheck:engine2` PASS, `build:engine2` PASS, Chromium E2E 72/72 PASS.

## Decision

Выбран **Variant B**.

Dense/local cost приемлем, но exhaustive defender-first cost растёт с числом empty logical points и в pathological cases достигает примерно:

```text
Torus 19×19 p95 ≈ 2.270 s / group
Cube 7×7  p95 ≈ 2.487 s / group
```

Classifier может анализировать несколько groups, поэтому multi-second cost на одну target group неприемлем для production integration.

Следствие:

```text
two-liberty-exhaustive-reader-v2
= correctness oracle / regression baseline
!= production classifier path
```

Следующий этап E2-3d — **safe relevance pruning**.

Pruning разрешается только если существует proof, что исключённый defender move не может изменить tactical result.

```text
не доказана irrelevance excluded move
→ pruning запрещён
```

Нельзя выбирать candidate set только по geometric/local distance. Нужна graph-native proof boundary, которая учитывает как минимум direct liberties, connection/cut effects, counter-captures, liberties соседних strings, ko-changing captures и другие one-move state changes, способные повлиять на target branch.

---

# 13. Generic deterministic AND/OR Proof Search

После 1–2 liberties не создавать отдельный вручную написанный reader на каждое число liberties.

Следующий архитектурный слой:

```text
Attacker node = OR
Defender node = AND
```

Attacker:

```text
достаточно найти один proven winning move
```

Defender:

```text
для kill proof необходимо победить все relevant legal defenses
```

Основные search outcomes:

```text
PROVEN_KILL
PROVEN_SURVIVAL
KO_DEPENDENT
BUDGET_EXHAUSTED
UNRESOLVED
```

Search должен иметь:

- deterministic move ordering;
- deterministic node budget;
- principal variation;
- node count;
- max depth;
- reason for unresolved.

Budget exhaustion всегда консервативен. Следующим шагом после базового DFS добавить transposition/memoization.

---

# 14. Три и четыре liberties

После появления Generic Proof Search добавить поддержку 3 и 4 liberties.

Специализированные readers можно использовать как ускорители:

```text
4 liberties
↓ attack
3 liberties
↓ attack
2-lib reader
↓
1-lib reader
```

Но уменьшение liberties само по себе не является proof kill. На каждом defender AND-node должна сохраняться полнота защиты либо доказанная relevance boundary.

---

# 15. Eye-space stage

Добавить graph-native exact/safe eye-space analysis.

Нужные facts:

```text
minEyes
maxEyes
attackVitalPoints
defenseVitalPoints
```

Особое внимание:

- false eyes;
- shared eye space;
- connections;
- regions crossing Torus seam;
- regions crossing Cube edges.

Для small regions предпочтительна exact enumeration состояния local graph.

Если eye-space analysis не является строгим proof, он используется только как move ordering/search reduction/diagnostic fact.

---

# 16. Connection / tactical extensions

Следующие specialised layers должны покрыть:

- forced connection to proven-safe group;
- cut/disconnection;
- counter-capture;
- ladder;
- net;
- snapback;
- short sacrifice;
- deeper preparation moves.

Нужно строго отличать:

```text
potential connection
```

от:

```text
proven connection
```

Только proven connection к `PROVEN_ALIVE` structure может участвовать в strict survival proof.

---

# 17. Semeai / seki

Если слабые opposing groups взаимодействуют через shared liberties, нужен отдельный multi-group reader.

Relevant facts:

- exclusive liberties;
- shared liberties;
- approach moves;
- captures changing liberties;
- eyes;
- connection options;
- side to move;
- ko dependency.

Критическое правило:

```text
failure to prove kill for black
+
failure to prove kill for white
!=
SEKI
```

`SEKI` появляется только после отдельного положительного proof взаимного сосуществования. Ko-dependent или incomplete line → `UNRESOLVED`.

---

# 18. Validation / CI state

Текущий Engine2 foundation:

- `EndgameGraphCore` integrated;
- Benson/pass-alive integrated;
- one-liberty strict reader integrated;
- root ko guard conservative;
- `two-liberty-exhaustive-reader-v2` implemented, hardened and benchmarked;
- two-lib reader NOT classifier-integrated after Variant B decision;
- exhaustive defender set = all empty logical points + Pass;
- default defender placement budget = 512;
- exhaustive reader retained as correctness oracle for E2-3d pruning validation.

E2-3 hardening добавил:

- explicit Torus seam two-lib integration case;
- explicit Cube edge two-lib integration case;
- deterministic repeatability check;
- adversarial root-ko defender branch, запрещающую false `dead`;
- сохранение existing non-liberty preparation/counter-capture counterexample;
- Engine-2-scoped static typecheck.

E2-3c добавил opt-in reproducible benchmark harness для Torus 9/13/19 и Cube 2/4/5/7 с dense и pathological sparse workloads.

Глобальный repository typecheck был удалён из Engine2 CI из-за постороннего UI blocker. Engine2 не должен оставаться без static checking, поэтому используется:

```text
npm run typecheck:engine2
```

с отдельным `tsconfig.engine2.json`, покрывающим:

```text
src/core/endgame
src/core/game
src/core/rules
src/core/topology
```

и их imported dependencies, не затягивая UI layer.

CI Engine2 work PR должен минимум выполнять:

```text
lint
test:coverage
typecheck:engine2
build:engine2
E2E
```

Performance benchmark остаётся opt-in command и не должен выполняться на каждом обычном PR после фиксации E2-3c results.

---

# 19. Benchmark / comparison metrics

Для дальнейшей оценки Engine2 нужны:

- false automatic statuses;
- precision alive/dead/seki;
- known-answer coverage;
- median/p95/max nodes;
- median/p95/max runtime;
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

# 20. External references policy

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

# 21. Текущий следующий шаг

Ближайший checkpoint после E2-3c:

```text
E2-3d — safe relevance pruning для defender AND-node
```

Порядок:

```text
E2-3a  DONE — синхронизировать документ с two-liberty-exhaustive-reader-v2
E2-3b  DONE — adversarial / topology / ko / determinism validation
E2-3c  DONE — benchmark exhaustive defender enumeration → Variant B
E2-3d  NEXT — proof-safe relevance pruning + differential check against exhaustive oracle

E2-4   Generic deterministic AND/OR Proof Search
E2-5   3 liberties
E2-6   4 liberties
E2-7   Exact small eye-space analysis
E2-8   Connections / snapback / ladder / net / sacrifice
E2-9   Semeai / seki proof
E2-10  Transpositions + performance optimization
E2-11  Adversarial corpus + final evaluation
```

E2-3d acceptance boundary:

1. excluded defender move имеет explicit proof of irrelevance, а не heuristic distance;
2. pruned reader никогда не выдаёт `proven-dead`, если exhaustive oracle на том же state не выдаёт `proven-dead`;
3. disagreement или неполнота relevance proof → `UNRESOLVED`/fallback, не automatic status;
4. Torus seam и Cube edge/corner остаются обычными graph cases без renderer geometry;
5. performance повторно измеряется на том же E2-3c corpus до classifier integration.

Главное правило остаётся неизменным:

> Engine 2 имеет право автоматически поставить `alive`, `dead` или `seki` только там, где он способен показать законченное доказательство. Во всех остальных случаях правильный результат — `UNRESOLVED`.