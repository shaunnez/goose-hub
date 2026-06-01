# Issue Restart

Operator-facing issue restart primitive for dogfooding and stuck workflow recovery.

`restartIssue()` creates a new work item from an existing one instead of mutating
the old issue back through the lifecycle. The old issue is archived and both
issues get cross-link comments.

The CLI entrypoint is:

```bash
pnpm goose issue restart goose-hub-self 123 --state=factory:triaging --schedule=current --yes
```

Without `--yes`, the command prints a restart plan and exits without creating or
archiving issues.
