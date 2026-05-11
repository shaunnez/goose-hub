# core/agent-comment

Builds structured GitHub-issue comment markdown for agent status updates. One small pure function so every agent posts comments in the same shape.

## Exports

### `buildAgentComment(agent, status, summary, details?): string`

Renders a comment with the header `**[<agent>] <status>**`, a summary line, and an optional bulleted details section. Used by the orchestrator and slice workflows when transitioning a work item, so reviewers see a predictable format on the issue.

No side effects — callers post the returned string through the GitHub connector or `StateSource.comment()`.
