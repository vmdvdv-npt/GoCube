# Endgame Engine — engine2 working plan

## Статус и изоляция

`docs/ENDGAME_ENGINE.md` — единственный рабочий документ Endgame Engine в линии `engine2`.

`engine2` — независимая экспериментальная линия. Рабочие изменения выполняются только через `engine2-*` ветки с PR обратно в `engine2`. Код, commits и implementation decisions из `engine`/`main` сюда не переносятся.

Цель Engine 2: собственный **graph-native proof-oriented endgame reader** для Torus/Cube. Внешние Go engines допустимы только как reference/oracle/benchmark; production implementation независима.

---

# 1. Главный invariant

```text
heuristic != proof
candidate != proof
failure to find kill != proof of life
failure to find escape != proof of death
```

Незавершённое доказательство:

```text
UNRESOLVED
```

Приоритеты:

```text
1. correctness / precision
2. coverage
3. performance
```

Ложный automatic `alive/dead/seki` хуже `UNRESOLVED`.

---

# 2. Graph-only correctness

Correctness logic использует только:

```text
Topology.points()
Topology.neighbors(PointId)
```

Renderer coordinates, rectangular edge/corner flags, SVG geometry, Cube face layout и visual distance запрещены как proof inputs.

Torus seam и Cube edge — обычные graph adjacencies. Strings и empty regions могут проходить через них без special cases.

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
Go adapter / 3–4 liberty reading
  ↓
Exact small eye-space
  ↓
Connections / cuts / ladder / net / snapback / sacrifice / preparation
  ↓
Semeai / seki proof
  ↓
PROVEN_ALIVE / PROVEN_DEAD / PROVEN_SEKI / KO_DEPENDENT / UNRESOLVED
```

Engine решает group-fate proof в почти завершённых позициях, а не играет полную партию как Go AI.

---

# 4. E2-1 — Endgame Graph Core

Статус: **DONE / INTEGRATED**.

Deterministic facts:

```text
StoneString: key / color / points / liberties
EmptyRegion: points / boundaryGroups / boundaryColors / vitalGroups
SharedLiberties: opposing groupKeys / liberties
FriendlyConnectionCandidate: point / color / adjacent friendly groupKeys
PointId -> StoneString
PointId -> EmptyRegion
```

Есть complete-board guard, arbitrary graph-edge tests и Torus/Cube-independent semantics.

---

# 5. Proven Alive

Benson/pass-alive:

```text
PROVEN_ALIVE
algorithm = benson-pass-alive-v1
```

Cheap eye count не является proof authority.

---

# 6. E2-2 — strict one-liberty reader

Статус: **DONE / TESTED / CLASSIFIER-INTEGRATED**.

```text
algorithm = one-liberty-tactical-reader-v1
```

Complete immediate defender boundary для target с одной liberty:

1. play sole liberty — extension/connection;
2. capture adjacent attacker string, если он сам в atari.

`PROVEN_DEAD` только если attacker-first definite kill и every complete defender-first immediate defense loses.

---

# 7. Ko/history boundary

Nested ply с известной history использует точный `previousBoard` через authoritative `GameEngine`.

Root endgame analysis пока не имеет фактическую preceding board. Structural simple-ko-shaped capture:

```text
capture exactly one stone
new played string has one stone
only liberty = captured point
```

без known `previousBoard` → `KO_DEPENDENT`.

Unknown ko legality никогда не угадывается.

---

# 8. E2-3 — two-liberty exhaustive reader v2

Статус: **DONE / HARDENED / BENCHMARKED / NOT CLASSIFIER-INTEGRATED**.

```text
algorithm = two-liberty-exhaustive-reader-v2
```

Attacker-first пробует current two liberties, каждый move проходит `GameEngine`, unknown root ko сохраняется conservative, reduction to one liberty использует strict one-lib reader.

Defender-first correctness oracle перечисляет:

```text
all empty Topology.points()
+
Pass
```

Каждый placement проходит authoritative legality. Default placement budget = `512`; exhaustion → `UNRESOLVED`.

`proven-dead` только при attacker proof + every legal defense/Pass losing + no ko dependency + no budget exhaustion.

---

# 9. E2-3c — exhaustive performance gate

Статус: **DONE — VARIANT B**.

```text
src/core/endgame/TwoLibertyTacticalReader.benchmark.test.ts
npm run benchmark:engine2:two-lib
```

GitHub Actions Ubuntu 24.04 / Node 22.23.2; 2 warmups + 20 samples.

| Case | Workload | Empty | Examined/legal | Nodes | p95 ms |
|---|---|---:|---:|---:|---:|
| Torus 9×9 | dense | 2 | 2/2 | 18 | 10.410 |
| Torus 9×9 | sparse | 78 | 78/78 | 546 | 95.461 |
| Torus 13×13 | dense | 2 | 2/2 | 18 | 8.102 |
| Torus 13×13 | sparse | 166 | 166/166 | 1162 | 464.715 |
| Torus 19×19 | dense | 2 | 2/2 | 18 | 18.498 |
| Torus 19×19 | sparse | 358 | 358/358 | 2506 | 2269.888 |
| Cube 2×2 | dense | 2 | 2/2 | 18 | 4.098 |
| Cube 2×2 | sparse | 21 | 21/21 | 147 | 14.678 |
| Cube 4×4 | dense | 2 | 2/2 | 18 | 7.589 |
| Cube 4×4 | sparse | 93 | 93/93 | 651 | 250.677 |
| Cube 5×5 | dense | 2 | 2/2 | 18 | 11.057 |
| Cube 5×5 | sparse | 147 | 147/147 | 1029 | 651.653 |
| Cube 7×7 | dense | 2 | 2/2 | 18 | 21.827 |
| Cube 7×7 | sparse | 291 | 291/291 | 2037 | 2486.760 |

Pathological p95 ~2.27–2.49 s/group → **Variant B**: exhaustive v2 остаётся correctness oracle, classifier integration запрещена.

---

# 10. E2-3d — proof-safe relevance pruning

Статус: **DONE / ADVERSARIALLY VALIDATED / BENCHMARKED / NOT CLASSIFIER-INTEGRATED**.

```text
algorithm = two-liberty-proof-pruned-reader-v1
certificate = outside-six-wave-string-closed-causal-cone
```

Geometric radius запрещён. Causal cone строится graph-native и закрывается через complete existing stone strings.
Bounded continuation:

```text
root defender move                         <= 2 dependency waves
two-lib attacker reduction                 <= 1
one-lib defender extension/countercapture  <= 2
final attacker capture                     <= 1
TOTAL                                      <= 6 graph waves
```

Каждый root empty point всё равно проходит `GameEngine` legality + structural root-ko guard. Pruning исключает только deep continuation.

Certified-irrelevant placement считается losing только если `Pass` уже proven losing; иначе остаётся `not-proven`.

Budget относится к deep relevant placements; exhaustion → `UNRESOLVED`.

Adversarial/differential boundary:

```text
non-local countercapture remains relevant
remote root ko remains visible
long existing strings close as whole strings
pruned proven-dead => exhaustive proven-dead
```

Comparative benchmark CI #715:

| Sparse case | Empty | Exhaustive p95 | Pruned p95 | Speedup | Deep/legal | Certified irrelevant | Cone |
|---|---:|---:|---:|---:|---:|---:|---:|
| Torus 9×9 | 78 | 97.567 | 77.099 | 1.27× | 66/78 | 12 | 69 |
| Torus 13×13 | 166 | 450.079 | 231.136 | 1.95× | 82/166 | 84 | 85 |
| Torus 19×19 | 358 | 2238.434 | 537.927 | 4.16× | 82/358 | 276 | 85 |
| Cube 2×2 | 21 | 12.605 | 13.800 | 0.91× | 21/21 | 0 | 24 |
| Cube 4×4 | 93 | 229.531 | 148.320 | 1.55× | 58/93 | 35 | 61 |
| Cube 5×5 | 147 | 597.810 | 265.183 | 2.25× | 64/147 | 83 | 67 |
| Cube 7×7 | 291 | 2317.031 | 548.505 | 4.22× | 67/291 | 224 | 70 |

Deep branch reduction worst cases ≈77%, но ~0.54–0.55 s/group всё ещё слишком дорого для classifier path.

```text
two-liberty-proof-pruned-reader-v1
= validated experimental proof layer
= building block for generic search
!= classifier-integrated path
```

---

# 11. E2-4 — Generic deterministic AND/OR Proof Search

## E2-4a — semantic core

Статус: **DONE / CONTRACT-TESTED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/DeterministicAndOrProofSearch.ts
algorithm = deterministic-and-or-proof-search-v1
default node budget = 2048
```

Outcomes с точки зрения attacker trying to kill target:

```text
PROVEN_KILL
PROVEN_SURVIVAL
KO_DEPENDENT
BUDGET_EXHAUSTED
UNRESOLVED
```

Roles:

```text
attacker = OR
defender = AND
```

### Proof semantics

Attacker OR:

```text
one proven-kill child => proven-kill
```

Attacker `proven-survival` требует, чтобы все proof-complete attack branches были proven survival. Не найти kill недостаточно.

Defender AND:

```text
every proof-complete defense loses => proven-kill
one proven-survival defense => proven-survival
```

Не найти defense недостаточно, если move set неполный.

### Move-set completeness is explicit API state

