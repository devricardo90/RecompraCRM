# Loop Dispatcher Change Record

Change: Rick Loop v1.3.3 executor dispatch amendment

Reason: the deterministic resolver selected TASK-13 correctly, but no executor was automatically woken. A human still had to paste a prompt into the local coding agent.

Scope:
- add deterministic executor dispatch payload;
- add Claude Code and generic bridge contracts;
- add regression checks;
- wire dispatch/test npm scripts;
- document one-time local bridge configuration.

Non-scope:
- no product code;
- no schema or migration;
- no task eligibility changes;
- no weakening of CI, review, Playwright, pre-write, or human-required stops.
