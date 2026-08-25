# Rick Loop v1.4 amendment — authoritative validation and durable autonomy

```yaml
amendment: RICK_LOOP_V1_4
status: PROPOSED_ON_PR
supersedes_runtime_entrypoint: RICK_LOOP_V1_3_4
canonical_entrypoint: /loop
finding: TESTS_GREEN_NOT_VALIDATION
finding_2: RETRYABLE_EXTERNAL_MUST_NOT_REQUIRE_HUMAN_REENTRY
```

## Objective

A green test suite is necessary evidence, not proof that the implementation satisfies the reviewed specification. Separately, a retryable external dependency is a timing condition, not a reason to hand the roadmap back to the owner.

v1.4 therefore introduces two hard invariants:

1. implementation cannot reach independent review without an exact-head `VALIDATION_PASS` anchored to the reviewed spec;
2. poll-budget exhaustion on CI/Codex/network-style retryable waits changes retry cadence but never makes the wait human-terminal.

The practical target is a loop that does not stop **incorrectly**. Legitimate owner decisions, human-required credentials/permissions and true roadmap completion remain valid terminal states.

## Canonical execution path

```text
/loop
  -> RECONCILE FACTS
  -> SDD / SPEC REVIEW
  -> IMPLEMENT
  -> FAST GATES
  -> READY_FOR_VALIDATION
  -> INDEPENDENT AUTHORITATIVE VALIDATION
       -> FAIL -> FIX -> FAST GATES -> VALIDATE AGAIN
       -> PASS -> INDEPENDENT CODE REVIEW
  -> MERGE
  -> POST-MERGE VALIDATION
  -> CHECKPOINT
  -> NEXT ELIGIBLE TASK
```

`/loop` is implemented as the project skill at `.claude/skills/loop/SKILL.md`, the current Claude Code skill format. The v1.3.x controller remains the repository-fact kernel; `scripts/rick-loop-supervisor.mjs` is the v1.4 authority exposed by `npm run loop:status`.

## Authoritative Validation Gate

The gate answers: **did this exact HEAD prove every requirement of this exact reviewed spec?** It is intentionally separate from code review, which answers whether the implementation has defects or design problems.

Rules:

- every Acceptance Criterion must have a stable explicit AC id;
- both `Critérios de aceite` and `Critérios de aceitação` are accepted headings; compact ids such as `AC1` normalize to `AC-01`;
- every spec AC must have exactly one proof entry;
- missing proof is `VALIDATION_FAIL`; 16/17 or 23/24 is not “almost pass”;
- stale DoD coverage declarations such as “AC1 a AC17 provados” when the spec contains AC18+ are a spec-precision failure;
- expected behavior, negative behavior and edge cases are separate proof groups;
- lint/typecheck/unit/integration/build must all be green;
- authoritative proof includes fresh execution and cannot rely exclusively on cache;
- critical surfaces require selective robustness sensing; every meaningful injected fault must be killed;
- validation identity is bound to task, baseline SHA, exact HEAD and spec SHA-256;
- a HEAD move or spec change invalidates prior validation automatically;
- the implementer cannot self-declare PASS. The `/loop` skill invokes `.claude/skills/rick-validator/SKILL.md` with `context: fork`, then the deterministic script computes PASS/FAIL.

Derived artifacts live in `.rick/tmp/validation-input.json`, `.rick/tmp/validation.json` and `.rick/tmp/validation.md`. They are deliberately untracked derived evidence: committing an exact-head validation artifact into the same PR would change the HEAD it claims to validate. If the cache disappears, validation is rerun from repository facts.

`VALIDATION_PASS` is the gate result/event; after a matching PASS the supervisor immediately exposes the next actionable review/merge decision rather than pausing for a redundant controller cycle.

## Robustness sensor

Mutation/fault testing is selective, not universal. The deterministic validator requires it for critical changed paths such as domain/state logic, API/security boundaries, permissions, financial/date-time logic, migrations, and Rick controller/review/merge machinery. Visual-only/copy-only work does not automatically pay this cost.