```text
complete
proof-safe-pruned(certificate)
incomplete(reason)
```

Rules:

- incomplete attacker set может доказать найденный kill, но не survival;
- incomplete defender set может доказать найденный survival, но не kill;
- `proof-safe-pruned` поддерживает universal conclusion только с non-empty explicit certificate;
- empty certificate fail-closed → `UNRESOLVED`;
- core не придумывает proof certificate: soundness сертификата обязан обеспечить graph-native adapter/relevance layer.

### Determinism / budget

- stable sort by `moveKey`;
- duplicate move keys rejected;
- deterministic DFS;
- global positive-integer node budget;
- exhaustion → `BUDGET_EXHAUSTED`;
- transpositions/memoization intentionally deferred.

Uncertainty without decisive existential proof:

```text
budget exhaustion -> BUDGET_EXHAUSTED
unresolved child   -> UNRESOLVED
ko-only blocker    -> KO_DEPENDENT
```

Observability:

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

Contract tests cover:

- attacker OR existence proof;
- incomplete attacker cannot prove survival;
- defender AND universal proof;
- incomplete defender cannot prove kill;
- defender escape existence proof;
- proof-safe pruning certificate;
- empty certificate fail-closed;
- node-budget exhaustion;
- ko/unresolved propagation;
- recursive OR→AND;
- empty-set OR/AND identities;
- deterministic ordering;
- duplicate keys;
- invalid budget.

Validation:

```text
new generic core tests: 14/14 PASS
full unit/coverage: 543 passed, 14 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E PASS
```

Первый CI run имел только test-adapter TypeScript contextual-typing error из-за `Object.freeze`; исправлено explicit callback parameter typing, production search semantics не менялись.

## E2-4b — Go adapter + specialised terminal bridge

Статус: **DONE / DIFFERENTIALLY TESTED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/EndgameProofSearchGoAdapter.ts
algorithm = endgame-go-proof-adapter-v1
move generation boundary = go-move-generation-not-installed-e2-4b
```

Proof node хранит:

```text
GameState
target color
sorted crucial stones
attacker / defender role
optional exact previousBoard
```

Bridge semantics:

- target identity сохраняется через crucial stones, а не переопределяется эвристикой после каждого ply;
- все place/pass transitions проходят только через authoritative `GameEngine`;
- known `previousBoard` передаётся как exact simple-ko context;
- unknown-history root simple-ko-shaped placement не создаёт child и возвращает `ko-dependent`;
- каждый accepted child получает `previousBoard = parent.state.board`;
- deterministic node key включает board signature, role, target color/crucial stones и previous-board signature.

Specialised readers используются только как **positive proof-preserving kill terminals**:

```text
one-lib attacker kill          -> proven-kill
one-lib defender forced-kill   -> proven-kill
two-lib attacker forced-kill   -> proven-kill
two-lib defender forced-kill   -> proven-kill
captured crucial target        -> proven-kill
```

Specialised `escape`, `critical`, `unresolved` и отсутствие specialised proof **никогда не превращаются в generic survival**.

Generic Go expansion в E2-4b намеренно остаётся:

```text
incomplete(go-move-generation-not-installed-e2-4b)
```

Поэтому non-terminal adapter state остаётся `UNRESOLVED`; неполный defender move set не может случайно породить universal kill proof. 3-lib move generation и classifier integration в E2-4b отсутствуют.

Differential/contract tests покрывают:

- one-lib/two-lib overlap со specialised readers;
- attacker/defender role-sensitive critical cases;
- captured target terminal;
- ordinary legal, illegal и Pass transitions;
- unknown-root ko против known exact history;
- deterministic target/node identity.

Validation — CI #733:

```text
new E2-4b tests: 12/12 PASS
full unit/coverage: 555 passed, 14 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

## E2-4c — generic-path differential/performance gate

Статус: **DONE / DIFFERENTIALLY TESTED / BENCHMARKED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/EndgameProofSearchGoAdapter.gate.test.ts
src/core/endgame/EndgameProofSearchGoAdapter.benchmark.test.ts
npm run benchmark:engine2:generic
```

Correctness gate фиксирует boundary generic path до появления 3-lib move generation:

- one-lib positive attacker/defender proofs совпадают со specialised reader и дают только `proven-kill`;
- validated two-lib positive attacker/defender proofs совпадают со specialised reader и дают только `proven-kill`;
- specialised one-lib `escape` не превращается в generic survival;
- при explicit incomplete Go move set attacker не может получить universal `proven-survival`, а defender — universal `proven-kill`;
- unknown-root simple-ko остаётся conservative на specialised, transition и generic layers и не даёт false kill proof.

Performance gate запускается отдельно от normal test suite: 2 warmups + 20 samples, deterministic result/node/depth/PV assertions, gross-regression ceilings `p95 <= 250 ms` и `max <= 1000 ms`.

CI #750 benchmark results:

| Case | Workload | Points | Nodes | p95 ms | max ms |
|---|---|---:|---:|---:|---:|
| Torus 9×9 | one-lib positive | 81 | 1 | 2.935 | 3.145 |
| Torus 9×9 | incomplete | 81 | 1 | 1.123 | 1.283 |
| Torus 13×13 | one-lib positive | 169 | 1 | 2.144 | 2.175 |
| Torus 13×13 | incomplete | 169 | 1 | 1.981 | 2.041 |
| Torus 19×19 | one-lib positive | 361 | 1 | 4.285 | 4.442 |
| Torus 19×19 | incomplete | 361 | 1 | 4.992 | 5.565 |
| Cube 2×2 | one-lib positive | 24 | 1 | 1.334 | 2.047 |
| Cube 2×2 | incomplete | 24 | 1 | 1.018 | 1.045 |
| Cube 4×4 | one-lib positive | 96 | 1 | 3.540 | 3.646 |
| Cube 4×4 | incomplete | 96 | 1 | 1.993 | 2.038 |
| Cube 5×5 | one-lib positive | 150 | 1 | 3.130 | 3.243 |
| Cube 5×5 | incomplete | 150 | 1 | 4.692 | 5.992 |
| Cube 7×7 | one-lib positive | 294 | 1 | 5.759 | 6.079 |
| Cube 7×7 | incomplete | 294 | 1 | 5.652 | 5.790 |

Worst observed p95 = `5.759 ms`; worst max = `6.079 ms`. Gate margin остаётся большим относительно `250/1000 ms` ceilings.

Validation — CI #750:

```text
new E2-4c correctness tests: 5/5 PASS
generic benchmark cases: 14/14 PASS
full unit/coverage: 560 passed, 28 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

Temporary CI benchmark step, использованный для #750, удалён перед merge согласно benchmark policy; benchmark script остаётся opt-in и воспроизводимым.

E2-4c не меняет production proof semantics: generic Go move generation всё ещё explicit `incomplete(go-move-generation-not-installed-e2-4b)`, classifier integration отсутствует, 3-lib search не начат.

**E2-4 correctness + differential + performance boundary закрыт.**

---

# 12. E2-5 — exact three-liberty proof move generation

Статус: **DONE / CONTRACT-TESTED / BENCHMARKED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/ThreeLibertyProofSearchGoAdapter.ts
algorithm = endgame-go-three-liberty-adapter-v1
attacker boundary = e2-5-three-liberty-attacks-limited-to-current-liberties
unknown-root ko boundary = e2-5-three-liberty-unknown-root-ko-branch
```

E2-5 активируется только когда surviving crucial stones по-прежнему принадлежат одной target group с **ровно тремя liberties**. Target identity остаётся crucial-stone based; graph recomputation не переопределяет цель эвристически.

### Attacker OR

Attacker рассматривает только три current liberties target group. Каждый placement проходит authoritative `transitionEndgameProofSearchMove` / `GameEngine`.

Move set намеренно остаётся:

```text
incomplete(e2-5-three-liberty-attacks-limited-to-current-liberties)
```

Поэтому найденная ветка `3-lib -> 2-lib -> specialised positive kill` может доказать existential `proven-kill`, но отсутствие kill среди этих трёх кандидатов **не может** доказать `proven-survival`. Preparation moves, snapback/net/ladder/sacrifice и другие attack candidates остаются за последующими этапами.

### Defender AND

Для exact-three-lib defender node correctness-first expansion перечисляет:

```text
all empty Topology.points()
+
Pass
```

Каждый placement проходит authoritative legality. При exact known ko history rejected moves считаются действительно illegal, поэтому defender move set может быть `complete`.

Если root history неизвестна и существует structural simple-ko-shaped placement, такой child не создаётся, а весь defender expansion понижается до explicit:

```text
incomplete(e2-5-three-liberty-unknown-root-ko-branch)
```

Это fail-closed boundary: неизвестная ko legality не может породить ложный universal kill.

Nodes вне exact-three-lib boundary делегируются неизменённому E2-4b adapter и остаются explicit incomplete, если one/two-lib specialised positive terminal не применим. Classifier integration в E2-5 отсутствует; E2-6 / 4-lib generation не добавлялась.

Contract tests покрывают:

- legal current-liberty attacker reductions + explicit incompleteness;
- positive `3 -> 2` existential kill через validated specialised terminal;
- complete whole-board defender set + Pass;
- remote legal defender placement, исключающий locality assumption;
- unknown-root ko fail-closed против exact known history;
- authoritative suicide filtering;
- fallback к E2-4b incomplete boundary вне 3 liberties.

Первый CI #760 обнаружил только ошибку positive test fixture: после первого reduction атакующая соседняя string сама становилась тактически уязвимой, поэтому существующий two-lib proof корректно возвращал `UNRESOLVED`. Исправлена только fixture добавлением liberties атакующей string; production E2-5 semantics не менялись.

Validation — CI #761:

```text
new E2-5 contract tests: 6/6 PASS
full unit/coverage: 566 passed, 28 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

