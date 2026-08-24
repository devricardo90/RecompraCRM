# Claude PR Review budget correction

Observed on PR #26 after OAuth was working:

- Claude Code initialized successfully with `claude-sonnet-5`.
- The review ran for 141 seconds and consumed 21 turns.
- The workflow hard limit was 20 turns, so the action exited with `error_max_turns` before publishing a review verdict.
- The run also recorded 10 permission denials, indicating that safe repository-inspection commands were being attempted but not allowlisted.

Correction:

- increase `--max-turns` from 20 to 50;
- explicitly allow read-only Git inspection commands and `gh pr checks`;
- instruct the reviewer to start from the diff, avoid repeated inspection, and stop exploring unrelated areas.

No write/merge/push implementation tools are added. Review remains read-only except for PR comments/inline review findings.
