# Rick Loop — Final Experiment Audit

Scope: TASK-01 through TASK-16, plus the governance items (OWNER-01, OWNER-02,
ARCH-01, ARCH-02, ARCH-04) that ran alongside them.

Stop condition: the owner ended the experiment at TASK-16 on 2026-09-19.
TASK-17 is not part of this audit and remains pending.

## How to read this document

Every claim carries one of four labels. Nothing is estimated, and nothing is
scored.

| Label | Meaning |
| --- | --- |
| **PROVEN** | Verified from repository facts, CI runs, or published review verdicts |
| **PARTIALLY PROVEN** | Evidence exists for part of the claim; the gap is named |
| **NOT TESTED** | No evidence exists either way |
| **FAILED** | Attempted and did not work |

Where a metric was not measured, it says so. There are no invented numbers and
no quality ratings.

---

## 1. Tasks completed and incomplete

**PROVEN.** Source: `docs/roadmap/ROADMAP.md`, `git log`, PR merge state.

| Range | Status |
| --- | --- |
| TASK-01 … TASK-15 | Completed, merged, post-merge validated |
| TASK-16 | **BLOCKED_AWAITING_STAGING** — partial delivery merged (#47, `bce05ba`), `done_when` not met |
| TASK-17 | Pending; out of experiment scope by owner decision |

Checked-off `TASK-*` entries: 15. Unchecked: 2 (TASK-16, TASK-17).

Governance items: ARCH-01 RESOLVED, ARCH-02 RESOLVED_MERGED, ARCH-04 COMPLETED,
ARCH-05 OPEN (non-blocking), ARCH-03 OPEN and **untracked** — it has no
`ROADMAP.md` entry and is therefore invisible to the deterministic resolver.

### TASK-16 disposition

**PARTIALLY PROVEN, deliberately.** `done_when` is *"homologação disponível,
smoke remoto aprovado e sem credenciais expostas"*.

| Clause | Status |
| --- | --- |
| sem credenciais expostas | **PROVEN** — `scripts/secrets-hygiene-check.mjs`, green in CI on PR #47, wired into `npm test` and `validate.yml` |
| homologação disponível | **NOT TESTED** — no Vercel project, staging database, or deploy credential exists |
| smoke remoto aprovado | **NOT TESTED** — `scripts/remote-smoke-check.mjs` exists and its failure paths are proven, but it has never run against a deployment |

PR #47 delivered the environment-independent half and merged at `bce05ba`
after **5 review rounds**: the credentials guard, the read-only remote smoke,
`GET /api/version`, and a suite exercising every guard rule's rejection path.

The roadmap entry stays **unchecked** on purpose. Checking it would make
`resolveNextEligibleTask` advance to TASK-17, contradicting both the stop
condition and the task's real state. Verified after reconciliation: the
resolver returns TASK-16, not TASK-17.

The provider was never an open question: `docs/product/PROJECT-SDD.md:26`
mandates Vercel. What is missing is provisioning, which requires an account,
cost, and credentials — owner actions.

---

## 2. Execution duration

**PARTIALLY PROVEN.** Wall-clock span is measurable; actual working time is not.

- First commit: **2026-08-05**. Last commit in scope: **2026-09-19**.
- Calendar span: **46 days**.
- Days with commit activity: **14**.
- Commits on `main`: **89**.

Per-task duration is **NOT TESTED**: the register records events, not
start/stop timestamps, so time-per-task cannot be derived without inventing it.

---

## 3. Pull requests and review rounds

**PROVEN.** Source: `gh pr list`, `LOOP-REGISTER.jsonl`.

| Metric | Value |
| --- | --- |
| PRs merged | **43** |
| PRs closed unmerged | 2 |
| PRs open at experiment end | 2 — #48 (this audit) and **#21**, a loop fix opened 2026-08-20 and never merged or closed |
| Review rounds (register-derived total) | **89** |
| Review rounds (max-per-PR sum, 24 PRs with rounds recorded) | **103** |

`#21` is worth naming rather than folding into a count: it has sat open since
August, is not referenced by any later work, and nothing in the loop surfaced
it. An abandoned PR is invisible to every gate here.

The two totals differ because `rick-loop-stats.mjs` counts `review_round`
events while the per-PR tally takes the highest round reached on each PR;
neither is wrong, and both are reported rather than picking the flattering one.

Heaviest PRs by rounds: **#17 (10)**, **#37 (10)**, **#14 (9)**, **#24 (7)**,
**#25 (6)**, **#36 (6)**.

---

## 4. Findings by severity and recurring defect class

**PARTIALLY PROVEN.** Severity is only partially recoverable.

- Finding fields recorded: **182**
- Explicitly `P1_`-prefixed: **22**
- Explicitly `P2_`-prefixed: **40**
- Recorded without a severity prefix: **120**

The 120 unprefixed findings carry descriptive class names but no severity, so
**no severity distribution can be computed for the majority of findings**. That
is a defect in the register's own schema, not a gap to be filled by guessing.

Findings counted by `rick-loop-stats.mjs`: **186** across **165+** distinct
classes. The two totals (182 by field scan, 186 by the stats script) differ
because the script counts some composite fields the scan treats as one; both
are reported rather than picking whichever reads better.

### Recurring classes

By exact name, only three classes repeat:

| Count | Class |
| --- | --- |
| 2 | `MERGE_OCCURRED_BEFORE_REQUIRED_INDEPENDENT_REVIEW_RESULT_WAS_PUBLISHED` |
| 2 | `TASK_CLOSED_BEFORE_POST_MERGE_VALIDATION_WAS_RECORDED` |
| 2 | `HANDOFF_RESUME_NARRATIVE_DESCRIBED_A_POSITION_TWO_TASKS_OUT_OF_DATE` |

Exact-name counting **undercounts badly**, because the same semantic defect was
recorded under many different names. The dominant recurring class is:

> **A pointer or field advances while the prose or metadata explaining it keeps
> describing the prior state.**

Counted semantically: **8 occurrences** during ARCH-04 (recorded in ARCH-05's
`recurrence_evidence`), plus **5 more** in the TASK-15/16 sequence (PRs #42,
#43, #45, #46 round 1, #46 round 2) — **13 total**. Every one was found by
independent review or by `detectStateDrift`; **none** by a check that reads
narrative, because no such check exists.

A second class emerged in TASK-16 and is worth separating: **a guard that
scans tracked files turns every document quoting a credential shape into
another occurrence.** Seven self-references resulted — the guard's own pattern
constants, its test file, its changelog entry, a regression fixture, a register
entry written one commit after the lesson warning against it, and finally the
per-rule reject fixtures. Six were answered with allowlist entries or
rewording; the seventh was answered structurally, with a single excluded
fixtures path whose narrowness the suite asserts.

A third class is the most uncomfortable, and it only became visible because
PR #47 ran to five rounds: **the loop's self-assessment artifacts were less
reliable than its implementation.** Three of those five rounds found defects in
tests and evidence rather than in shipped behaviour —

1. a guard whose rejection rules had no failing-case test for five of seven
   rules, in a suite whose own header says a guard that has only ever passed
   is indistinguishable from one that cannot fail;
2. an evidence document claiming ACs were "PROVADO — com asserção sobre falha"
   when no such assertion existed for five of them;
3. smoke coverage that proved only the failure paths, while the spec had
   promised the healthy-instance path too.

Each was written by the same process that was supposed to be checking the
work. Independent review caught all three; no gate did, and no gate could —
they are claims about whether evidence is adequate, not facts a script can
compare.

---

## 5. CI and validation failures

**PROVEN.** Source: GitHub Actions.

| Workflow | Outcome counts (200 most recent runs) |
| --- | --- |
| `Validate` | 198 success, **2 failure** |
| `Claude PR Review` | 76 success, 17 cancelled, 3 failure, 2 skipped |

Validation failures recorded in the register: `validation_attempts: 1`,
`validation_failures: 0` (ARCH-04). The authoritative-validation path was
therefore exercised **once**; `rick-validator` invocation across the run is
**PARTIALLY PROVEN** at best.

The two `Validate` failures in TASK-16 were both caused by the secrets guard
failing on its own source once its files became tracked — a defect CI caught
that local runs structurally could not, because `git ls-files` did not list the
still-untracked guard.

---

## 6. Human interventions

**PROVEN.** Seven register entries record human or external intervention:

| Task | Status | Cause |
| --- | --- | --- |
| TASK-06 | `BLOCKED_EXTERNAL_REVIEW` | external reviewer unavailable |
| TASK-12 | `OWNER_DECISION_RESOLVED` | OWNER-01, dashboard row semantics |
| TASK-12 | `BLOCKED_EXTERNAL` | reviewer unavailable |
| OWNER-02 | `OWNER_DECISION_AUTHORIZED` | review-trigger economics authorised |
| ARCH-04 | `BLOCKER_DISCOVERED` | action cannot review its own workflow file |
| ARCH-04 | `OWNER_DECISION_AUTHORIZED` | staged secondary-reviewer bootstrap |
| ARCH-04 | `PROCESS_VIOLATION_SELF_REPORTED` | **self-inflicted**, see §11 |

Owner decisions were genuinely decisions the loop could not make: product
semantics (OWNER-01), governance authorisation (OWNER-02), and an architecture
choice when the review tooling proved structurally unable to review itself.

---

## 7. Recovery after interruption

**PROVEN for the cases that occurred.**

- **Notebook shutdown mid-loop**: recovery succeeded. Repository facts were
  reconstructed from git, PR state, and CI rather than from the stale
  STATE/HANDOFF, which had drifted. The uncommitted working-tree change was
  preserved rather than discarded.
- **Usage-limit interruptions**: the loop resumed and continued without
  repeating completed work.
- **Review infrastructure failures**: a dispatched review run failed with no
  verdict; the dispatcher classified it as retryable and re-dispatched after
  the fix, rather than treating it as a finding or as a clean result.

**FAILED, then fixed**: the HANDOFF resume path itself twice contained
instructions that would have misdirected a recovering operator (PR #45, PR #46)
— precisely the document recovery depends on. Both were caught by independent
review, not by the loop.

---

## 8. State consistency and persistence

**PROVEN with a named limit.**

- `LOOP-REGISTER.jsonl`: **154+ entries, 0 invalid JSON lines** across the run.
- `detectStateDrift` caught pointer drift repeatedly and **blocked merges**
  while red.
- `roadmap_pointers_agree` (added PR #39) mechanically compares ARCH-04's
  `impl_branch`, `impl_stage`, `next_action` across STATE, HANDOFF and ROADMAP,
  and fails closed when a source cannot be consulted at all.

**The limit:** these gates compare *fields*. Thirteen occurrences of the
dominant defect class lived in prose and untracked metadata that no gate reads.
`updated_at` staleness was flagged as mechanically checkable but **NOT
implemented**.

One deliberate deviation is disclosed: an already-pushed register line was
reworded on an unmerged branch (PR #47) rather than permanently weakening the
secrets guard with a fifth allowlist entry. It never reached `main`. Recorded
in the register rather than done quietly.

---

## 9. SDD and Definition of Done compliance

**PARTIALLY PROVEN.**

| Range | Spec | Evidence doc |
| --- | --- | --- |
| TASK-01 … TASK-08 | **absent** | present |
| TASK-09 … TASK-15 | present | present |
| TASK-16 | present | pending closure |

Spec-driven development began at **TASK-09**. The first eight tasks have
validation evidence but no spec, so *"AC proved by test, not inspection"*
cannot be verified for them: there are no ACs to check against.

Where specs existed, the gate demonstrably worked. The TASK-15 spec took **5
review rounds** and caught **8 defects before any implementation existed**:
a field the API does not accept, a route that does not exist, a cleanup the
database makes impossible, a formula missing `quantity`, a field attributed to
the wrong record, the wrong request shape, an internal contradiction, and a
false premise about business-day classification. Each would have been fatal or
misleading to code against.

---

## 10. Review quality and exact-head enforcement

**PROVEN.**

`evaluateMergeAllowed`, `isCleanReviewResult`, `countUnresolvedFindings`,
`selectMergeResult`, `buildAnchoredResults` and `filterAnchoredCleanComments`
were **not modified by any of the 43 merged PRs**.

Three live demonstrations that the gate outranks judgement:

1. **PR #40** — the secondary reviewer published `No major issues found.` on the
   exact HEAD, and the gate still returned `allowed: false` because a second
   independent reviewer had filed an unresolved P1 against that HEAD.
2. **PR #39** — CI green and review clean on the exact HEAD, and preflight
   still blocked the merge on `no_state_drift`.
3. **PR #45** — a finding I judged spurious, and demonstrated spurious with
   `git show` evidence, still produced a FINDINGS verdict with no clean review,
   so the gate refused. My belief that a finding was wrong is not evidence, and
   the gate correctly declined to accept it.

Three findings were declined on evidence during the run, each verified line by
line against the reviewed commit before replying. In each case the finding had
been real on an earlier HEAD and was re-posted against the commit that fixed it.

---

## 11. ARCH-04 review-cost optimisation

**PROVEN.** This is the clearest measured result of the experiment.

| Period | Trigger | Runs | Cancelled | Failure | Skipped | Success |
| --- | --- | --- | --- | --- | --- | --- |
| Before cutover | `pull_request` | 81 | **16** | 3 | 2 | 60 |
| After cutover | `workflow_dispatch` | 18 | 1 | 0 | 0 | 17 |

The **16 cancelled pre-cutover runs** are the measurable waste: model
invocations killed mid-execution by a subsequent push, spend incurred with no
verdict produced. After the cutover, one cancellation in eighteen runs.

### Acceptance evidence (`docs/evidence/ARCH-04-validation.md`)

| Criterion | Status |
| --- | --- |
| Multiple pushes trigger no review | **PROVEN** — 9 pushes on PR #41, 0 review runs created |
| One authorised HEAD → exactly one review | **PROVEN** — run 35366498301, real exact-head verdict |
| Duplicate dispatch prevented | **PROVEN** — refused in both `IN_FLIGHT` and `REVIEWED` states |
| Dispatcher fails closed | **PROVEN** — refused on `ci_not_green` with preflight 9/9 |
| Trusted workflow definition executes | **PROVEN** — `headBranch=main` on dispatched runs |
| Stale HEAD cannot invoke the model | **PROVEN** — live HEAD revalidation in-job |
| Findings trigger correction and re-review | **PROVEN** — repeatedly, across PRs #41–#47 |

The acceptance test **failed the first version of Stage 3** and that is
recorded: the secondary reviewer was still invoking the model on every push
(runs 35365924867, 35365946583), one of which was cancelled mid-run. A test
that only ever passes proves nothing.

### A consequence that must not be lost

After the cutover, a `workflow_dispatch` run **does not attach to the PR as a
check**. `quality` is the only check. Nothing in the GitHub UI turns red when a
review is missing or returns findings. The gate has always keyed on the
exact-head verdict *comment*, so this is correct by design — but it means **a
green check now proves nothing about review**, and `evaluateMergeAllowed` is
the only thing between a PR and an unreviewed merge.

---

## 12. Token and monetary usage

**PARTIALLY PROVEN.** Only dispatched reviews expose per-run cost.

| Run | Turns | `total_cost_usd` |
| --- | --- | --- |
| 35366498301 | 45 | 1.1354 |
| 35367527590 | 35 | 1.1360 |
| 35368576709 | 42 | 1.0758 |
| 35371233781 | 35 | 0.8319 |
| 35372223648 | 42 | 1.0579 |
| 35373155631 | 27 | 0.5799 |

Six reviews, **$5.82 total, mean $0.97**, range $0.58–$1.14.

**NOT TESTED / unavailable:**
- Total experiment cost across all 99 review runs.
- Cost of the 16 cancelled runs — the result line never printed, so the spend
  is real but unrecoverable from logs.
- Token usage for the agent driving the loop; no instrumentation existed.

Extrapolating the mean across all runs would produce a plausible-looking number
with no evidence behind it, so it is not done here.

---

## 13. Measured improvement, before versus after governance changes

**PROVEN for review economics** (§11). **NOT TESTED for defect rate**: findings
are not severity-classified for 116 of 174 records, so a before/after defect
comparison cannot be computed honestly.

One improvement is measurable beyond cost: after `roadmap_pointers_agree`
landed in PR #39, the drift class it covers was caught **by machine** on the
gate's own PR — CI green, review clean, and preflight still refused. Before
that, every instance was caught by a human reviewer.

---

## 14. Remaining architecture gaps

**PROVEN as open.**

1. **ARCH-05** (tracked, non-blocking) — the six OWNER-02 items ARCH-04 did not
   own: full pointer consistency, register integrity beyond line-level JSON,
   `current_task`/`next_eligible_task` semantics, remote-first reconciliation,
   review usage metrics.
2. **Narrative and metadata drift** — 13 occurrences, no mechanical coverage.
   `updated_at` staleness is checkable against the file's own commit timestamp
   and remains unimplemented.
3. **ARCH-03** — untracked, resolver-invisible. Cannot be selected by the loop.
4. **Severity taxonomy** — the register has no enforced severity field, which
   is why §4 cannot report a distribution.
5. **Spec coverage for TASK-01…08** — retroactive specs do not exist and were
   not attempted.
6. **The green-check gap** (§11) — a human reading the PR UI after ARCH-04 sees
   only `quality` and cannot tell whether a review happened.

---

## 15. Components suitable for reuse in RCC

**Reusable as-is**, each PROVEN in production here:

| Component | Why |
| --- | --- |
| `evaluateMergeAllowed` and its helpers | Never weakened across 41 merges; demonstrably outranked reviewer judgement three times |
| `rick-loop-preflight.mjs` | Nine fail-closed checks; blocked real merges, including its own PR |
| `rick-loop-review-dispatch.mjs` | Dispatch economics with measured effect; idempotent in both in-flight and reviewed states |
| Exact-head verdict contract | `Reviewed commit: <sha>` + explicit clean phrase + independent author + zero unresolved findings |
| Schema-isolation test pattern (TASK-15) | Makes data safety structural rather than disciplinary |
| Ephemeral Playwright policy | Artifacts deleted, only summaries persist; wider E2E at roadmap end |

## 16. Components requiring correction before reuse

| Component | Required correction |
| --- | --- |
| `LOOP-REGISTER` schema | Add an enforced severity field; 116 of 174 findings are unclassifiable |
| Narrative/metadata consistency | No gate reads prose. At minimum, implement the `updated_at` freshness check |
| `secrets-hygiene-check.mjs` | Works, but produced five self-references; needs a principled exclusion for its own fixtures rather than allowlist growth |
| Existing integration checks | `prisma.sale.delete(...)` with an empty `catch` reports cleanup success having deleted nothing — the cause of accumulated dev data |
| Spec gate | Should be mandatory from task 1, not introduced at TASK-09 |
| Review-cost accounting | Instrument total spend; only 6 of 99 runs have recoverable cost |
| `ARCH-03`-style items | Any architecture item without a `ROADMAP.md` entry is invisible; require entry on creation |

---

## Summary of what this experiment demonstrated

**PROVEN:** a deterministic, fail-closed merge gate held for 41 merges without
being weakened, including against the agent's own judgement. Review-trigger
economics produced a measurable reduction in wasted model invocations. A spec
gate, where present, caught defects before implementation at a rate that
justified its cost.

**FAILED and recorded:** the first Stage 3 cutover, caught by its own
acceptance test. Two CI failures from a guard that could not see its own
source. A handoff document that twice would have misdirected the recovery it
exists to guide.

**NOT TESTED:** everything requiring a deployed environment, and the majority
of cost and severity accounting.

The single most repeated defect was not in code. It was **a pointer advancing
while the prose explaining it stayed behind** — thirteen times, never caught by
a gate, because no gate reads prose.