### E2-5 performance gate

```text
src/core/endgame/ThreeLibertyProofSearchGoAdapter.benchmark.test.ts
npm run benchmark:engine2:three-lib
```

Benchmark измеряет новый E2-5 expansion boundary отдельно от normal suite: 2 warmups + 20 samples, deterministic generated-move/completeness assertions. Sparse fixture имеет exact 3-lib target; attacker генерирует ровно 3 current-liberty candidates, defender перечисляет every legal empty point + Pass.

CI #769 benchmark results:

| Case | Workload | Points | Generated moves | p95 ms | max ms |
|---|---|---:|---:|---:|---:|
| Torus 9×9 | attacker | 81 | 3 | 1.801 | 1.808 |
| Torus 9×9 | defender | 81 | 80 | 2.457 | 2.538 |
| Torus 13×13 | attacker | 169 | 3 | 1.918 | 1.926 |
| Torus 13×13 | defender | 169 | 168 | 4.687 | 4.865 |
| Torus 19×19 | attacker | 361 | 3 | 2.578 | 2.633 |
| Torus 19×19 | defender | 361 | 360 | 14.645 | 17.381 |
| Cube 2×2 | attacker | 24 | 3 | 0.621 | 0.952 |
| Cube 2×2 | defender | 24 | 23 | 0.758 | 1.000 |
| Cube 4×4 | attacker | 96 | 3 | 2.294 | 2.423 |
| Cube 4×4 | defender | 96 | 95 | 3.169 | 3.439 |
| Cube 5×5 | attacker | 150 | 3 | 1.851 | 1.911 |
| Cube 5×5 | defender | 150 | 149 | 3.600 | 3.690 |
| Cube 7×7 | attacker | 294 | 3 | 3.172 | 3.284 |
| Cube 7×7 | defender | 294 | 293 | 10.582 | 10.789 |

Worst observed p95 = `14.645 ms`; worst max = `17.381 ms`. Gross-regression ceilings были `100/500 ms` для attacker expansion и `1000/3000 ms` для defender expansion.

CI #769 также подтвердил normal gate на benchmark head:

```text
three-lib benchmark cases: 14/14 PASS
full unit/coverage: 566 passed, 42 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

Temporary E2-5 CI benchmark step после #769 удалён; `benchmark:engine2:three-lib` остаётся opt-in и воспроизводимым.

**E2-5 acceptance boundary закрыт. Следующий этап: E2-6 — 4 liberties.**

---

# 13. E2-6 — exact four-liberty proof move generation

Статус: **DONE / CONTRACT-TESTED / BENCHMARKED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/FourLibertyProofSearchGoAdapter.ts
algorithm = endgame-go-four-liberty-adapter-v1
attacker boundary = e2-6-four-liberty-attacks-limited-to-current-liberties
unknown-root ko boundary = e2-6-four-liberty-unknown-root-ko-branch
```

E2-6 активируется только когда surviving crucial stones остаются одной target group с **ровно четырьмя liberties**. Target identity сохраняется crucial-stone based; topology/graph recomputation используется только для актуального состояния target, без эвристического retargeting.

### Attacker OR

Attacker рассматривает только четыре current liberties target group. Каждый placement проходит authoritative `transitionEndgameProofSearchMove` / `GameEngine`.

Move set всегда остаётся explicit:

```text
incomplete(e2-6-four-liberty-attacks-limited-to-current-liberties)
```

Поэтому найденная цепочка `4-lib -> 3-lib -> E2-5 -> 2-lib/1-lib positive terminal` может доказать existential `proven-kill`, но отсутствие kill среди этих четырёх кандидатов **не может** доказать `proven-survival`. Liberty reduction сама по себе не является proof kill; preparation moves и tactical extensions остаются за более поздними этапами.

Если среди ограниченных attacker candidates встречается неизвестная root-ko legality, candidate не создаётся, а incomplete reason дополнительно фиксирует `e2-6-four-liberty-unknown-root-ko-branch`; это не расширяет силу доказательства.

### Defender AND

Для exact-four-lib defender node correctness-first expansion перечисляет:

```text
all empty Topology.points()
+
Pass
```

Каждый placement проходит authoritative legality. При безопасной known history и отсутствии неизвестных ko branches move set может быть `complete`. Remote legal moves не отбрасываются locality assumption-ом.

Unknown-root structural simple-ko-shaped placement не создаёт child и понижает весь defender expansion до:

```text
incomplete(e2-6-four-liberty-unknown-root-ko-branch)
```

Следовательно universal `proven-kill` возможен только при действительно complete defender set; неизвестная ko legality остаётся fail-closed.

Exact-three-lib children делегируются неизменённому E2-5 adapter. Все прочие non-terminal nodes делегируются дальше по существующей цепочке и вне exact 3/4 liberties сохраняют E2-4b explicit incomplete boundary. Classifier integration в E2-6 отсутствует; E2-7 eye-space semantics не добавлялись.

Contract tests покрывают:

- legal exact-four current-liberty attacker reductions + explicit incompleteness;
- positive `4 -> 3 -> 2` existential kill через E2-5 и validated specialised terminal;
- complete whole-board defender set + Pass;
- remote legal defender placement, исключающий locality assumption;
- unknown-root ko fail-closed против exact known history;
- authoritative attacker-suicide filtering;
- exact-three delegation к E2-5;
- fallback к E2-4b incomplete boundary за пределами exact 3/4 liberties.

Validation — CI #784:

```text
new E2-6 contract tests: 7/7 PASS
full unit/coverage: 573 passed, 56 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

### E2-6 performance gate

```text
src/core/endgame/FourLibertyProofSearchGoAdapter.benchmark.test.ts
npm run benchmark:engine2:four-lib
```

Benchmark измеряет exact-four expansion boundary отдельно от normal suite: 2 warmups + 20 samples, deterministic generated-move/completeness assertions. Sparse fixture содержит single exact-4-lib target; attacker генерирует ровно четыре current-liberty candidates, defender перечисляет every legal empty point + Pass.

CI #786 benchmark results:

| Case | Workload | Points | Generated moves | p95 ms | max ms |
|---|---|---:|---:|---:|---:|
| Torus 9×9 | attacker | 81 | 4 | 2.199 | 2.394 |
| Torus 9×9 | defender | 81 | 81 | 3.220 | 3.224 |
| Torus 13×13 | attacker | 169 | 4 | 1.520 | 1.563 |
| Torus 13×13 | defender | 169 | 169 | 4.064 | 4.352 |
| Torus 19×19 | attacker | 361 | 4 | 2.911 | 2.939 |
| Torus 19×19 | defender | 361 | 361 | 19.813 | 20.315 |
| Cube 2×2 | attacker | 24 | 4 | 1.173 | 1.188 |
| Cube 2×2 | defender | 24 | 24 | 0.802 | 0.814 |
| Cube 4×4 | attacker | 96 | 4 | 2.148 | 2.676 |
| Cube 4×4 | defender | 96 | 96 | 3.887 | 4.020 |
| Cube 5×5 | attacker | 150 | 4 | 1.951 | 2.033 |
| Cube 5×5 | defender | 150 | 150 | 4.677 | 4.712 |
| Cube 7×7 | attacker | 294 | 4 | 3.484 | 3.721 |
| Cube 7×7 | defender | 294 | 294 | 15.402 | 15.606 |

Worst observed p95 = `19.813 ms`; worst max = `20.315 ms`. Gross-regression ceilings остаются `100/500 ms` для attacker expansion и `1000/3000 ms` для defender expansion.

CI #786 также подтвердил normal gate на benchmark head:

```text
four-lib benchmark cases: 14/14 PASS
full unit/coverage: 573 passed, 56 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

Temporary E2-6 CI benchmark step после измерения удалён; `benchmark:engine2:four-lib` остаётся opt-in и воспроизводимым.

**E2-6 acceptance boundary закрыт. Следующий этап: E2-7 — exact small eye-space.**

---

# 14. E2-7 — exact small eye-space

