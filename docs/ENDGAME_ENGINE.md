# Endgame Engine — engine2 working plan

## Статус

`docs/ENDGAME_ENGINE.md` — единственный рабочий документ активной разработки Endgame Engine в линии `engine2`.

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

Для automatic `alive / dead / seki` приоритеты:

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
  1 liberty → strict proof, classifier-integrated
  2 liberties → exhaustive correctness oracle + proof-safe pruned experimental path
  3–4 liberties → Generic Proof Search next
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

Разные readers могут выдавать разные доказанные facts; не требуется один mutable mega-object.

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

Benson/pass-alive остаётся первым conservative automatic proof:

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

то без known `previousBoard` результат:

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

Classifier использует только strict `proven-dead`; `critical / ko-dependent / unresolved` не превращаются в automatic status.

---

# 11. E2-3 — Two-liberty exhaustive reader v2

Статус: **IMPLEMENTED / HARDENED / BENCHMARKED / NOT CLASSIFIER-INTEGRATED**.

Algorithm:

```text
two-liberty-exhaustive-reader-v2
```

## Attacker-first

Для каждой из двух текущих liberties attacker:

1. делает legal move через `GameEngine`;
2. root ko-shaped capture без `previousBoard` → `ko-dependent`;
3. rebuild Graph Core;
4. если target captured → kill;
5. если target свёлся ровно к одной liberty → вызывает strict one-liberty reader с известным `previousBoard`;
6. attack move считается winning только если дальнейший one-liberty branch полностью доказан.

Для attacker OR-node специализированный неполный список атакующих moves допустим: найденный winning move даёт existence proof, а пропущенный winning move только уменьшает coverage.

## Defender-first completeness baseline

Defender-first **не предполагает locality** и перечисляет:

```text
all empty logical points from Topology.points()
+
Pass
```

Каждый placement проверяется authoritative `GameEngine`.

После каждого legal defender move:

- target with 1 liberty → strict one-liberty attacker-first kill check;
- target with 2 liberties → two-lib attacker-first reduction check;
- target with 3+ liberties → branch not proven losing;
- root ko-shaped defense without `previousBoard` → `KO_DEPENDENT`.

Default deterministic placement budget:

```text
512
```

Budget exhaustion → `UNRESOLVED`; никогда не dead.

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

Reader сохраняется как correctness oracle / regression baseline.

---

# 12. E2-3c — exhaustive performance gate

Статус: **COMPLETED — VARIANT B SELECTED**.

Benchmark harness:

```text
src/core/endgame/TwoLibertyTacticalReader.benchmark.test.ts
npm run benchmark:engine2:two-lib
```

Runner: GitHub Actions Ubuntu 24.04 / Node 22.23.2. Для каждого case: 2 warm-ups + 20 measured runs.

Workloads:

- `dense-local` — только две target liberties пусты;
- `sparse-max-empty` — target имеет две liberties, почти вся остальная topology пуста.

