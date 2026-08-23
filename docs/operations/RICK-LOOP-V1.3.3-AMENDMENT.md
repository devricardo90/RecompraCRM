# Rick Loop v1.3.3 amendment — enforce the published-review merge gate

```yaml
amendment: RICK_LOOP_V1_3_3
status: PROPOSED_ON_PR
pr: 23
finding: MERGE_OCCURRED_BEFORE_REQUIRED_INDEPENDENT_REVIEW_RESULT_WAS_PUBLISHED
```

## Change

The merge predicate is now wired into `classifyLoopDecision()`, the executable
controller path. The controller can expose `READY_TO_MERGE` only after the
exact-head CI result, required gates, published independent clean review, exact
review SHA, explicit zero-finding evidence, and publication ordering all pass.

The review evidence is normalized from GitHub's review and inline-comment APIs.
The author's own review, a `CHANGES_REQUESTED` review, a review with inline
findings, and a result with missing finding evidence cannot satisfy the gate.
The latter fails closed instead of treating an omitted count as zero.

## Validation

`node scripts/rick-loop-controller-check.mjs` covers the positive gate,
request-only result, post-merge publication, stale SHA, unresolved findings,
missing evidence, non-independent/non-clean reviews, `READY_TO_MERGE`, and
recovery routing. No TASK-12 implementation, schema change, or migration is
included.
