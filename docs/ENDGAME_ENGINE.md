# Endgame Engine — engine2 working plan

## Статус и изоляция

`docs/ENDGAME_ENGINE.md` — единственный рабочий документ активной разработки Endgame Engine в линии `engine2`.

`engine2` — независимая экспериментальная линия. Рабочие изменения выполняются только через ветки `engine2-*` с PR обратно в `engine2`. Код, commits и implementation decisions из `engine`/`main` не переносятся сюда.

Направление Engine 2: собственный **graph-native proof-oriented endgame reader** для Torus/Cube. Внешние Go engines допустимы только как reference/oracle/benchmark; production implementation пишется независимо.

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

Приоритеты automatic `alive / dead / seki`:

```text
1. correctness / precision
2. coverage
3. performance
```

Ложный automatic status хуже, чем `UNRESOLVED`.

---

# 2. Только graph topology

Correctness-зависимая логика использует только logical graph:

```text
Topology.points()
Topology.neighbors(PointId)
```

Не использовать renderer coordinates, rectangular edge/corner flags, SVG geometry, Cube face layout или визуальные расстояния.

Следствия:

- Torus seam — обычное graph adjacency;
- Cube edge — обычное graph adjacency;
- connected string через faces/seams остаётся одной component;
- empty/eye region может переходить через seam/edge без special cases.

---

# 3. Pipeline

```text
Position
  ↓
EndgameGraphCore
  ↓
strings / liberties / empty regions / relations
  ↓
Benson / pass-alive
  ↓
Specialized Tactical Reading
  1 liberty → strict proof, classifier-integrated
  2 liberties → exhaustive oracle + proof-safe pruned experimental path
  ↓
Generic deterministic AND/OR Proof Search
  ↓
3–4 liberty Go adapters
  ↓
Exact small eye-space analysis
  ↓
Connections / ladder / net / snapback / sacrifice
  ↓
Semeai / shared-liberty / seki proof
  ↓
PROVEN_ALIVE / PROVEN_DEAD / PROVEN_SEKI / KO_DEPENDENT / UNRESOLVED
```

Engine не является full Go AI. Вход — почти завершённая позиция; задача — conservative proof судьбы групп.

---

# 4. Decomposition principles

Независимо реализуются общие идеи Go reading:

- connected string как tactical unit;
- liberties и соседние strings;
- functional connections;
- tactical attack/defense reading;
- eye-space analysis;
- semeai/shared-liberty analysis;
- deeper search только для оставшихся cases.

GPL production code не копируется.

---

# 5. Group facts / observability

Нужные факты и diagnostics:

| Fact | Назначение |
|---|---|
| stones / size | identity / structure |
| current liberties | tactical state |
| adjacent friendly/enemy groups | connection / capture / semeai |
| shared liberties | semeai/seki |
| potential/proven connections | survival boundary |
| empty regions | eye-space |
| min/max eyes | proof acceleration |
| attack/defense points | move generation / ordering |
| ko dependency | conservative stop |
| explored nodes / max depth / PV | observability |
| unresolved reason | diagnostics / benchmark |

Разные proof layers могут возвращать разные доказанные facts; один mutable mega-object не требуется.

---

# 6. E2-1 — Endgame Graph Core

Статус: **DONE / INTEGRATED**.

`EndgameGraphCore` строит deterministic graph facts без fate classification:

```text
StoneString
  key / color / points / liberties

EmptyRegion
  points / boundaryGroups / boundaryColors / vitalGroups

SharedLiberties
  opposing groupKeys / liberties

FriendlyConnectionCandidate
  point / color / adjacent friendly groupKeys

PointId -> StoneString
PointId -> EmptyRegion
```

Есть complete-board guard, arbitrary graph-edge tests и Torus/Cube-independent semantics. `AssistedEndgameClassifier` использует общий Graph Core.

---

# 7. Proven Alive

Benson/pass-alive остаётся conservative automatic proof:

```text
PROVEN_ALIVE
algorithm = benson-pass-alive-v1
```

Cheap eye count не является competing authority.

---

# 8. E2-2 — strict one-liberty reader

Статус: **DONE / TESTED / CLASSIFIER-INTEGRATED**.

```text
algorithm = one-liberty-tactical-reader-v1
```

Для target string с одной liberty defender-first complete immediate defense boundary:

1. play sole liberty — extension/connection;
2. capture adjacent attacker string, если он сам в atari.