The required invariant when the sensor applies is:

```text
injected > 0
killed == injected
survived == 0
```

A surviving fault means the tests did not prove the behavior strongly enough and validation fails even when the ordinary suite is green.

## Retryable external waits

v1.3.4 correctly made `WAIT_*` recoverable, but its exhausted poll budget still promoted the raw controller decision to terminal `BLOCKED_EXTERNAL`. Live TASK-12 spec review proved that this still required the owner to type `resume` after a Codex usage-limit refusal.

v1.4 makes the supervisor the terminality authority. A raw `BLOCKED_EXTERNAL` whose `waited_transition` is `WAIT_FOR_CI`, `WAIT_FOR_CODEX` or `EXTERNAL_RETRYABLE` is deterministically reclassified as:

```yaml
transition: PARKED_EXTERNAL_RETRYABLE
terminal: false
human_required: false
```

`scripts/rick-loop-watcher.mjs` owns the wait. Backoff becomes progressively slower and caps at one hour; it has no production retry-count terminal condition. For Codex review waits it may re-request review no more than once per hour. It exits only when repository facts move to another controller state or a genuinely hard terminal state is proven.

This avoids burning LLM context while preserving autonomous re-entry in a live executor. If the terminal/IDE/machine itself is shut down, no local process can execute; on the next executor start `/loop` reconstructs from repository facts instead of trusting `.rick/tmp`.

## STATE / HANDOFF / STATS / LESSONS / EVENTS

- `STATE`: deterministic current pointers.
- `HANDOFF`: where execution stopped or parked and the first unproved next action.
- `LOOP-REGISTER`: append-only event source of truth.
- `STATS`: a derived projection computed by `scripts/rick-loop-stats.mjs`; it is not another mutable truth file that can drift from events.
- `LESSONS`: only reusable patterns. Ordinary one-off failures remain events/statistics, not lessons.
- `.rick/tmp`: convenience cache only.

Validation transitions are recorded as loop events at the normal durable checkpoint; current exact-head validation is also visible directly to STATS from `.rick/tmp/validation.json`. This avoids changing the PR HEAD merely to record the validation that is bound to that HEAD.

## New controller states and gate results

```text
READY_FOR_VALIDATION       controller state
VALIDATION_FAILED          controller state
PARKED_EXTERNAL_RETRYABLE  controller state
VALIDATION_PASS            gate result/event
```

All three new controller states are non-terminal. `VALIDATION_PASS` immediately unlocks the independent-review state for the same exact HEAD.

## Hard invariants

1. Green tests MUST NOT imply review readiness.
2. Review MUST NOT begin without exact-head authoritative validation for implementation PRs.
3. Docs/spec-only PRs remain on the spec-review path and do not require implementation validation.
4. Any change to HEAD invalidates validation evidence.
5. Any change to the reviewed spec invalidates validation evidence.
6. AC coverage less than 100% is FAIL.
7. A stale DoD AC range is a spec-precision FAIL.
8. A required robustness sensor with any survivor is FAIL.
9. Retryable wait poll-budget exhaustion MUST NOT become human-terminal.
10. Human re-entry is forbidden unless `HUMAN_REQUIRED=true` or an owner decision is actually needed.
11. The event register remains append-only; STATS is derived from it.

## Protocol self-test

`node scripts/rick-loop-v1.4-check.mjs` proves at minimum:

- the real TASK-12 heading/id style is machine-readable;
- stale DoD AC coverage fails;
- partial AC proof fails;
- a surviving injected fault fails;
- wrong-head validation fails;
- green CI without validation cannot reach review;
- validation PASS unlocks review;
- retryable `BLOCKED_EXTERNAL` becomes non-terminal parked state;
- long retry cadence caps at hourly rather than terminating;
- STATS is derived from events.