Статус: **DONE / CONTRACT-TESTED / BENCHMARKED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/SmallEyeSpaceAnalyzer.ts
algorithm = small-eye-space-exact-v1
default max region points = 6
default node budget = 4096
```

E2-7 анализирует connected empty regions graph-native через `Topology.points()` / `Topology.neighbors()` и существующий `EndgameGraphCore`. Renderer geometry, face coordinates и rectangular edge/corner assumptions не используются.

### Strict exact boundary

Exact search допускается только для small region, который bounded **только target string**. Для такого region обе move-order задачи перечисляют:

```text
every legal empty point inside the region
+
Pass
```

Каждый placement проходит authoritative `GameEngine` legality. Search завершается после двух Pass или capture target; deterministic state key включает board, player, pass count и previous-board signature.

Semantics:

- attacker-first минимизирует surviving target-only empty components → `minEyes`;
- defender-first максимизирует их → `maxEyes`;
- при `complete=true` эти bounds exact для установленной local boundary;
- `attackVitalPoints` / `defenseVitalPoints` выдаются только для complete root search и только для optimal placements, которые строго улучшают результат относительно Pass;
- false eye определяется legal tactical consequence, а не shape heuristic.

### Fail-closed / non-strict boundary

Следующие случаи не получают exact authority:

```text
mixed-color shared space
same-color friendly-shared boundary
region > maxRegionPoints
unknown-root simple ko
non-local capture outside searched region
search cycle
node-budget exhaustion
```

Для shared/friendly-shared/oversized region возвращаются только conservative bounds `0..region.points.length`, `complete=false`, без vital points. Ko/cycle/budget/non-local uncertainty также понижает result до incomplete. Такие результаты могут позднее использоваться для ordering/reduction, но **не имеют права сами ставить alive/dead/seki**.

Torus seam и Cube face edge проходят тем же graph-native путём без special-case geometry.

Contract tests покрывают 9 случаев:

- два sealed one-point eyes;
- capturable one-point false eye;
- three-point eye-space с exact attack/defense vital point;
- mixed-color shared space;
- same-color friendly-shared boundary;
- Torus seam;
- Cube face edge;
- deliberate node-budget exhaustion;
- deterministic repeated analysis.

Первый code-head CI #793:

```text
new E2-7 contract tests: 9/9 PASS
full unit/coverage: 582 passed, 56 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

### E2-7 performance gate

```text
src/core/endgame/SmallEyeSpaceAnalyzer.benchmark.test.ts
npm run benchmark:engine2:eye-space
```

Benchmark использует реальные Torus/Cube topologies, strict connected two-point eye-space fixture, 2 warmups + 20 samples и deterministic result/node/depth assertions. Gross-regression ceilings: `p95 <= 250 ms`, `max <= 1000 ms`.

CI #795 benchmark results:

| Case | Points | Nodes | Depth | p95 ms | max ms |
|---|---:|---:|---:|---:|---:|
| Torus 9×9 | 81 | 24 | 4 | 11.352 | 14.782 |
| Torus 13×13 | 169 | 24 | 4 | 13.566 | 13.586 |
| Torus 19×19 | 361 | 24 | 4 | 34.516 | 37.665 |
| Cube 2×2 | 24 | 24 | 4 | 5.587 | 6.307 |
| Cube 4×4 | 96 | 24 | 4 | 11.418 | 11.616 |
| Cube 5×5 | 150 | 24 | 4 | 17.228 | 17.414 |
| Cube 7×7 | 294 | 24 | 4 | 35.622 | 36.778 |

Worst observed p95 = `35.622 ms`; worst max = `37.665 ms`.

Validation — CI #795:

```text
eye-space benchmark cases: 7/7 PASS
full unit/coverage: 582 passed, 63 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

Temporary E2-7 benchmark CI step после измерения удалён; `benchmark:engine2:eye-space` остаётся opt-in и воспроизводимым.

E2-7 не интегрирован в `AssistedEndgameClassifier` и не производит fate labels. Existing generic move generation вне exact 3/4-lib boundary также не расширялась.

**E2-7 acceptance boundary закрыт. Следующий этап: E2-8 — connections / tactical extensions.**

---

# 15. E2-8 — connections / tactical extensions

Статус: **DONE / CONTRACT-TESTED / BENCHMARKED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/TacticalExtensionProofSearchGoAdapter.ts
algorithm = endgame-go-tactical-extension-adapter-v1
move generation boundary = e2-8-tactical-candidates-are-not-proof-complete
unknown-root ko boundary = e2-8-tactical-unknown-root-ko-branch
pass-alive terminal = e2-8-target-pass-alive
```

E2-8 расширяет существующий E2-6/E2-5 proof adapter graph-native tactical candidates для:

```text
connection
cut
counter-capture
ladder-step
net-step
snapback
sacrifice
preparation
```

Каждый placement, reply и recapture проходит общий authoritative `transitionEndgameProofSearchMove` / `GameEngine`; renderer geometry и rectangular/Cube-face assumptions не используются.

### Proof boundary

Главный invariant сохраняется: **tactical candidate != fate proof**.

- `connection` распознаётся только когда legal placement действительно объединяет две или более pre-move friendly strings в post-state;
- само наличие или выполнение connection не доказывает survival;
- `proven-survival` добавлен только для surviving target, который после authoritative transition реально удовлетворяет Benson/pass-alive fixed point;
- `cut` — legal play на opponent friendly-connection point, но не самостоятельный kill proof;
- `counter-capture` фиксируется только по фактически удалённым opponent stones в authoritative board transition;
- `ladder-step` означает только exact liberty pressure `2 -> 1`; это candidate/ordering evidence, а не полный ladder theorem;
- `net-step` означает только exact liberty pressure `>=3 -> 2`; это candidate/ordering evidence, а не полный net theorem;
- `snapback` требует exact legal local sequence `sacrifice -> opponent capture -> legal recapture capturing >=2`, но сама последовательность остаётся candidate evidence, пока AND/OR search не докажет fate;
- `sacrifice` помечается только для legal tactical placement, чья played string остаётся с одной liberty;
- `preparation` включает direct target-liberty reduction выше 4 liberties и one-wave graph-native tactical preparation around target liberties, connection points и low-lib strings.

Для nodes, где E2-5/E2-6 defender expansion уже `complete`, E2-8 возвращает его **без изменения**. Для остальных nodes tactical candidates добавляются к базовому набору, но resulting move set остаётся explicit `incomplete(...)`; поэтому расширение может дать existential attacker kill или defender survival, но не создаёт ложное universal conclusion.

Unknown-history root simple-ko-shaped tactical placement не создаёт child, записывается как ko-dependent boundary и не усиливает proof authority.

### Contract coverage

13 E2-8 tests фиксируют:

- authoritative immediate friendly connection;
- cut candidate;
- actual counter-capture;
- exact ladder pressure `2 -> 1`;
- exact net pressure `3+ -> 2`;
- legal three-ply snapback + sacrifice sequence;
- preparation `5 liberties -> 4 liberties` с передачей в существующий E2-6 layer;
- connection -> `proven-survival` только после actual Benson/pass-alive target;
- byte-for-byte preservation complete exact-4-lib defender expansion;
- unknown-root simple-ko fail-closed;
- Torus seam connection;
- Cube face-edge connection;
- deterministic repeated analysis.

Classifier integration в E2-8 отсутствует.

### E2-8 performance gate

```text
src/core/endgame/TacticalExtensionProofSearchGoAdapter.benchmark.test.ts
npm run benchmark:engine2:tactical
```

Benchmark использует реальные Torus/Cube topologies, 8 legal empty tactical/preparation points, 2 warmups + 20 samples, deterministic candidate/ko/reason assertions. Gross-regression ceilings: `p95 <= 250 ms`, `max <= 1000 ms`.

CI #805 benchmark results:

| Case | Points | Examined empty | Candidates | p95 ms | max ms |
|---|---:|---:|---:|---:|---:|
| Torus 9×9 | 81 | 8 | 8 | 7.479 | 7.676 |
| Torus 13×13 | 169 | 8 | 8 | 6.567 | 6.624 |
| Torus 19×19 | 361 | 8 | 8 | 14.960 | 15.148 |
| Cube 2×2 | 24 | 8 | 8 | 3.422 | 3.598 |
| Cube 4×4 | 96 | 8 | 8 | 5.675 | 5.906 |
| Cube 5×5 | 150 | 8 | 8 | 7.971 | 8.725 |
| Cube 7×7 | 294 | 8 | 8 | 15.158 | 15.277 |

Worst observed p95 = `15.158 ms`; worst max = `15.277 ms`.

Validation — CI #805:

```text
new E2-8 contract tests: 13/13 PASS
tactical benchmark cases: 7/7 PASS
full unit/coverage: 595 passed, 70 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

Temporary E2-8 benchmark CI step после измерения должен быть удалён перед merge; `benchmark:engine2:tactical` остаётся opt-in и воспроизводимым.

**E2-8 acceptance boundary закрыт. Следующий этап: E2-9 — semeai / seki proof.**

---

# 16. E2-9 — semeai / seki proof

Статус: **DONE / CONTRACT-TESTED / BENCHMARKED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/SemeaiSekiProof.ts
algorithm = semeai-seki-proof-v1
seki certificate = e2-9-closed-two-shared-liberties-authoritative-mutual-capture
```

E2-9 добавляет отдельный graph-native анализ пары opposing strings, имеющих хотя бы одну shared liberty. Он фиксирует shared/exclusive liberties, one-wave approach candidates, exact/conservative eye-space summaries и actual side-to-move, но не превращает арифметику liberties или shape labels в fate proof.

### Semeai proof boundary

Для каждой из двух target groups side to move независимо переводится в роль existing deterministic AND/OR stack:

```text
sideToMove == target.color -> defender
sideToMove != target.color -> attacker
```

Kill/survival query выполняется через существующий `TacticalExtensionProofSearchGoAdapter` E2-8. Поэтому captures, connections, snapback, ladder/net pressure, sacrifice, preparation, exact 3/4-lib expansion, one/two-lib positive terminals, Benson/pass-alive и ko/history boundary используются только с уже установленной ими proof authority.