`PROVEN_DEAD` только когда attacker-first definite kill **и** every complete immediate defender defense loses.

Attacker-first win + defender-first escape не означает dead/seki.

---

# 9. Ko/history boundary

Nested ply с известной board history использует точный `previousBoard` через authoritative `GameEngine`.

Root endgame analysis пока не имеет фактическую preceding board. Поэтому structural simple-ko-shaped capture:

```text
capture exactly one stone
new played string has one stone
only liberty = captured point
```

без known `previousBoard` →

```text
KO_DEPENDENT
```

Unknown ko legality никогда не угадывается.

---

# 10. E2-3 — two-liberty exhaustive reader v2

Статус: **DONE / HARDENED / BENCHMARKED / NOT CLASSIFIER-INTEGRATED**.

```text
algorithm = two-liberty-exhaustive-reader-v2
```

## Attacker-first

Для двух current liberties attacker:

1. legal move через `GameEngine`;
2. unknown-root ko shape → `ko-dependent`;
3. rebuild graph;
4. direct capture → kill;
5. reduction to one liberty → strict one-lib reader with known previous board;
6. winning move принимается только при полном downstream proof.

Attacker OR-node может использовать incomplete candidate set для existence proof: найденный proven kill достаточен; пропущенный kill только уменьшает coverage.

## Defender-first exhaustive oracle

Перечисляет:

```text
all empty Topology.points()
+
Pass
```

Каждый placement проходит authoritative `GameEngine` legality.

После legal defense:

- 1 liberty → strict one-lib attacker-first proof;
- 2 liberties → two-lib attacker-first reduction;
- 3+ liberties → branch not proven losing;
- unknown-root ko-shaped defense → `KO_DEPENDENT`.

Default placement budget:

```text
512
```

Exhaustion → `UNRESOLVED`.

`proven-dead` только когда attacker has proven kill, every legal defense + Pass is proven losing, no ko-dependent branch, budget not exhausted.

Exhaustive v2 сохраняется как correctness oracle.

---

# 11. E2-3c — exhaustive performance gate

Статус: **DONE — VARIANT B**.

Harness:

```text
src/core/endgame/TwoLibertyTacticalReader.benchmark.test.ts
npm run benchmark:engine2:two-lib
```

GitHub Actions Ubuntu 24.04 / Node 22.23.2; 2 warm-ups + 20 measured runs.

Workloads:

- `dense-local`: пусты только две target liberties;
- `sparse-max-empty`: почти вся topology пуста.

| Case | Workload | Empty | Examined/legal | Nodes | Depth | Median ms | p95 ms | Max ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Torus 9×9 | dense | 2 | 2/2 | 18 | 3 | 3.609 | 10.410 | 10.652 |
| Torus 9×9 | sparse | 78 | 78/78 | 546 | 3 | 93.856 | 95.461 | 100.264 |
| Torus 13×13 | dense | 2 | 2/2 | 18 | 3 | 7.880 | 8.102 | 8.154 |
| Torus 13×13 | sparse | 166 | 166/166 | 1162 | 3 | 458.336 | 464.715 | 502.325 |
| Torus 19×19 | dense | 2 | 2/2 | 18 | 3 | 18.196 | 18.498 | 18.501 |
| Torus 19×19 | sparse | 358 | 358/358 | 2506 | 3 | 2257.245 | 2269.888 | 2276.010 |
| Cube 2×2 | dense | 2 | 2/2 | 18 | 3 | 2.311 | 4.098 | 4.637 |
| Cube 2×2 | sparse | 21 | 21/21 | 147 | 3 | 13.722 | 14.678 | 16.365 |
| Cube 4×4 | dense | 2 | 2/2 | 18 | 3 | 6.974 | 7.589 | 7.716 |
| Cube 4×4 | sparse | 93 | 93/93 | 651 | 3 | 249.166 | 250.677 | 250.747 |
| Cube 5×5 | dense | 2 | 2/2 | 18 | 3 | 10.693 | 11.057 | 11.522 |
| Cube 5×5 | sparse | 147 | 147/147 | 1029 | 3 | 648.778 | 651.653 | 652.027 |
| Cube 7×7 | dense | 2 | 2/2 | 18 | 3 | 21.458 | 21.827 | 22.994 |
| Cube 7×7 | sparse | 291 | 291/291 | 2037 | 3 | 2470.457 | 2486.760 | 2490.738 |

Pathological p95 ~2.27–2.49 s/group → production classifier integration запрещена. Выбран Variant B: exhaustive reader = oracle, develop proof-safe pruning.

