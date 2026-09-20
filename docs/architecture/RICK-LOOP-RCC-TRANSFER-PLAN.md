# Rick Loop → RCC Transfer Plan

What to carry from this experiment into RCC, what to fix first, and what not to
carry. Every recommendation names the evidence behind it; where the experiment
produced no evidence, the item says so rather than guessing.

---

## Transfer in three tiers

| Tier | Meaning |
| --- | --- |
| **A — port as-is** | Proven in production here; behaviour verified, not assumed |
| **B — port after correction** | Valuable, with a named defect that must be fixed first |
| **C — do not port** | Either unproven, or actively misleading |

---

## Tier A — port as-is

### A1. The merge gate

`evaluateMergeAllowed`, `isCleanReviewResult`, `countUnresolvedFindings`,
`selectMergeResult`, `buildAnchoredResults`, `filterAnchoredCleanComments`.

**Evidence:** unmodified across 43 merged PRs. Outranked judgement three times:
refused a HEAD whose top-level verdict said clean because another reviewer had
an unresolved P1 (#40); refused on `no_state_drift` with CI green and review
clean (#39); refused a verdict I had demonstrated was spurious (#45).

**Port unchanged.** Its value comes precisely from not being adjustable in the
moment.

### A2. The exact-head verdict contract

A clean review requires: `Reviewed commit: <sha>` naming the exact HEAD, an
explicit clean phrase, an author independent of the PR author, and zero
unresolved findings anchored to that HEAD.

**Evidence:** `countUnresolvedFindings` correctly excluded `isOutdated` threads
anchored to superseded HEADs while counting the live one — observed on #44.

**Port unchanged**, including the independence requirement. An earlier defect
(`CLEAN_VERDICT_FROM_ONE_AUTHOR_MARKED_ANOTHER_AUTHORS_REVIEW_CLEAN`) shows
what its absence costs.

### A3. Fail-closed preflight

`rick-loop-preflight.mjs`: nine checks, every one failing closed, where an
unevaluable check is a failure rather than a silent pass.

**Evidence:** blocked its own PR (#39). Blocked #47's review dispatch while CI
was red, so no model invocation was spent on a broken build.

**Port**, and keep the property that a check which cannot be evaluated fails.
That was itself a review finding (`COMPAREPOINTERS_DEGRADED_SILENTLY_TO_A_TWO_SOURCE_COMPARISON`).

### A4. Controller-owned review dispatch

`rick-loop-review-dispatch.mjs` with `workflow_dispatch`, exact-head
verification, and `--ref <default branch>`.

**Evidence:** 16 of 81 pre-cutover runs cancelled mid-execution versus 1 of 18
after. Duplicate dispatch refused in both `IN_FLIGHT` and `REVIEWED` states.

**Port with the security property intact:** `--ref` names the branch whose
*workflow definition* executes. Pointing it at the PR branch lets a PR author
run their own workflow with the review token — a P1 found on #40. Dispatch the
default branch and correlate runs by a `run-name` carrying `PR #<n> @ <sha>`.

### A5. Schema-isolation for integration tests

Create a per-run schema, migrate into it, drop it with `CASCADE`.

**Evidence:** TASK-15. Verified after each run that no schema leaked and the
shared schema's row counts were unchanged. Solves a problem per-row cleanup
*cannot*: `Sale_deletion_blocked` raises on every sale deletion, so dropping
the schema removes the table together with its trigger.

**Port.** It makes data safety structural rather than disciplinary.

### A6. Ephemeral Playwright policy

Generate the spec, run with `retries: 0`, delete spec and artifacts on pass,
persist only a summary; treat any needed retry as FLAKY.

**Evidence:** TASK-14 and TASK-15 both complied; nothing Playwright-related
remains tracked.

---

## Tier B — port after correction

### B1. LOOP-REGISTER schema — **add enforced severity**

**Defect:** 120 of 182 finding records carry no severity. The final audit
therefore **cannot report a severity distribution**, and no before/after defect
comparison is possible.

**Fix before porting:** a required `severity` field validated on append.
Without it the register produces narrative but not metrics.

### B2. Narrative and metadata consistency — **no gate reads prose**

**Defect:** 17 occurrences of a pointer advancing while its explanation stayed
behind. Two were in the HANDOFF resume path and would have misdirected a
recovery.

**Fix before porting, in order of cost:**
1. **Cross-check recorded pointers against computed truth, not only against
   each other.** `detectStateDrift` compares STATE's `next_eligible_task` to
   HANDOFF's; the audit PR set both to `none` while the resolver returned
   TASK-16, so the two agreed with each other, disagreed with reality, and the
   gate passed. The controller already computes the real value and exposes it
   as `roadmap_next_eligible_task`. This is the cheapest high-value fix in the
   list and it is not implemented.
2. `updated_at` freshness — compare the trailer against the file's own last
   commit timestamp. Mechanically checkable, identified during this run,
   **not implemented**.
3. Status-field consistency — `current_task_status` is compared by nothing.
4. Prose staleness — hardest; at minimum, require historical sections to carry
   an explicit marker and check that current-state claims appear only above it.

### B3. Secrets hygiene guard — **fix the self-reference properly**

**Defect:** produced five self-references. Each fix was correct, but the
accumulated result is an allowlist carrying entries that exist only because the
guard scans its own fixtures and changelog.

**Fix before porting:** a principled exclusion for the guard's own test
fixtures — a dedicated fixtures file excluded by path, with the exclusion
itself asserted — rather than allowlist growth. Keep the staleness rule, which
is the part that works.

### B4. Existing integration checks — **cleanup is a no-op**

**Defect:** `prisma.sale.delete(...)` with an empty `catch` reports success
having deleted nothing.

**Fix before porting:** never swallow cleanup failures. Either assert cleanup
succeeded or use schema isolation (A5), which removes the need.

### B5. Review-cost accounting

**Defect:** only 6 of 99 review runs have recoverable cost. Cancelled runs —
the ones most worth measuring — never print a result line.

**Fix before porting:** record cost at dispatch and reconcile at completion.

### B6. Spec gate — **make it mandatory from task 1**

**Evidence:** where specs existed they caught 8 pre-implementation defects on a
single task. TASK-01…08 have no specs and their evidence cannot be checked
against acceptance criteria.

---

## Tier C — do not port

### C1. Untracked architecture items

`ARCH-03` exists only as a STATE/HANDOFF mention, has no `ROADMAP.md` entry,
and is therefore invisible to the resolver — it can never be selected.

**Instead:** require every architecture item to have a roadmap entry at
creation. ARCH-04 proved the pattern works when tracked: its `depends_on`
wiring held TASK-15 until the governance work completed, then released it.

### C2. Reliance on the PR UI to indicate review state

After the trigger cutover, a `workflow_dispatch` run does not attach as a
check. A green check **proves nothing about review**.

**Instead:** if RCC needs humans to see review state, publish an explicit
status check from the dispatcher. Do not let the absence of red imply reviewed.

### C3. Written lessons as controls

**Evidence:** the lesson *"do not reproduce credential-shaped strings in
documentation"* was written, then violated in the next register entry by its
author.

**Instead:** every lesson intended to change behaviour needs a mechanical
check. Lessons without one are context, not controls, and should be labelled
that way.

---

## Suggested sequencing for RCC

1. **Port Tier A first and unchanged.** It is the load-bearing half and it is
   proven. Porting it partially is worse than not porting it: the gate's value
   is that it cannot be adjusted under pressure.
2. **Fix B1 and B2 before running an autonomous loop of any length.** Without
   severity, you cannot measure defect trends; without narrative coverage, the
   most frequent defect class in this experiment remains invisible.
3. **Fix B4 immediately if any test creates rows.** It is silent data
   accumulation.
4. **B3, B5, B6 before the second task**, not before the first.
5. **Treat C1–C3 as standing constraints**, not backlog.

---

## Honest limits of this plan

- **NOT TESTED:** everything about deployment. TASK-16's smoke script has
  proven failure paths but has never run against a deployed application, so
  nothing here should be read as deployment experience.
- **NOT TESTED:** the loop's behaviour under concurrent tasks. Every task in
  this experiment ran one at a time.
- **PARTIALLY PROVEN:** the authoritative-validation path. The register records
  one validation attempt and zero failures, so `rick-validator` was exercised
  far less than the review gate.
- **Not measured:** total experiment cost, per-task duration, and agent token
  usage. Extrapolating any of them would produce a number that looks like
  evidence and is not.