Главное правило E2-9:

```text
failure to prove kill for black
+
failure to prove kill for white
!= SEKI
```

`unresolved`, `budget-exhausted`, incomplete attack/defense boundary или отсутствие найденного kill не создают life/seki conclusion.

### Positive seki certificate

`PROVEN_SEKI` в E2-9 имеет отдельный узкий certificate. Он допускается только для пары opposing strings, где одновременно доказано:

1. обе strings имеют **ровно одни и те же две shared liberties**;
2. exclusive liberties отсутствуют у обеих сторон;
3. shared-liberty empty boundary замкнут только на эти две liberties;
4. stone boundary не содержит третьих groups;
5. каждая shared liberty graph-native adjacent к обеим competing strings;
6. для **обоих цветов** и **обеих shared liberties** попытка initiation проверяется authoritative `GameEngine` transition;
7. illegal initiation считается отсутствием legal breach; legal initiation не должна сразу capture opponent;
8. после legal initiation opponent должен иметь authoritative legal reply на вторую shared liberty, и этот reply должен фактически capture initiating string;
9. unknown-root simple-ko на initiation/reply прекращает seki authority и возвращает `KO_DEPENDENT`/unresolved boundary.

Только полный набор этих mutual-capture проверок даёт `proven-seki`. Exclusive liberty, open empty boundary, third group, immediate initiating capture, невозможность refutation или иная неполнота возвращают `UNRESOLVED`.

Approach points в E2-9 — только one-wave graph-native candidates around exclusive liberties. Eye summaries переиспользуют E2-7 bounds; incomplete eye-space не усиливает seki authority. Renderer geometry и face coordinates не используются.

### Contract coverage

11 E2-9 tests фиксируют:

- deterministic shared/exclusive liberty accounting;
- one-wave approach candidates без fate inference;
- positive closed two-shared-liberty seki с четырьмя authoritative initiation/refutation checks;
- отказ от seki при exclusive liberty;
- отказ от positive certificate при third-group boundary;
- два failed/incomplete kill searches не превращаются в seki;
- positive semeai kill для side-to-move против opposing one-lib group;
- role mapping actual side-to-move для обеих target groups;
- Torus seam shared liberty;
- Cube face-edge shared liberty;
- deterministic repeated analysis.

Classifier integration в E2-9 отсутствует.

### E2-9 performance gate

```text
src/core/endgame/SemeaiSekiProof.benchmark.test.ts
npm run benchmark:engine2:semeai-seki
```

Benchmark измеряет graph-native E2-9 structural/seki-boundary analysis отдельно от potentially larger AND/OR kill search (`includeKillProofs=false`): реальные Torus/Cube topologies, 2 warmups + 20 samples, deterministic snapshot assertions. Gross-regression ceilings: `p95 <= 250 ms`, `max <= 1000 ms`.

CI #809 benchmark results:

| Case | Points | Shared | Black exclusive | White exclusive | Black approach | White approach | p95 ms | max ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Torus 9×9 | 81 | 1 | 3 | 3 | 7 | 7 | 2.361 | 2.723 |
| Torus 13×13 | 169 | 1 | 3 | 3 | 7 | 7 | 1.414 | 1.503 |
| Torus 19×19 | 361 | 1 | 3 | 3 | 7 | 7 | 3.524 | 4.682 |
| Cube 2×2 | 24 | 2 | 2 | 2 | 4 | 4 | 0.886 | 1.174 |
| Cube 4×4 | 96 | 2 | 2 | 2 | 5 | 5 | 1.720 | 2.133 |
| Cube 5×5 | 150 | 2 | 2 | 2 | 5 | 5 | 2.838 | 3.127 |
| Cube 7×7 | 294 | 2 | 2 | 2 | 5 | 5 | 5.559 | 6.821 |

Worst observed p95 = `5.559 ms`; worst max = `6.821 ms`.

Validation:

```text
new E2-9 contract tests: 11/11 PASS
semeai/seki benchmark cases: 7/7 PASS
full unit/coverage: 606 passed, 77 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
```

Code-head CI #808 прошёл normal gate полностью, включая Chromium E2E `72/72 PASS`. Benchmark CI #809 подтвердил unit/coverage, typecheck, build и `7/7` benchmark; его Chromium run получил `71/72` из-за timing-sensitive pre-existing opacity assertion (`1` ожидалось во время stone animation, sampled `0.993086`). E2-9 production semantics по этому unrelated E2E flake не менялись.

Temporary E2-9 benchmark CI step после измерения удаляется перед merge; `benchmark:engine2:semeai-seki` остаётся opt-in и воспроизводимым.

**E2-9 acceptance boundary закрыт. Следующий этап: E2-10 — transpositions + performance optimization.**

---

# 17. E2-10 — transpositions + performance optimization

