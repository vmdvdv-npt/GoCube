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
Connections / ladder / net / snapback / sacrifice
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

**E2-4 correctness + differential + performance boundary закрыт. Следующий этап: E2-5 3-lib move generation.**

---

# 12. Future stages

## E2-5 / E2-6 — 3 and 4 liberties

```text
4 liberties -> attack -> 3 liberties -> attack -> 2-lib -> 1-lib
```

Liberty reduction сама по себе не proof kill. Defender AND completeness / proof-safe relevance обязательны.

## E2-7 — exact small eye-space

Graph-native `minEyes/maxEyes/attackVitalPoints/defenseVitalPoints`, включая false eyes, shared space, Torus seam, Cube edges. Non-strict analysis может только order/reduce search, но не label fate.

## E2-8 — connections / tactical extensions

Forced connection, cut, counter-capture, ladder, net, snapback, sacrifice, preparation moves. `potential connection != proven connection`.

## E2-9 — semeai / seki

Shared/exclusive liberties, approach moves, captures, eyes, connections, side to move, ko.

```text
failure to prove kill for black
+
failure to prove kill for white
!= SEKI
```

Seki требует отдельного positive proof. Ko/incomplete → `UNRESOLVED`.

## E2-10

Transpositions + performance optimization only after baseline deterministic DFS semantics stabilize.

## E2-11

Adversarial corpus + final evaluation.

---

# 13. CI / validation policy

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
- generic Go move generation explicitly incomplete;
- no generic classifier integration.

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

# 14. Metrics

Track false automatic statuses, precision/coverage, median/p95/max nodes/runtime, budget/ko/boundary unresolved counts, root/deep move counts, causal cone size, PV/max depth, implementation complexity, dependency/license surface, maintainability, Cube/Torus graph consistency.

```text
precision first
coverage second
cost third
```

---

# 15. External references

GNU Go / tsumego.js / Darkforest / research solvers / KataGo may be used for architecture ideas, regression, benchmark, differential oracle or diagnostics subject to licenses. Они не являются production proof authority; GPL implementation code не копируется.

---

# 16. Roadmap

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
E2-5   NEXT — 3 liberties
E2-6   4 liberties
E2-7   exact small eye-space
E2-8   connections / snapback / ladder / net / sacrifice
E2-9   semeai / seki proof
E2-10  transpositions + performance optimization
E2-11  adversarial corpus + final evaluation
```

E2-4 overall acceptance boundary:

1. attacker OR / defender AND explicit;
2. every proof node deterministic and budgeted;
3. pruning only with explicit proof-safe certificate;
4. ko/history uncertainty stays `KO_DEPENDENT`/`UNRESOLVED`;
5. one/two-lib readers are proof-preserving subroutines, never heuristic labels;
6. Go adapter differentially agrees with specialised proofs on overlap;
7. no classifier integration before generic correctness + performance + differential gates.

> Engine 2 автоматически ставит `alive`, `dead` или `seki` только там, где может предъявить законченное доказательство. Во всех остальных случаях правильный результат — `UNRESOLVED`.