---

# 12. E2-3d — proof-safe two-lib relevance pruning

Статус: **DONE / ADVERSARIALLY VALIDATED / BENCHMARKED / NOT CLASSIFIER-INTEGRATED**.

```text
algorithm = two-liberty-proof-pruned-reader-v1
certificate = outside-six-wave-string-closed-causal-cone
```

## Proof boundary

Geometric radius запрещён. Один Go move может влиять через capture соседней connected string более чем на один простой edge, поэтому relevance строится graph-native и закрывается через целые current stone strings.

Maximum bounded continuation:

```text
root defender move                         <= 2 dependency waves
two-lib attacker reduction                 <= 1
one-lib defender extension/countercapture  <= 2
final attacker capture                     <= 1
TOTAL                                      <= 6 graph waves
```

После каждой wave выполняется closure through complete existing strings.

## Root safety

Каждый empty logical root point всё равно проходит:

```text
GameEngine legality
+
root structural simple-ko guard
```

Pruning исключает только deep continuation после такого scan.

Remote ko поэтому не теряется.

## Pass rule

Certified-irrelevant root placement может считаться losing только если `Pass` уже proven losing. Иначе branch остаётся `not-proven`.

## Budget

Budget относится к deep-evaluated relevant placements. Exhaustion → `UNRESOLVED`.

## Correctness validation

Adversarial coverage:

- non-liberty counter-capture preparation остаётся relevant;
- remote root-ko обнаруживается до pruning;
- long existing connected strings входят в cone целиком;
- certificate применяется только вместе с losing Pass;
- deterministic Torus 9×9 + Cube 2×2 differential corpus;
- required invariant:

```text
pruned proven-dead => exhaustive proven-dead
```

## Comparative benchmark E2-3d

CI #715, same E2-3c fixtures, same runner, 2 warmups + 20 samples.

Dense cases prune 0 branches и дают только небольшой cone overhead.

| Dense case | Exhaustive p95 | Pruned p95 | Deep | Certified irrelevant | Cone |
|---|---:|---:|---:|---:|---:|
| Torus 9×9 | 6.732 | 6.733 | 2 | 0 | 81 |
| Torus 13×13 | 8.043 | 8.855 | 2 | 0 | 169 |
| Torus 19×19 | 18.486 | 21.119 | 2 | 0 | 361 |
| Cube 2×2 | 3.598 | 3.774 | 2 | 0 | 24 |
| Cube 4×4 | 6.462 | 7.460 | 2 | 0 | 96 |
| Cube 5×5 | 10.359 | 11.101 | 2 | 0 | 150 |
| Cube 7×7 | 20.652 | 22.637 | 2 | 0 | 294 |

| Sparse case | Empty | Exhaustive p95 | Pruned p95 | Speedup | Deep/legal | Certified irrelevant | Cone |
|---|---:|---:|---:|---:|---:|---:|---:|
| Torus 9×9 | 78 | 97.567 | 77.099 | 1.27× | 66/78 | 12 | 69 |
| Torus 13×13 | 166 | 450.079 | 231.136 | 1.95× | 82/166 | 84 | 85 |
| Torus 19×19 | 358 | 2238.434 | 537.927 | 4.16× | 82/358 | 276 | 85 |
| Cube 2×2 | 21 | 12.605 | 13.800 | 0.91× | 21/21 | 0 | 24 |
| Cube 4×4 | 93 | 229.531 | 148.320 | 1.55× | 58/93 | 35 | 61 |
| Cube 5×5 | 147 | 597.810 | 265.183 | 2.25× | 64/147 | 83 | 67 |
| Cube 7×7 | 291 | 2317.031 | 548.505 | 4.22× | 67/291 | 224 | 70 |

Worst supported sparse:

```text
Torus 19×19: 2238.434 -> 537.927 ms p95
Cube 7×7:   2317.031 -> 548.505 ms p95
```

Deep branch reduction ≈77%, но ~0.54–0.55 s/group всё ещё слишком дорого для automatic classifier path.

Decision:

```text
two-liberty-proof-pruned-reader-v1
= validated experimental proof layer
= building block for generic search
!= classifier-integrated path
```

---

# 13. E2-4 — Generic deterministic AND/OR Proof Search

Статус: **E2-4a CORE IMPLEMENTED / CONTRACT-TESTED / CI VALIDATION IN PROGRESS; GO ADAPTER NOT YET IMPLEMENTED; NOT CLASSIFIER-INTEGRATED**.