| Case | Workload | Empty | Examined / legal | Nodes | Depth | Median ms | p95 ms | Max ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Torus 9×9 | dense-local | 2 | 2 / 2 | 18 | 3 | 3.609 | 10.410 | 10.652 |
| Torus 9×9 | sparse-max-empty | 78 | 78 / 78 | 546 | 3 | 93.856 | 95.461 | 100.264 |
| Torus 13×13 | dense-local | 2 | 2 / 2 | 18 | 3 | 7.880 | 8.102 | 8.154 |
| Torus 13×13 | sparse-max-empty | 166 | 166 / 166 | 1162 | 3 | 458.336 | 464.715 | 502.325 |
| Torus 19×19 | dense-local | 2 | 2 / 2 | 18 | 3 | 18.196 | 18.498 | 18.501 |
| Torus 19×19 | sparse-max-empty | 358 | 358 / 358 | 2506 | 3 | 2257.245 | 2269.888 | 2276.010 |
| Cube 2×2 | dense-local | 2 | 2 / 2 | 18 | 3 | 2.311 | 4.098 | 4.637 |
| Cube 2×2 | sparse-max-empty | 21 | 21 / 21 | 147 | 3 | 13.722 | 14.678 | 16.365 |
| Cube 4×4 | dense-local | 2 | 2 / 2 | 18 | 3 | 6.974 | 7.589 | 7.716 |
| Cube 4×4 | sparse-max-empty | 93 | 93 / 93 | 651 | 3 | 249.166 | 250.677 | 250.747 |
| Cube 5×5 | dense-local | 2 | 2 / 2 | 18 | 3 | 10.693 | 11.057 | 11.522 |
| Cube 5×5 | sparse-max-empty | 147 | 147 / 147 | 1029 | 3 | 648.778 | 651.653 | 652.027 |
| Cube 7×7 | dense-local | 2 | 2 / 2 | 18 | 3 | 21.458 | 21.827 | 22.994 |
| Cube 7×7 | sparse-max-empty | 291 | 291 / 291 | 2037 | 3 | 2470.457 | 2486.760 | 2490.738 |

Decision: **Variant B**. Pathological p95 около 2.27–2.49 s на одну group неприемлем для production classifier. Поэтому exhaustive v2 остаётся oracle.

---

# 13. E2-3d — proof-safe relevance pruning

Статус: **IMPLEMENTED / ADVERSARIALLY VALIDATED / BENCHMARKED / NOT CLASSIFIER-INTEGRATED**.

Experimental algorithm:

```text
two-liberty-proof-pruned-reader-v1
```

Irrelevance certificate:

```text
outside-six-wave-string-closed-causal-cone
```

## 13.1 Proof boundary

Нельзя использовать geometric radius или heuristic locality. Один Go move может влиять на target на два graph edges через capture соседней connected string. Поэтому relevance строится graph-native и закрывается через целые existing strings.

Stage-specific maximum текущего specialised continuation:

```text
root defender move                         <= 2 dependency waves
-> two-lib attacker reduction              <= 1 wave
-> one-lib defender extension/countercap   <= 2 waves
-> final attacker liberty capture          <= 1 wave
------------------------------------------------------------
TOTAL                                      <= 6 graph waves
```

После каждой wave выполняется closure через complete current connected stone strings.

Correctness logic использует только:

```text
Topology.points()
Topology.neighbors(PointId)
EndgameGraph current strings
```

## 13.2 Root move safety

Pruning **не означает**, что root moves вообще не проверяются.

Каждый empty logical point по-прежнему проходит:

```text
GameEngine legality
+
root simple-ko structural guard
```

Только после этого certified-irrelevant root placement может не запускать deep tactical continuation.

Это сохраняет remote ko detection даже вне causal cone.

## 13.3 Pass rule

Certified-irrelevant placement считается losing только если `Pass` уже proven losing. Если Pass не доказан losing, такой branch остаётся `not-proven`.

Следовательно pruning не может сам по себе превратить неопределённый defender AND-node в proof kill.

## 13.4 Budget

Budget относится к **deep-evaluated relevant placements**, а не к числу всех empty root points.

Exceeding budget:

```text
defenderFirst = budget-exhausted
overall = UNRESOLVED
```

## 13.5 Correctness validation

Добавлены adversarial tests:

- non-liberty counter-capture preparation остаётся deep-relevant;
- remote root-ko branch обнаруживается до pruning;
- certified irrelevance применяется только вместе с already-losing Pass;
- long connected strings входят в causal cone целиком;
- deterministic Torus 9×9 + Cube 2×2 fixed-seed differential corpus;
- invariant:

```text
pruned outcome == proven-dead
→ exhaustive oracle outcome == proven-dead
```

Disagreement / incomplete relevance proof / budget exhaustion → conservative fallback, не automatic status.

## 13.6 E2-3d comparative benchmark

Run: GitHub Actions CI #715, Ubuntu 24.04 / Node 22.23.2, 2 warm-ups + 20 samples. Оба readers измерялись в одном run на тех же E2-3c fixtures.