Статус: **DONE / CONTRACT-TESTED / DIFFERENTIALLY VALIDATED / BENCHMARKED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/DeterministicAndOrProofSearch.ts
transposition policy = node-key-complete-frame-cache-v1
npm run benchmark:engine2:transpositions
```

E2-10 оптимизирует уже стабилизированную deterministic DFS semantics E2-4 без добавления новой proof authority. Transposition table создаётся заново для каждого search invocation и индексируется canonical `adapter.nodeKey(node)`.

### Cache soundness boundary

Canonical node key является частью semantic contract adapter-а: одинаковый key обязан означать одинаковое proof-relevant состояние, включая роль, target identity и используемый adapter-ом ko/history context. Existing Go node identity уже включает board signature, attacker/defender role, target color/crucial stones и previous-board signature.

Cache сохраняет только **полностью вычисленные frame results**:

```text
proven-kill
proven-survival
ko-dependent
unresolved
```

`budget-exhausted` frame **никогда не memoize-ится**. Поэтому частичный traversal, оборванный budget-ом, не может позднее стать proof authority через cache reuse.

Cache hit выполняется до списания node budget и не увеличивает `exploredNodes`: повторно доказанный semantic node не должен повторно оплачивать тот же search work. Table остаётся bounded текущим search invocation и максимум числом реально budget-charged completed nodes.

Сохраняются без изменений:

- attacker OR / defender AND semantics;
- move-set completeness (`complete`, certified `proof-safe-pruned`, explicit `incomplete`);
- stable `moveKey` ordering и duplicate-key rejection;
- ko/unresolved propagation;
- principal-variation choice;
- existential/universal proof boundaries.

Cached frame хранит logical `maxRelativeDepth`; при reuse `maxDepth` пересчитывается относительно текущей глубины, поэтому observability не зависит от того, была ли ветка вычислена повторно или получена из transposition table.

Для differential/performance diagnostics доступен `useTranspositions=false`; production/default path использует transpositions.

Новая observability:

```text
transpositionsEnabled
transpositionPolicy
transpositionHits
transpositionEntries
```

### Contract coverage

3 новых E2-10 tests расширили deterministic core suite с 14 до 17 тестов:

- completed semantic transposition сохраняет outcome/reason/PV/maxDepth относительно no-cache baseline и уменьшает charged nodes;
- cache hit не расходует node budget: fixed budget может завершить тот же proof с reuse, когда повторный traversal baseline уже exhaust-ит budget;
- `budget-exhausted` partial frame не попадает в transposition table.

### E2-10 performance gate

```text
src/core/endgame/DeterministicAndOrProofSearch.benchmark.test.ts
npm run benchmark:engine2:transpositions
```

Opt-in benchmark использует deterministic converging DAG глубины 15, 2 warmups + 20 samples. No-cache baseline обязан пройти обе сходящиеся ветви на каждом уровне; optimized path должен переиспользовать тот же canonical child. Benchmark одновременно проверяет outcome/reason/PV/maxDepth equality.

CI #818 benchmark result:

| Path | Explored nodes | Hits | Entries | median ms | p95 ms | max ms |
|---|---:|---:|---:|---:|---:|---:|
| no-cache baseline | 32767 | 0 | 0 | 13.901 | 15.314 | 17.003 |
| transposition cache | 15 | 14 | 15 | 0.018 | 0.043 | 0.118 |

Observed p95 speedup на этом synthetic converging workload: **356.14×**. Это performance evidence для duplicate-state reuse, а не обещание такого speedup на произвольной Go position.

Validation:

```text
new E2-10 contract tests: 3/3 PASS
DeterministicAndOrProofSearch suite: 17/17 PASS
transposition benchmark: 1/1 PASS
full unit/coverage: 609 passed, 78 opt-in benchmark cases skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
lint: 0 errors, 2 pre-existing TestCaseReplayService warnings
```

Code-head CI #817 прошёл normal gate полностью. Benchmark CI #818 прошёл benchmark и тот же normal gate полностью, включая Chromium `72/72 PASS`. Temporary benchmark CI step после измерения удалён; `benchmark:engine2:transpositions` остаётся opt-in и воспроизводимым.

Classifier integration и existing proof completeness/ko boundaries в E2-10 не расширялись.

**E2-10 acceptance boundary закрыт. Следующий этап: E2-11 — adversarial corpus + final evaluation.**

---

# 18. E2-11 — adversarial corpus + final evaluation

Статус: **DONE / ADVERSARIALLY VALIDATED / FINAL-EVALUATED / CI PASS / NOT CLASSIFIER-INTEGRATED**.

```text
src/core/endgame/testlab/Engine2AdversarialCorpus.ts
src/core/endgame/testlab/Engine2AdversarialCorpus.test.ts
src/core/endgame/testlab/Engine2FinalEvaluation.benchmark.test.ts
corpus = engine2-adversarial-corpus-v1
npm run benchmark:engine2:final-evaluation
```

E2-11 не добавляет новые fate semantics и не расширяет proof authority. Это фиксированный deterministic final-evaluation corpus поверх уже реализованных E2-1…E2-10 boundaries.

### Corpus boundary

Corpus содержит **17 независимых positive/adversarial cases** и покрывает:

- strict one-lib positive death и unknown-root-ko fail-closed;
- two-lib exhaustive/pruned positive agreement и remote-root-ko fail-closed;
- exact three-lib positive kill и explicit incomplete attacker boundary;
- exact four-lib positive kill;
- exact two-eye small eye-space и deliberate eye-space budget exhaustion;
- tactical connection с survival authority только через actual Benson/pass-alive;
- side-to-move semeai kill;
- positive closed mutual-capture seki certificate и third-group seki rejection;
- Torus seam и Cube face-edge graph-native behavior;
- transposition-cache semantic parity с no-cache baseline;
- incomplete defender universal-proof rejection;
- AND/OR node-budget exhaustion propagation.

Отдельный marker `mustNotProve` применяется к adversarial boundary cases. Final evaluation считает false authoritative conclusion, если такой case неожиданно превращается в `proven-dead`, `proven-kill`, `proven-survival`, `proven-seki` или соответствующий positive paired result.

Final corpus result в CI #829:

```text
total cases: 17
passed cases: 17
authoritative positive cases: 7
fail-closed adversarial cases: 7
false authoritative conclusions: 0
total explored nodes: 69
transposition hits: 1
```

Repeated corpus execution обязан совпадать byte-for-byte. Все 9 evaluation categories присутствуют в каждом accepted corpus version.

### Final performance evaluation

Opt-in benchmark выполняет 2 warmups + 20 measured full-corpus runs и одновременно проверяет deterministic snapshot equality.

CI #829 result:

| Metric | Result | Ceiling |
|---|---:|---:|
| median runtime | 20.378 ms | — |
| p95 runtime | 25.483 ms | 500 ms |
| max runtime | 26.740 ms | 2000 ms |

Это final corpus-level regression gate, а не оценка full-board classifier coverage. E2-7/E2-8/E2-9 и generic proof stack по-прежнему не интегрированы в classifier, поэтому E2-11 не делает утверждений о проценте автоматически классифицированных production groups.

Validation — benchmark/normal CI #829:

```text
E2-11 corpus tests: 4/4 PASS
corpus cases: 17/17 PASS
final evaluation benchmark: 1/1 PASS
full unit/coverage: 613 passed, 79 opt-in benchmark cases skipped
test files: 80 passed, 9 skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
lint: 0 errors, 2 pre-existing TestCaseReplayService warnings
```

Первый E2-11 CI #826 уже подтвердил corpus/benchmark, но остановился только на implicit-any типизации test harness; исправлены explicit callback parameter types, production proof semantics не менялись.

Temporary E2-11 benchmark CI step после измерения #829 удалён; `benchmark:engine2:final-evaluation` остаётся opt-in и воспроизводимым.

Classifier integration, move-set completeness authority, ko/history semantics, seki certificate и transposition authority в E2-11 не расширялись.

**E2-11 acceptance boundary закрыт. Запланированная экспериментальная последовательность Engine 2 E2-1…E2-11 final-evaluated; следующий этап этим документом не определён.**

---

# 19. CI / validation policy

Current foundation:

- Graph Core integrated;
- Benson/pass-alive integrated;
- strict one-lib integrated;
- root ko conservative;
- exhaustive two-lib retained as oracle;
- proof-pruned two-lib validated, not classifier-integrated;
- deterministic generic AND/OR core validated;
- Go proof-search adapter bridge validated;
- generic-path correctness/differential/performance gate passed;
- exact 3-lib attacker generation + complete defender enumeration validated;
- exact 4-lib attacker generation + complete defender enumeration validated;
- exact small eye-space bounds/vital-point analysis validated on strict regions;
- graph-native connection/cut/counter-capture/ladder/net/snapback/sacrifice/preparation candidates validated;
- connection survival authority is limited to actual Benson/pass-alive after authoritative transition;
- shared/friendly-shared/oversized/ko/budget eye-space boundaries remain explicit incomplete;
- tactical augmentation outside already-complete 3/4-lib defender sets remains explicit incomplete;
- semeai side-to-move kill/survival queries reuse existing proof authority without upgrading incomplete results;
- seki authority is limited to the explicit closed two-shared-liberty authoritative mutual-capture certificate;
- failure of both kill searches never implies seki;
- deterministic per-search transposition reuse validated against no-cache baseline;
- incomplete/budget-exhausted work cannot gain proof authority through cache reuse;
- fixed E2-11 adversarial/final corpus passed with zero false authoritative conclusions;
- no generic, E2-7, E2-8, E2-9, E2-10 or E2-11 classifier integration.

Scoped typecheck:

```text
npm run typecheck:engine2
```

Normal work PR gate:

```text
lint
test:coverage
typecheck:engine2
build:engine2
Chromium E2E
```

Benchmarks are opt-in; temporary CI benchmark steps must be removed before merge.

---

# 20. Metrics

Track false automatic statuses, precision/coverage, median/p95/max nodes/runtime, budget/ko/boundary unresolved counts, root/deep move counts, causal cone size, PV/max depth, transposition hits/entries, implementation complexity, dependency/license surface, maintainability, Cube/Torus graph consistency.

```text
precision first
coverage second
cost third
```

---

# 21. External references

GNU Go / tsumego.js / Darkforest / research solvers / KataGo may be used for architecture ideas, regression, benchmark, differential oracle or diagnostics subject to licenses. Они не являются production proof authority; GPL implementation code не копируется.

---

# 22. Roadmap

```text
E2-1   DONE — Graph Core
E2-2   DONE — strict one-liberty reader
E2-3a  DONE — sync two-lib exhaustive v2
E2-3b  DONE — adversarial / topology / ko / determinism
E2-3c  DONE — exhaustive benchmark -> Variant B
E2-3d  DONE — proof-safe pruning + differential + benchmark

E2-4a  DONE — deterministic generic AND/OR semantic core
E2-4b  DONE — Go adapter + one/two-lib proof-preserving terminal bridge
E2-4c  DONE — generic differential/performance gate
E2-5   DONE — exact 3-lib move generation + defender completeness + benchmark
E2-6   DONE — exact 4-lib move generation + defender completeness + benchmark
E2-7   DONE — exact small eye-space + bounds/vital points + benchmark
E2-8   DONE — connections / cuts / ladder-net pressure / snapback / sacrifice / preparation + benchmark
E2-9   DONE — semeai shared/exclusive/approach analysis + positive seki certificate + benchmark
E2-10  DONE — deterministic transposition cache + differential/performance gate
E2-11  DONE — adversarial corpus + final evaluation
```

E2-4/E2-11 overall acceptance boundary:

1. attacker OR / defender AND explicit;
2. every proof node deterministic and budgeted;
3. pruning only with explicit proof-safe certificate;
4. ko/history uncertainty stays `KO_DEPENDENT`/`UNRESOLVED`;
5. one/two-lib readers are proof-preserving subroutines, never heuristic labels;
6. Go adapter differentially agrees with specialised proofs on overlap;
7. exact 3-lib attacker set remains explicit incomplete, so no false survival;
8. exact 3-lib defender set is universal only when whole-board legality is complete and ko history is known/safe;
9. exact 4-lib attacker set remains explicit incomplete, so liberty reduction cannot become false survival proof;
10. exact 4-lib defender set is universal only when whole-board legality is complete and ko history is known/safe;
11. exact small eye-space authority is limited to strict target-only connected regions inside the explicit size/budget boundary;
12. shared/friendly-shared/oversized regions and ko/cycle/budget/non-local uncertainty remain incomplete conservative bounds;
13. eye-space bounds/vital points do not themselves produce `alive`, `dead` or `seki` and are not classifier-integrated;
14. E2-8 tactical labels are candidate evidence, not fate proofs;
15. connection produces survival authority only after the resulting target is actually Benson/pass-alive;
16. ladder/net labels encode exact liberty-pressure transitions, not a complete global ladder/net theorem;
17. tactical augmentation never upgrades an incomplete move set to complete, and unknown-root ko remains fail-closed;
18. semeai shared/exclusive liberties, approach candidates and eye summaries are evidence only, not fate labels;
19. semeai kill/survival authority comes only from existing deterministic proof search with actual side-to-move roles;
20. failure to prove kill for both colors never implies seki;
21. `proven-seki` requires the explicit closed two-shared-liberty mutual-capture certificate with authoritative initiation/reply legality и captures;
22. ko, open boundary, exclusive liberty, third-group interaction or failed mutual-capture refutation keeps seki unresolved;
23. transposition equality is trusted only through canonical adapter `nodeKey` including all proof-relevant target/role/history state;
24. only completed non-budget frames may be memoized; cache hits do not spend node budget and cannot upgrade incomplete proof semantics;
25. generic/E2-7/E2-8/E2-9/E2-10/E2-11 classifier integration remains outside this experiment's accepted scope; final evaluation does not itself authorize it;
26. fixed E2-11 corpus must remain deterministic and retain zero false authoritative conclusions on its marked fail-closed boundaries.

> Engine 2 автоматически ставит `alive`, `dead` или `seki` только там, где может предъявить законченное доказательство. Во всех остальных случаях правильный результат — `UNRESOLVED`.

---

# 23. E2-12b — Confidence Classifier Core

Статус: **DONE / CORE-ONLY / CORPUS-VALIDATED / BENCHMARKED / CI PASS / NOT PRODUCTION-INTEGRATED**.

```text
algorithm = engine2-confidence-classifier-v1
corpus = engine2-confidence-corpus-v1
default threshold = 0.90
npm run benchmark:engine2:confidence
```

## 23.1. Изменение направления верхнего слоя

Секции E2-1…E2-11 выше сохраняют историю и proof semantics без изменений. E2-12b добавляет **отдельный practical confidence layer** поверх существующих graph facts и proof/readers:

```text
Group
  ↓