Core file:

```text
src/core/endgame/DeterministicAndOrProofSearch.ts
algorithm = deterministic-and-or-proof-search-v1
```

## E2-4a semantic contract

Outcomes всегда с точки зрения attacker trying to kill target:

```text
PROVEN_KILL
PROVEN_SURVIVAL
KO_DEPENDENT
BUDGET_EXHAUSTED
UNRESOLVED
```

Node roles:

```text
attacker node = OR
defender node = AND
```

### Attacker OR

```text
one proven-kill child => proven-kill
```

Чтобы доказать `proven-survival` на attacker node, недостаточно не найти kill. Все proof-complete attack branches должны быть proven survival.

### Defender AND

```text
every proof-complete defense must lose => proven-kill
one proven-survival defense => proven-survival
```

Failure to find a defense не является kill proof, если move set неполный.

## Explicit move-set completeness

Adapter обязан пометить expansion одним из трёх видов:

```text
complete
proof-safe-pruned(certificate)
incomplete(reason)
```

Rules:

- incomplete attacker set может доказать **existence** найденного kill, но не survival;
- incomplete defender set может доказать **existence** найденного survival, но не kill;
- `proof-safe-pruned` разрешает universal conclusion только с non-empty explicit certificate;
- empty/missing pruning certificate fail-closed → `UNRESOLVED`;
- search core не изобретает certificate: ответственность за математическую soundness лежит на graph-native adapter/relevance layer.

Это делает boundary `candidate != proof` частью API, а не convention.

## Determinism

Core:

- сортирует moves по stable `moveKey`;
- запрещает duplicate move keys внутри node;
- использует deterministic DFS;
- deterministic positive-integer global node budget;
- transposition/memoization пока отсутствует специально.

Default node budget:

```text
2048
```

Budget exhaustion:

```text
BUDGET_EXHAUSTED
```

и никогда не конвертируется в kill/survival.

## Conservative uncertainty propagation

Decisive existential result может победить ранее встреченный uncertain branch:

```text
attacker: later proven kill is sufficient
 defender: later proven survival is sufficient
```

Если decisive branch не найден:

```text
budget exhaustion -> BUDGET_EXHAUSTED
unresolved child   -> UNRESOLVED
ko-only blocker    -> KO_DEPENDENT
```

Таким образом ko не маскирует более общий unresolved blocker, а unknown никогда не становится proof.

## Observability

Result содержит:

```text
algorithm
rootNodeKey
outcome
reason
exploredNodes
maxDepth
nodeBudget
principalVariation
proofSafePruningCertificates
```

## E2-4a contract tests

Покрыты:

- attacker OR existence proof;
- attacker incomplete set cannot prove survival;
- defender AND universal kill proof;
- defender incomplete set cannot prove kill;
- defender incomplete set can expose a proven survival escape;
- proof-safe-pruned certificate accepted as explicit completeness boundary;
- empty certificate fails closed;
- node-budget exhaustion cannot guess a later win;
- ko vs unresolved propagation;
- recursive alternating OR→AND proof;
- correct empty-set OR/AND identities;
- deterministic sorting/repeated result;
- duplicate move-key rejection;
- invalid budget rejection.

First CI run: all tests passed, but scoped typecheck found test-adapter callback parameters hidden from contextual typing by `Object.freeze`. Fixed by explicit generic parameter types; production semantics unchanged.

Current validation after fix:

```text
unit/coverage: 543 passed, 14 opt-in benchmark cases skipped
new generic-core tests: 14/14 PASS
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: pending on current exact head
```

## E2-4b — next substage

Do **not** jump directly to 3-lib classification.

Next build a Go-specific adapter/bridge that:

1. represents attacker/defender positions and legal transitions through authoritative `GameEngine`;
2. carries known/unknown `previousBoard` explicitly for ko;
3. uses one-lib reader and validated two-lib proof layers only as **proof-preserving terminals/reductions**;
4. exposes graph-native `complete`, `proof-safe-pruned(certificate)` or `incomplete(reason)` move sets;
5. differentially checks any generic-search proof against current specialized readers wherever both apply;
6. remains outside `AssistedEndgameClassifier` until correctness + performance gates pass.

Only after E2-4b is stable should E2-5 begin 3-lib move generation.

---

# 14. Three and four liberties

After Generic Proof Search + Go adapter:

