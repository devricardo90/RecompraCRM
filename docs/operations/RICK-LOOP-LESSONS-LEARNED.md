# Rick Loop — Lessons Learned

Distilled from TASK-01 through TASK-16. Each lesson names the evidence that
produced it. Lessons without evidence are not included, and lessons that are
merely restatements of good intentions are marked as such, because this run
demonstrated that writing one down does not make it operative.

---

## 1. A gate that cannot fail is indistinguishable from no gate

**Evidence:** `scripts/repurchase-api-integration-check.mjs` and its siblings
call `prisma.sale.delete(...)` followed by an empty `catch`. The
`Sale_deletion_blocked` trigger raises on every sale deletion, the foreign-key
failures that follow are swallowed too, and the cleanup **reports success
having deleted nothing**. This ran for months. It is why the development
database accumulated rows from earlier runs.

**Rule:** every guard needs a test that makes it fail. `scripts/task-16-guards-check.mjs`
exercises rejection paths — a stale revision, an unreachable URL, a missing
variable — precisely because a guard that has only ever passed proves nothing.

---

## 2. Test the guard after its own files are tracked

**Evidence:** the secrets guard passed locally and failed CI twice. Locally its
own source and test file were untracked, so `git ls-files` did not list them.
Committed, they became inputs to their own scan: pattern constants named
`CONNECTION_URL_WITH_PASSWORD` matched the sensitive-key rule, and the test
fixture was a real credential-shaped URL by design.

**Rule:** anything that scans tracked files must be validated after its own
files are tracked. Running it against a tree where it is untracked tests a
different input set than CI will see — and the difference is exactly the code
just written.

---

## 3. Documentation about a credential reproduces the credential

**Evidence:** one test fixture produced **five** separate failures: the guard's
pattern constants, its test file, its register entry, a regression fixture, and
a second register entry written *one commit after* the lesson warning against
it.

**Rule:** describe a credential fixture; never quote it. Every document that
quotes it becomes another tracked occurrence.

**Meta-lesson, and the more important one:** I wrote lesson 3 and violated it
immediately. **A written lesson is an intention, not a control.** It needs a
mechanical check or it will be repeated by the same person who wrote it.

---

## 4. The dominant defect class was prose, not code