shared EndgameGraphCore context
  ↓
structural / open-space / pressure / escape / enclosure features
  ↓
eyes / connections / cheap strict proof evidence
  ↓
deterministic independent confidence scores
  ↓
alive / dead / seki / unresolved
```

Ключевая смена product policy:

```text
failure to prove != negative confidence evidence
```

Proof stack E2-1…E2-11 остаётся strong evidence layer, но отсутствие proof больше не обязано блокировать heuristic high-confidence classification в новом core API.

`confidence` здесь — **детерминированный интерпретируемый score, а не статистически откалиброванная вероятность**. Значение `0.94` не означает доказанные 94% вероятности успеха/ошибки. Настоящая probability calibration отложена до появления корпуса реальных позиций.

E2-12b **не подключён** к `AssistedEndgameClassifier`, Endgame Review UI, rendering, scoring flow или automatic group statuses. Поэтому историческая proof-only production authority из секций выше остаётся действующей для пользовательской игры до отдельного E2-12c.

## 23.2. API и deterministic selection policy

Core API:

```text
classifyGroupConfidence(...)
classifyPositionConfidence(...)
```

Результат содержит:

```text
groupKey
label = alive | dead | seki | unresolved
scores = { alive, dead, seki }
threshold
features
reasons
proofEvidence
search diagnostics
```

Все scores ограничены `[0, 1]`, независимы и не обязаны суммироваться в `1`. Все weights, thresholds и caps собраны в одном versioned `DEFAULT_ENDGAME_CONFIDENCE_POLICY`; randomization и wall-clock-dependent scoring отсутствуют.

Default selection:

```text
unique score >= 0.90
and winner - runnerUp >= 0.05
    => winner
otherwise
    => unresolved
```

Если более одной категории одновременно достигают threshold, classifier возвращает `unresolved` с `confidence-conflict`; порядок iteration никогда не разрешает такой конфликт молча.

## 23.3. Feature extraction

`EndgameGroupFeatureExtractor` строит whole-position analysis context один раз и переиспользует существующий `EndgameGraphCore`. Используются только `Topology.points()` / `Topology.neighbors()` и graph BFS; renderer coordinates, rectangular edge/corner heuristics и Cube face layout в semantics отсутствуют.

Основные deterministic features:

- stone count, distinct liberties, immediate atari, large/very-large liberty signals;
- adjacent empty regions, total/largest open-space size и largest-region board fraction;
- largest-region frontier width, expansion liberties, broad escape liberties;
- contested liberties и contested-liberty ratio;
- direct enemy edges / outward edges и direct-enemy ratio;
- multi-source graph distance до ближайшего enemy;
- enemy stones/groups в fixed local graph radius и local enemy density;
- friendly connection count и shared-liberty count из существующего graph analysis;
- strict/friendly eye-region counts и bounded small-eye eligibility.

Escape breadth v1 — дешёвая approximation: несколько uncontested liberties должны вести дальше минимум в два empty neighbors; frontier width отдельно измеряет число target liberties, входящих в крупнейший open region. Large open region с frontier width `<=1` и без broad escapes получает explicit narrow-bottleneck evidence/cap.

Enclosure v1 использует direct enemy contact, contested liberties, local enemy density и отсутствие broad escape. Большое визуальное пустое пространство за enemy ring само по себе не повышает `alive`.

## 23.4. Proof / eye evidence

Cheap existing strict evidence имеет максимальный authority внутри confidence scorer:

```text
Benson/pass-alive                        -> alive = 1.0
strict automatic / one-lib proven dead -> dead = 1.0
strict closed mutual-capture seki      -> seki = 1.0
```

Дополнительно API принимает уже полученное strict `providedProofEvidence` от других Engine 2 readers без обязанности запускать их внутри confidence layer.

Отсутствие proof не уменьшает score автоматически. Generic/global AND/OR adapter **не импортируется и не запускается** classifier-ом.

`SmallEyeSpaceAnalyzer` вызывается только для structurally eligible strict small eye-space (`<=6` points) с bounded budget `512`; large sparse open-space cases до него не доходят.

Search diagnostics прямо фиксируют:

```text
deepProofSearchInvoked = false
localizedEyeSearchInvoked
localizedEyeExploredNodes
```

Whole-position result агрегирует `deepProofSearchInvocations = 0` и строит общий graph ровно один раз.

## 23.5. Scoring policy v1

Weights/caps являются hand-authored structural policy, **не обученными и не calibrated** coefficients.

Positive alive evidence включает large/very-large liberty set, large/very-large adjacent open region, broad escape count, wide frontier, distant/remote enemy, low local pressure, friendly connections и complete two-eye local analysis.

Dead pressure evidence включает atari, two-liberty danger, contested liberties, direct enemy contact, local enemy density, narrow bottleneck, отсутствие broad escape и small adjacent space.

Safety caps не позволяют одному положительному open-space signal пересилить явную опасность:

```text
atari alive cap             = 0.35
two-liberty alive cap       = 0.68
narrow-bottleneck alive cap = 0.82
local-enclosure alive cap   = 0.72
```

Обратные caps удерживают heuristic dead ниже threshold, если atari/two-lib group имеет реальное expansion пространство или broad open escape. High-confidence death без strict proof не выводится из одного liberty count.

## 23.6. Deterministic confidence corpus

Corpus содержит **16** carefully designed cases и прошёл **16/16**:

```text
alive       8
dead        1
seki        2
unresolved  5
```

Покрыты:

- sparse Torus 19×19 two-stone open-space;
- isolated sparse Torus 19×19 stone;
- Torus 13×13 / 9×9 open-space;
- Torus seam open group;
- Cube face-edge и representative open group;
- huge open space + immediate atari negative control;
- large region через narrow contested exit;
- Benson two-vital-region alive;
- existing strict one-lib death;
- strict seki certificate для обеих competing groups;
- ambiguous contact fight;
- one-eye/shared-space ambiguous case;
- contradictory provided high-confidence proofs.

Expectations используют meaningful ranges (`>=0.90`, `>=0.95`, exact `1.0` только для strict authority), а не brittle score equality до тысячных.

Targeted `EndgameConfidenceClassifier.test.ts`: **16/16 PASS**. Дополнительно проверены byte-for-byte determinism, high-confidence conflict fail-closed, Torus seam, Cube face adjacency и agreement whole-position/per-group при shared analysis context.

## 23.7. Главный sparse Torus 19×19 regression

Acceptance fixture: connected white two-stone group в огромном open region, remote black group, без atari/enclosure, с несколькими broad expansion directions.

Observed result:

```text
label = alive
scores = { alive: 1.000, dead: 0.060, seki: 0.020 }
threshold = 0.90
deepProofSearchInvoked = false
localizedEyeSearchInvoked = false
localizedEyeExploredNodes = 0
```

Таким образом очевидная sparse group классифицируется structural path-ом и не перечисляет gigantic tactical game tree.

Negative controls подтверждают противоположное:

- huge open space + immediate atari -> `unresolved`, alive ниже threshold;
- large region через narrow contested frontier -> `unresolved`, alive cap `0.82`;
- local enemy enclosure не получает high-confidence alive;
- ambiguous fight остаётся ниже threshold.

## 23.8. Performance gate

Opt-in benchmark:

```text
src/core/endgame/EndgameConfidenceClassifier.benchmark.test.ts
npm run benchmark:engine2:confidence
```

GitHub Actions Ubuntu 24.04 / Node 22.23.2, 2 warmups + 20 samples. Временный benchmark step был добавлен только для measurement CI #846 и после измерения удалён из CI workflow.

| Workload | Groups | Per-group median | Per-group p95 | Per-group max | Whole median | Whole p95 | Whole max |
|---|---:|---:|---:|---:|---:|---:|---:|
| sparse Torus 19×19 | 2 | 1.596 ms | 4.002 ms | 4.180 ms | 1.632 ms | 3.742 ms | 4.330 ms |
| medium-density Torus 19×19 | 25 | 1.624 ms | 1.873 ms | 1.926 ms | 2.033 ms | 2.284 ms | 2.376 ms |
| representative Cube 5×5 | 6 | 1.258 ms | 2.412 ms | 2.423 ms | 1.369 ms | 2.404 ms | 2.501 ms |
| multi-group Torus 19×19 | 36 | 1.784 ms | 2.882 ms | 2.973 ms | 2.539 ms | 3.865 ms | 3.968 ms |

Все четыре workload имеют `deepProofSearchInvocations = 0`.

Gross-regression ceilings зафиксированы консервативно:

```text
per-group p95 < 50 ms
per-group max < 200 ms
whole-position p95 < 100 ms
whole-position max < 400 ms
```

Observed worst p95/max: `4.002/4.180 ms` per-group и `3.865/4.330 ms` whole-position. Это core benchmark, не обещание UI latency на любом устройстве.

## 23.9. CI / validation

Clean code-head CI #845 на `c1cc4d538af1589cfec3f021521e7c2b69bfc157`:

```text
E2-12b targeted tests: 16/16 PASS
full unit/coverage: 629 passed, 83 opt-in tests skipped
test files: 81 passed, 10 skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
lint: 0 errors, 2 pre-existing TestCaseReplayService warnings
```

Measurement CI #846 на temporary benchmark head `9e0ff1d1bd2942aa09ae0816b9f4e478f0647fe8`:

```text
confidence benchmark: 4/4 PASS
full unit/coverage: 629 passed, 83 opt-in tests skipped
typecheck:engine2 PASS
build:engine2 PASS
Chromium E2E: 72/72 PASS
```

Temporary benchmark workflow step удалён после measurement; opt-in benchmark script сохранён. Final PR head обязан повторно пройти normal exact-head CI после documentation/cleanup commit; его exact SHA/run фиксируется в PR/final implementation report без изменения source semantics.

## 23.10. Remaining limitations / next

- scores v1 hand-authored и не statistically calibrated;
- local pressure radius и frontier bottleneck — deliberately cheap approximations, не graph-theorem enclosure solver;
- confidence layer не dispatch-ит global ladder/net/semeai/AND-OR reading автоматически; strict external evidence можно передать отдельно;
- only bounded eligible SmallEye analysis запускается внутри classifier;
- corpus intentionally small (16 designed cases), не представляет empirical real-game accuracy percentage;
- никакой UI/scoring/automatic-status authority в E2-12b не добавлена.

**E2-12b core acceptance boundary закрыт после final exact-head CI PASS. Следующий этап: E2-12c — Confidence Auto-Selection Core.**

---

# 24. E2-12c — Confidence Auto-Selection Core

Статус: **IMPLEMENTED / CORE-ONLY / VALIDATION IN PROGRESS / NOT APPLICATION-INTEGRATED**.

```text
selector algorithm = engine2-confidence-auto-select-v1
selector corpus = engine2-confidence-auto-selection-corpus-v1
raw classifier = engine2-confidence-classifier-v1
```

E2-12c добавляет отдельный application-level policy/composition layer **поверх** E2-12b и не меняет значение raw classifier result:

```text
Position confidence result
  ↓
