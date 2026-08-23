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
  2 liberties → exhaustive defender-first proof baseline, performance-gated
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

Статус: **IMPLEMENTED / VALIDATION IN PROGRESS / NOT CLASSIFIER-INTEGRATED**.

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

Reader пока **не подключён к `AssistedEndgameClassifier`**. До performance gate его `proven-dead` остаётся proof result для validation/benchmark, а не production automatic classification.

---

# 12. E2-3 performance gate

До classifier integration нужно измерить exhaustive defender enumeration минимум на:

```text
Torus 9×9
Torus 13×13
Torus 19×19

Cube 2×2
Cube 4×4
Cube 5×5
Cube 7×7
```

Отдельно нужны pathological positions с большим количеством empty points.

Для каждого case собирать:

```text
examined defender moves
legal defender moves
explored nodes
max depth
median runtime
p95 runtime
max runtime
budget exhaustion count
```

После benchmark возможны только два решения.

### Вариант A — exhaustive cost приемлем

Подключить `two-liberty-exhaustive-reader-v2` к `AssistedEndgameClassifier`, но automatic `dead` принимать только из strict `proven-dead`.

### Вариант B — exhaustive cost слишком высок

Оставить exhaustive reader как correctness oracle и разработать safe relevance pruning.

Pruning разрешается только если существует proof, что исключённый defender move не может изменить tactical result.

```text
не доказана irrelevance excluded move
→ pruning запрещён
```

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
- `two-liberty-exhaustive-reader-v2` implemented;
- two-lib reader пока NOT classifier-integrated;
- exhaustive defender set = all empty logical points + Pass;
- default defender placement budget = 512.

E2-3 hardening добавляет:

- explicit Torus seam two-lib integration case;
- explicit Cube edge two-lib integration case;
- deterministic repeatability check;
- adversarial root-ko defender branch, запрещающую false `dead`;
- сохранение existing non-liberty preparation/counter-capture counterexample;
- Engine-2-scoped static typecheck.

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
build
E2E
```

Если общий `build` продолжит останавливаться на не-Engine UI blocker, это фиксируется отдельно как repository-infrastructure constraint; Engine2 correctness code не должен обходить типизацию собственных модулей.

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

Ближайший checkpoint после E2-3 hardening:

```text
E2-3c — performance gate exhaustive defender enumeration
```

Порядок:

```text
E2-3a  Синхронизировать документ с two-liberty-exhaustive-reader-v2
E2-3b  Закрыть adversarial / topology / ko / determinism validation
E2-3c  Benchmark exhaustive defender enumeration
E2-3d  Либо classifier integration, либо safe relevance pruning

E2-4   Generic deterministic AND/OR Proof Search
E2-5   3 liberties
E2-6   4 liberties
E2-7   Exact small eye-space analysis
E2-8   Connections / snapback / ladder / net / sacrifice
E2-9   Semeai / seki proof
E2-10  Transpositions + performance optimization
E2-11  Adversarial corpus + final evaluation
```

Главное правило остаётся неизменным:

> Engine 2 имеет право автоматически поставить `alive`, `dead` или `seki` только там, где он способен показать законченное доказательство. Во всех остальных случаях правильный результат — `UNRESOLVED`.