Все root empty points всё равно проходят `GameEngine` scan, поэтому цифры не скрывают legality/ko cost.

### Dense-local

Pruning ничего не исключает (`certified irrelevant = 0`), поэтому ожидаемо добавляет небольшой overhead построения causal cone.

| Case | Exhaustive p95 ms | Pruned p95 ms | Deep | Certified irrelevant | Cone points |
|---|---:|---:|---:|---:|---:|
| Torus 9×9 | 6.732 | 6.733 | 2 | 0 | 81 |
| Torus 13×13 | 8.043 | 8.855 | 2 | 0 | 169 |
| Torus 19×19 | 18.486 | 21.119 | 2 | 0 | 361 |
| Cube 2×2 | 3.598 | 3.774 | 2 | 0 | 24 |
| Cube 4×4 | 6.462 | 7.460 | 2 | 0 | 96 |
| Cube 5×5 | 10.359 | 11.101 | 2 | 0 | 150 |
| Cube 7×7 | 20.652 | 22.637 | 2 | 0 | 294 |

### Sparse-max-empty

| Case | Empty | Exhaustive p95 ms | Pruned p95 ms | Speedup | Deep / legal | Certified irrelevant | Cone points |
|---|---:|---:|---:|---:|---:|---:|---:|
| Torus 9×9 | 78 | 97.567 | 77.099 | 1.27× | 66 / 78 | 12 | 69 |
| Torus 13×13 | 166 | 450.079 | 231.136 | 1.95× | 82 / 166 | 84 | 85 |
| Torus 19×19 | 358 | 2238.434 | 537.927 | 4.16× | 82 / 358 | 276 | 85 |
| Cube 2×2 | 21 | 12.605 | 13.800 | 0.91× | 21 / 21 | 0 | 24 |
| Cube 4×4 | 93 | 229.531 | 148.320 | 1.55× | 58 / 93 | 35 | 61 |
| Cube 5×5 | 147 | 597.810 | 265.183 | 2.25× | 64 / 147 | 83 | 67 |
| Cube 7×7 | 291 | 2317.031 | 548.505 | 4.22× | 67 / 291 | 224 | 70 |

Worst supported sparse cases:

```text
Torus 19×19 p95: 2238.434 ms -> 537.927 ms
Cube 7×7  p95: 2317.031 ms -> 548.505 ms
```

Deep branch reduction there ≈77%.

### E2-3d decision

Proof-safe pruning **существенно улучшает scaling** и проходит acceptance boundary E2-3d, но текущий full reader всё ещё требует ~0.54–0.55 s p95 на одну pathological target group из-за обязательного full root legality/ko scan и remaining deep branches.

Поэтому:

```text
two-liberty-proof-pruned-reader-v1
= validated experimental proof layer
= candidate building block for Generic Proof Search
!= classifier-integrated automatic path yet
```

Не выполнять classifier integration в PR E2-3d. Сначала использовать proof-safe relevance как foundation для E2-4 и затем повторно оценить end-to-end group/classifier cost на более realistic endgame corpus.

---

# 14. E2-4 — Generic deterministic AND/OR Proof Search

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

Search outcomes:

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
- graph-native relevance boundary;
- principal variation;
- node count;
- max depth;
- reason for unresolved;
- conservative ko handling;
- transposition/memoization later, после базового deterministic DFS.

Budget exhaustion всегда `UNRESOLVED`.

---

# 15. Три и четыре liberties

После появления Generic Proof Search добавить поддержку 3 и 4 liberties.

Специализированные readers можно использовать как proof-preserving terminal/reduction layers:

```text
4 liberties
↓ attack
3 liberties
↓ attack
2-lib reader
↓
1-lib reader
```

Уменьшение liberties само по себе не является proof kill. На defender AND-node должна сохраняться полнота защиты либо доказанная relevance boundary.

---

# 16. Eye-space stage