strict authority, если уже доступна
  ↓
иначе deterministic max score
  ↓
alive / dead / seki
  +
high / medium / low metadata
```

Raw E2-12b продолжает отвечать на вопрос «достаточно ли силён high-confidence conclusion?» и может законно вернуть `label = unresolved` из-за threshold/dominance policy. E2-12c отвечает на другой вопрос: «какой initial automatic status лучше выбрать для valid group?». Поэтому raw `unresolved` **не является** application `unresolved`.

Пример:

```text
scores = { alive: 0.46, dead: 0.43, seki: 0.11 }
raw label = unresolved
auto selection = alive / low / confidence
```

`score` по-прежнему не является probability. `confidenceBand` — deterministic product metadata, без statistical calibration claim.

## 24.1. Strict proof precedence

Already-computed strict evidence имеет абсолютный приоритет над heuristic max score:

```text
strict alive + confidence dead winner -> alive / strict-proof
strict dead  + confidence alive winner -> dead / strict-proof
strict seki  + confidence alternative -> seki / strict-proof
```

Selector использует proof evidence, уже embedded в E2-12b result, и при необходимости принимает дополнительное **already-computed** strict evidence. Он сам не запускает proof search.

Если одновременно присутствуют разные strict authoritative labels, например `alive + dead`, это invariant violation. Selector возвращает explicit `technical-failure / contradictory-strict-authority`; tie policy к strict conflict не применяется.

## 24.2. Confidence max-score policy

Если strict authority отсутствует, valid normal input всегда получает один из:

```text
alive
dead
seki
```

Выбирается реальный максимальный score. Threshold `0.90`, маленький margin или raw `unresolved` не отменяют initial auto-selection.

Exact equality разрешается централизованной versioned policy:

```text
alive > dead > seki
```

Этот порядок применяется **только** к exact equality top scores. Near tie не является tie:

```text
alive=.460 dead=.459 seki=.081 -> alive
```

Никакие object/Map/array incidental iteration orders не определяют outcome.

## 24.3. Confidence bands

Thresholds находятся только в `EndgameConfidenceAutoSelectionPolicy`:

```text
HIGH:
  raw E2-12b уже выбрал тот же status
  OR winner >= 0.90 AND margin >= 0.05

MEDIUM:
  winner >= 0.65
  AND HIGH не выполнен

LOW:
  любой другой valid confidence selection
```

Low/medium confidence не являются technical unresolved. Technical failure существует отдельно и допускается только для malformed/invariant-broken input.

## 24.4. Validation / technical failure boundary

Selector fail-closed проверяет:

- algorithm/source identity;
- non-empty group identity;
- raw label shape;
- required `alive/dead/seki` scores;
- finite scores в `[0,1]`;
- valid reason/proof arrays;
- valid versioned selector policy;
- internally consistent strict authority.

`NaN`, `Infinity`, negative и `>1` scores не clamp-ятся. Malformed input возвращает explicit `technical-failure`, а не normal low-confidence choice.

## 24.5. Determinism и position-level composition

`selectAutomaticEndgameStatus(...)` не импортирует и не вызывает raw classifier API. `selectAutomaticPositionStatuses(...)` принимает уже вычисленный `classifyPositionConfidence(...)` snapshot, сортирует existing results по stable `groupKey` и применяет selector без повторного анализа позиции.

Diagnostics фиксируют:

```text
additionalGraphBuilds = 0
additionalConfidenceAnalyses = 0
deepProofSearchInvocations = 0
```

Нет random, timestamps, wall clock или unstable iteration ordering. Repeated selector execution покрыто byte-for-byte deterministic tests.

## 24.6. Designed corpus

Отдельный deterministic corpus содержит 20 cases:

- high / medium / low alive;
- high / low dead;
- high / medium seki;
- raw unresolved -> auto alive/dead/seki;
- exact alive/dead tie;
- exact dead/seki tie;
- exact three-way tie;
- near tie;
- strict alive/dead/seki override heuristic winner;
- contradictory strict authority -> technical failure;
- Torus seam source result;
- Cube face-edge source result.

Expected initial metrics:

```text
total cases = 20
valid normal cases = 19
automatic selections = 19
technical failures = 1
strict selections = 3
confidence selections = 16
high / medium / low = 8 / 2 / 9
exact ties = 3
raw unresolved cases = 12
raw unresolved auto-selected = 11
deterministic mismatches = 0
designed-corpus agreement = 20/20
valid-normal automatic coverage = 100%
```

Technical-conflict fixture исключён из normal coverage denominator. `designed-corpus agreement` не называется real-Go accuracy: corpus детерминированный и hand-designed, а не statistically representative dataset.

Existing E2-12b 16-case corpus остаётся отдельным raw regression contract и не переписывается под 100% auto-selection coverage.

## 24.7. Tests / performance boundary

`EndgameConfidenceAutoSelector.test.ts` покрывает:

- high/medium/low bands;
- all three raw-unresolved auto selections;
- strict precedence и embedded proof evidence;
- exact/near ties;
- contradictory strict authority;
- malformed/missing/NaN/Infinity/out-of-range scores;
- invalid group/raw label/policy;
- raw E2-12b immutability;
- E2-12b 16-case corpus preservation;
- E2-12c designed corpus metrics/coverage;
- Torus seam / Cube face-edge;
- byte-for-byte determinism;
- deterministic position ordering;
- prepared 36-group position with zero additional graph/classifier/deep-search work.

Отдельный E2-12c timing benchmark не добавлялся: selector — pure O(groups) composition over prepared confidence snapshot, а performance contract закреплён direct diagnostics и 36-group selector-only regression. Existing E2-12b confidence benchmark остаётся неизменённым.

## 24.8. Explicit non-integration boundary

E2-12c **не подключает selector к Endgame Review или scoring**.

На этом этапе также не реализуются:

- automatic UI fill;
- floating Alive/Dead/Seki UI changes;
- player override;
- Finish scoring;
- `JapaneseScoring` / `ChineseScoring` integration;
- persistence;
- Undo/Redo lifecycle;
- GameSession lifecycle;
- async stale-result handling;
- UI confidence labels;
- new browser E2E flow.

Production Endgame Review semantics не переключаются этим core PR.

## 24.9. CI / completion

Source head normal CI выполняется через стандартный gate:

```text
lint
test:coverage
typecheck:engine2
build:engine2
Chromium E2E
```

Финальный exact-head CI после этого documentation commit должен быть записан здесь и в Draft PR body перед merge readiness.

**Следующий этап строго: E2-12d — Endgame Review / scoring / player override application integration.**
