---
name: loop
description: Canonical Rick autonomous development loop. Use when the user invokes /loop or explicitly asks to start, resume, continue, or re-enter the Rick roadmap loop.
effort: high
allowed-tools: Read Grep Glob Edit Write Bash(git *) Bash(gh *) Bash(node *) Bash(npm *) Skill(rick-validator *)
---

# Rick Loop v1.4

This skill is the canonical entrypoint for autonomous roadmap execution. Once invoked, keep the controller running until `ROADMAP_COMPLETE` or a genuinely human-required terminal state is proven. Do not return control merely because CI, the independent reviewer, a network dependency, or another retryable external condition is temporarily unavailable.

## Controller cycle

1. Run `node scripts/rick-loop-supervisor.mjs` and treat its `decision` as authoritative. Do not drive the roadmap from conversational memory.
2. Reconstruct current truth from repository facts on every cycle: STATE, HANDOFF, ROADMAP, active PR, exact HEAD, CI, review, spec, validation artifact, and LOOP-REGISTER-derived stats.
3. `SPEC_REQUIRED`: write/review the spec. This is work, not a stop state.
4. `PASS` / implementation-ready: implement only the current deterministic task and its reviewed spec.
5. Run fast gates. Green tests are necessary but never sufficient.
6. `READY_FOR_VALIDATION`: invoke `rick-validator` with the exact task, baseline SHA and current HEAD. The implementer must not self-declare validation success.
7. `VALIDATION_FAILED`: fix only the proved gaps, rerun fast gates, then invoke the independent validator again. Any missing AC proof means FAIL.
8. Only exact-head `VALIDATION_PASS` may proceed to independent code review. The canonical review provider is the automatic `Claude PR Review` GitHub Actions workflow using `anthropics/claude-code-action@v1`. Validation asks whether the implementation proves the spec; review asks whether the implementation is sound. Never merge the two gates.
9. The raw v1.3.x kernel may still emit the compatibility name `WAIT_FOR_CODEX`; in v1.4 interpret it as `WAIT_FOR_INDEPENDENT_REVIEW`. `WAIT_FOR_CODEX`, `WAIT_FOR_CI`, `EXTERNAL_RETRYABLE`, or legacy retryable `BLOCKED_EXTERNAL` are handled by `node scripts/rick-loop-watcher.mjs`. For reviewer waits, the watcher observes/reruns the Claude review workflow; it must not request Codex and must not ask the owner to type `resume`.
10. When the watcher completes because repository facts changed, rerun the supervisor immediately and continue from the first unproved step.
11. Merge only after exact-head CI, authoritative validation, independent clean review, zero unresolved findings and every existing merge invariant pass.
12. After merge, run post-merge validation, checkpoint STATE/HANDOFF, append LOOP-REGISTER events, derive stats with `node scripts/rick-loop-stats.mjs`, and advance to the next eligible roadmap task.

## Review result contract

A clean Claude review is accepted only when its top-level result names the exact HEAD as `Reviewed commit: <sha>`, contains the explicit clean verdict `No major issues found.`, comes from an author independent of the PR author, and there are zero unresolved inline findings for that exact HEAD. Any HEAD change invalidates the result and automatically triggers a new Claude review through the PR `synchronize` event.

## Durable context

- `STATE` = current deterministic pointers.
- `HANDOFF` = resumable operational position and next action.
- `LOOP-REGISTER` = append-only event truth. Never rewrite published entries.
- `STATS` = derived projection from LOOP-REGISTER, never a competing mutable truth store.
- `LESSONS` = reusable learning only; do not create one for ordinary one-off test failures.
- `.rick/tmp/*` = derived runtime cache only. Missing runtime files must cause reconstruction or revalidation, never invention.

## Stop policy

A retryable external dependency is not terminal. Poll-budget exhaustion changes cadence, not ownership of the loop. The loop may stop only for `ROADMAP_COMPLETE`, `NO_ELIGIBLE_TASK` with proved dependency facts, `OWNER_DECISION`, `HUMAN_REQUIRED`, or a hard external blocker that cannot be retried without human intervention.

Never emit “say resume when the limit resets” for a retryable dependency.