Добавить graph-native exact/safe eye-space analysis:

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
- Torus seam;
- Cube edges.

Для small regions предпочтительна exact enumeration состояния local graph. Нестрогий analysis используется только как move ordering/search reduction/diagnostic fact.

---

# 17. Connection / tactical extensions

Следующие specialised layers:

- forced connection to proven-safe group;
- cut/disconnection;
- counter-capture;
- ladder;
- net;
- snapback;
- short sacrifice;
- deeper preparation moves.

Нужно строго отличать `potential connection` от `proven connection`.

---

# 18. Semeai / seki

Для opposing weak groups через shared liberties нужен отдельный multi-group reader.

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

# 19. Validation / CI state

Текущий Engine2 foundation:

- `EndgameGraphCore` integrated;
- Benson/pass-alive integrated;
- one-liberty strict reader integrated;
- root ko guard conservative;
- `two-liberty-exhaustive-reader-v2` retained as correctness oracle;
- `two-liberty-proof-pruned-reader-v1` implemented and validated, not classifier-integrated;
- proof certificate = `outside-six-wave-string-closed-causal-cone`;
- every root placement still passes authoritative `GameEngine` legality and root-ko scan;
- default exhaustive defender placement budget = 512;
- relevant deep-placement budget remains conservative;
- Torus seam / Cube edge/corner handled only through graph topology.

E2-3d correctness CI on benchmark head:

```text
lint PASS
unit/coverage: 529 passed, 14 benchmark cases skipped in normal suite
typecheck:engine2 PASS
build:engine2 PASS
comparative benchmark: 14/14 PASS
Chromium E2E: 72/72 PASS
```

Scoped static checking:

```text
npm run typecheck:engine2
```

covers:

```text
src/core/endgame
src/core/game
src/core/rules
src/core/topology
```

and imported dependencies without dragging the unrelated UI typecheck blocker into Engine2.

Normal Engine2 work PR gate:

```text
lint
test:coverage
typecheck:engine2
build:engine2
E2E
```

Performance benchmark remains opt-in after metrics are captured; temporary benchmark CI step must be removed before merge.

---

# 20. Benchmark / comparison metrics

Для дальнейшей оценки Engine2 нужны:

- false automatic statuses;
- precision alive/dead/seki;
- known-answer coverage;
- median/p95/max nodes;
- median/p95/max runtime;
- unresolved by budget;
- unresolved by ko/boundary;
- number of root placements scanned;
- number of deep placements retained/pruned;
- causal cone size;
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

# 21. External references policy

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

# 22. Текущий следующий шаг

```text
E2-1   DONE — Graph Core
E2-2   DONE — strict one-liberty reader
E2-3a  DONE — sync two-lib exhaustive v2
E2-3b  DONE — adversarial / topology / ko / determinism validation
E2-3c  DONE — exhaustive benchmark → Variant B
E2-3d  DONE — proof-safe relevance pruning + differential + benchmark

E2-4   NEXT — Generic deterministic AND/OR Proof Search
E2-5   3 liberties
E2-6   4 liberties
E2-7   Exact small eye-space analysis
E2-8   Connections / snapback / ladder / net / sacrifice
E2-9   Semeai / seki proof
E2-10  Transpositions + performance optimization
E2-11  Adversarial corpus + final evaluation
```

E2-4 acceptance boundary:

1. AND/OR semantics explicit: attacker OR, defender AND;
2. every proof node deterministic and budgeted;
3. relevance pruning only through explicit proof-safe certificate;
4. ko/history uncertainty remains `KO_DEPENDENT`/`UNRESOLVED`;
5. existing one-lib/two-lib readers используются как proof-preserving subroutines, не как heuristic labels;
6. no classifier integration until correctness + performance + differential gates are passed on the generic search path.

Главное правило остаётся неизменным:

> Engine 2 имеет право автоматически поставить `alive`, `dead` или `seki` только там, где он способен показать законченное доказательство. Во всех остальных случаях правильный результат — `UNRESOLVED`.
