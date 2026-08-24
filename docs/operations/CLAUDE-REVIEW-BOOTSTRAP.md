# Claude PR Review bootstrap

This one-time bootstrap exists because `anthropics/claude-code-action@v1` validates that its workflow file already exists with identical content on the repository default branch before it will execute on pull requests.

After `.github/workflows/claude-pr-review.yml` is merged to `main`, every non-draft same-repository pull request triggers the independent Claude reviewer on `opened`, `synchronize`, `ready_for_review`, and `reopened`.

Authentication is provided through the repository secret `CLAUDE_CODE_OAUTH_TOKEN`. For Claude Pro/Max, Anthropic documents generating this token locally with `claude setup-token`.

This bootstrap PR itself cannot be reviewed by the workflow it is installing. That is an upstream trust-bootstrap constraint, not a loop state. Once merged and authenticated, subsequent PRs use the normal exact-head independent-review gate.