```text
4 liberties
  ↓ attack
3 liberties
  ↓ attack
2-lib proof layer
  ↓
1-lib proof layer
```

Reduction of liberty count alone is never kill proof. Defender AND completeness or explicit proof-safe relevance remains mandatory.

---

# 15. Eye-space

Future graph-native exact/safe analysis:

```text
minEyes
maxEyes
attackVitalPoints
defenseVitalPoints
```

Focus: false eyes, shared eye space, connections, Torus seam, Cube edges. For small regions prefer exact local graph enumeration. Non-strict analysis may order moves but cannot label fate.

---

# 16. Connection / tactical extensions

Future layers:

- forced connection to proven-safe group;
- cut/disconnection;
- counter-capture;
- ladder;
- net;
- snapback;
- short sacrifice;
- deeper preparation moves.

`potential connection` must remain distinct from `proven connection`.

---

# 17. Semeai / seki

Separate multi-group reader required.

Facts: exclusive/shared liberties, approach moves, captures changing liberties, eyes, connection options, side to move, ko dependency.

Critical rule:

```text
failure to prove kill for black
+
failure to prove kill for white
!= SEKI
```

`SEKI` only after positive proof of mutual coexistence. Ko-dependent/incomplete → `UNRESOLVED`.

---

# 18. Validation / CI policy

Current foundation:

- Graph Core integrated;
- Benson/pass-alive integrated;
- strict one-lib integrated;
- root ko conservative;
- exhaustive two-lib v2 retained as oracle;
- proof-pruned two-lib validated, not classifier-integrated;
- deterministic generic AND/OR core implemented in E2-4a;
- no generic Go adapter yet;
- no generic classifier integration.

Scoped typecheck:

```text
npm run typecheck:engine2
```

covers `src/core/endgame`, `game`, `rules`, `topology` and imported dependencies without inheriting unrelated UI blocker.

Normal work PR gate:

```text
lint
test:coverage
typecheck:engine2
build:engine2
Chromium E2E
```

Performance benchmarks remain opt-in unless a temporary measurement gate is explicitly enabled in a work branch and removed before merge.

---

# 19. Metrics

Track:

- false automatic statuses;
- precision alive/dead/seki;
- known-answer coverage;
- median/p95/max nodes/runtime;
- unresolved by budget;
- unresolved by ko/boundary;
- root placements scanned;
- deep placements retained/pruned;
- causal cone size;
- PV/max depth;
- implementation complexity;
- dependency/license surface;
- maintainability;
- Cube/Torus graph-isomorphism consistency.

Gate:

```text
precision first
coverage second
cost third
```

---

# 20. External references policy

GNU Go / tsumego.js / Darkforest / research solvers / KataGo may be used for architecture ideas, external regression, benchmark, differential oracle or diagnostics subject to license constraints.

They are not production proof authority, and GPL implementation code is not copied.

---

# 21. Roadmap / current next step

```text
E2-1   DONE — Graph Core
E2-2   DONE — strict one-liberty reader
E2-3a  DONE — sync two-lib exhaustive v2
E2-3b  DONE — adversarial / topology / ko / determinism validation
E2-3c  DONE — exhaustive benchmark -> Variant B
E2-3d  DONE — proof-safe relevance pruning + differential + benchmark

E2-4a  IMPLEMENTED / FINAL CI — deterministic generic AND/OR semantic core
E2-4b  NEXT — Go adapter + one/two-lib proof-preserving terminal bridge
E2-4c  NEXT AFTER — differential/performance gate for generic path
E2-5   3 liberties
E2-6   4 liberties
E2-7   exact small eye-space analysis
E2-8   connections / snapback / ladder / net / sacrifice
E2-9   semeai / seki proof
E2-10  transpositions + performance optimization
E2-11  adversarial corpus + final evaluation
```

E2-4 overall acceptance boundary:

1. AND/OR semantics explicit: attacker OR, defender AND;
2. every proof node deterministic and budgeted;
3. relevance pruning only through explicit proof-safe certificate;
4. ko/history uncertainty remains `KO_DEPENDENT`/`UNRESOLVED`;
5. one/two-lib readers are proof-preserving subroutines, never heuristic labels;
6. generic Go adapter differentially agrees with specialized proofs where domains overlap;
7. no classifier integration until generic correctness + performance + differential gates pass.

Главное правило:

> Engine 2 автоматически ставит `alive`, `dead` или `seki` только там, где может предъявить законченное доказательство. Во всех остальных случаях правильный результат — `UNRESOLVED`.
