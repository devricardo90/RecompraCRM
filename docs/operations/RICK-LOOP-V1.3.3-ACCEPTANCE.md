# Rick Loop v1.3.3 Acceptance Checklist

- [ ] Dispatcher tests pass in CI.
- [ ] Existing Rick Loop controller tests still pass.
- [ ] Lint, typecheck and build pass.
- [ ] Exact-HEAD independent review is clean.
- [ ] Missing executor bridge fails closed.
- [ ] Wait and HUMAN_REQUIRED states do not auto-dispatch.
- [ ] Claude Code bridge uses argument-array invocation with `shell: false`.
- [ ] Post-merge main validation passes.
- [ ] Local pilot bridge is configured separately before claiming automatic wake-up works on the Windows machine.