**Evidence:** 13 occurrences of *a pointer advancing while the prose explaining
it stayed behind* — 8 during ARCH-04 (ARCH-05's `recurrence_evidence`), 5 more
across PRs #42, #43, #45, #46. Two of them were in the HANDOFF **resume path**,
which would have told a recovering operator to redo finished work — the exact
scenario that began this run after a power-off.

`roadmap_pointers_agree` compares tracked fields. `detectStateDrift` compares a
fixed field list. **Neither reads narrative**, which is why every one of the 13
was caught by a human reviewer or not at all.

**Rule:** if a document's purpose is guiding recovery, its prose is load-bearing
and needs mechanical coverage. `updated_at` staleness is checkable against the
file's own commit timestamp — identified, not implemented.

---

## 5. Read the governing document, not just the code

**Evidence:** the TASK-16 spec declared the hosting provider an open owner
decision. `docs/product/PROJECT-SDD.md:26` had mandated Vercel from the start.
I audited the tree for deploy configuration, found none, and concluded the
choice was unmade — without reading the product spec that governs it.

The TASK-15 spec review caught the same class five times at the code level:
a field the API does not accept, a route that does not exist, the wrong request
shape, a field on the wrong record, and a false premise about business-day
classification.

**Rule:** before asserting something does not exist, read the document that
would have decided it.

---

## 6. Specs pay for themselves, and only where they exist

**Evidence:** TASK-15's spec took 5 review rounds and caught **8 defects before
a line of implementation existed**. Every one would have been fatal or
misleading to code against.

TASK-01 through TASK-08 have no specs. Their validation evidence cannot be
checked against acceptance criteria because none were written.

**Rule:** the spec gate belongs from task 1. Introducing it at TASK-09 left a
third of the roadmap unverifiable in principle.

---

## 7. A false premise whose conclusion happens to hold is the worst kind

**Evidence:** the TASK-15 spec justified varying only `soldAt` by claiming
`classifyRepurchase` compares absolute instants. It compares **business-day
numbers**. The conclusion survived — sufficiently separated dates do cross day
boundaries — but the premise was wrong, and it had been used to make a design
decision the round before.

**Rule:** nothing downstream fails until someone leans on the premise for a
different conclusion. Correct premises even when the conclusion is safe.

---

## 8. The gate must outrank the agent's judgement, including about the gate

**Evidence:** on PR #45 a finding was re-posted against the commit that fixed
it. I demonstrated it was already fixed, line by line, with `git show`. The
verdict was still FINDINGS, so there was no clean review, and the merge gate
refused.

That was correct. **My belief that a finding is wrong is not evidence.** The
right response was not to argue harder or push a trivial commit to fish for a
clean verdict — it was to fix the cause: two reviewers had misread the same
historical section, which meant the section was genuinely confusing.

**Rule:** when a gate blocks on something you believe is wrong, look for what
made it believable.

---

## 9. Economics change what a green check means

**Evidence:** after ARCH-04, `workflow_dispatch` runs do not attach to the PR
as checks. `quality` is the only check. Nothing in the UI turns red when a
review is missing.

The gate always keyed on the verdict comment, so this is correct by design —
but it inverts what a human sees. Before: green check implied a review ran.
After: **a green check proves nothing about review.**

**Rule:** when you remove an automatic trigger, audit what its absence removes
from the humans reading the UI, not just from the machine.

---

## 10. Cancelled runs are spend without product

**Evidence:** 16 of 81 pre-cutover review runs were cancelled mid-execution by
a subsequent push — model invocations killed after incurring cost and before
producing a verdict. After the cutover: 1 in 18.

The cost of those 16 is **unrecoverable from logs**, because the result line
that reports `total_cost_usd` never printed.

**Rule:** instrument cost at dispatch, not only at completion. Work that is
cancelled is the work you most want to measure.

---

## 11. Process violations should be self-reported

**Evidence:** two are recorded in `LOOP-REGISTER.jsonl`:

- `PROCESS_VIOLATION_SELF_REPORTED` — a review dispatched outside the
  controller while preflight was red, to test whether the CLI worked. It
  dispatched. The run was cancelled and the incident recorded.
- `REGISTER_LINE_REWORDED_DISCLOSED` — an already-pushed register line reworded
  on an unmerged branch rather than permanently weakening a security guard with
  a fifth allowlist entry. Disclosed with the reasoning, including what the
  correct action would have been had it already merged.

**Rule:** the register's value depends on containing the things that reflect
badly. A clean register is either a perfect run or an untrustworthy one.

---

## 12. The self-assessment artifacts were the least reliable part

**Evidence:** PR #47 ran five rounds. Three found defects in tests and
evidence rather than in shipped behaviour: a guard whose rejection rules had
no failing-case test for five of seven rules; an evidence document asserting
"PROVADO — com asserção sobre falha" where no such assertion existed; and
smoke coverage proving only the failure paths when the spec had promised the
healthy-instance path too.

All three were produced by the same process meant to be checking the work, and
all three were caught by independent review. **No gate caught any of them, and
none could** — they are claims about whether evidence is adequate, which is
not something a script can compare.

**Rule:** treat tests and evidence documents as the *least* trustworthy
artifacts an autonomous loop produces, not the most. They are where
self-assessment is structurally weakest.

---

## 13. Allowlists must be able to shrink

**Evidence:** the secrets guard allowlist reached four entries, each with a
stated reason, and a rule that fails any entry which stops matching. When a
fifth was about to be added for a test fixture, the fixture was changed to use
a recognised placeholder instead.

**Rule:** an allowlist that only grows reads like assurance while providing
none. Staleness detection and a recorded commitment to scrutinise additions are
what keep it honest — and both belong in the code, not in the author's memory.
