# Issue Restart

Operator-facing issue restart primitive for dogfooding and stuck workflow recovery.

`restartIssue()` creates a new work item from an existing one instead of mutating
the existing event history. It clones the stable GitHub-owned fields, links old
and new issues with comments, archives the previous issue, and emits local
manual/action transition events for auditability.

The CLI entrypoint is:

```bash
pnpm goose issue restart goose-hub-self 123 --state=factory:triaging --schedule=current --yes
```

Without `--yes`, the command runs as a dry plan and prints the operation it
would perform.
