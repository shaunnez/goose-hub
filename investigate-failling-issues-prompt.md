Investigate this Goose Hub issue and its agent runs.

  URL: <paste issue/timeline URL here>

  Work read-only. Do not edit code or database state.

  Goal:
  Determine whether the agent workflow for this issue is healthy, efficient, and correctly grounded. The user cares most about whether agents are working, whether context is propagating correctly, and whether token/cache/cost behavior is
  reasonable.

  Use the URL to identify the project/issue, then use the local database as the source of truth. Prefer `~/.factory/data/factory.db` and inspect relevant rows from `events`, `agent_runs`, `agent_run_costs`, `agent_run_tool_stats`, and
  workflow-specific tables. The UI timeline is secondary.

  Ignore orphaned runs caused by server restarts. Do not count a run as a workflow failure unless it is clearly linked to this issue’s active workflow path.

  Answer these questions:

  1. Spec author
  - Did the spec-author run execute properly?
  - Did it infer the correct information from the issue, investigation, PRD, and repo context?
  - Did it create useful, grounded implementation guidance, or did it drift/speculate?

  2. Implement runs
  - Did implement / implement-wp runs work efficiently?
  - Did they receive the right context from investigation, spec, and PRD where applicable?
  - Did they make relevant changes, or did they loop, no-op, pick the wrong surface, over-read files, or chase brittle tests?
  - Check costs, tokens, cache behavior, tool usage, retries, and repeated command/test patterns.

  3. Parallel agents
  - If any parallel/scout/sub-agent failed, why?
  - Distinguish real failures from stderr noise, transient transport errors, orphaned runs, or parent workflow recovery.
  - Verify failure status from DB events, not just logs.

  4. QA and fix-feedback
  - QA agents often fail on these issues. For this issue, did QA fail for a real product/code reason, a bad spec/contract reason, missing evidence, stale context, flaky tests, or poor workflow orchestration?
  - If the issue went to fix-feedback, did fix-feedback receive the correct failing QA/review payload, original investigation context, spec, PRD, and implementation context?
  - Did fix-feedback produce an actually useful repair, and was that repair persisted/committed/pushed as expected?

  5. Repeat QA failure after fix-feedback
  - If the workflow returned from fix-feedback to QA and failed again, explain why.
  - Separate: bad fix, bad QA judgement, malformed acceptance/interface contract, missing persistence, stale branch/PR state, flaky test seam, or context propagation failure.

  Required evidence:
  - Cite concrete run IDs, event kinds, timestamps, role/skill names, and cost/token/cache/tool stats where useful.
  - Include enough SQL/table evidence to make the conclusion auditable, but keep the final answer concise.
  - Check commit/PR state if persistence is part of the question. Do not trust agent narration alone.

  Output format:
  - Brief verdict: 3-6 bullets.
  - Confidence: High / Medium / Low, with one sentence explaining why.
  - Findings: grouped by Spec Author, Implement, Parallel Agents, QA, Fix Feedback, Repeat QA.
  - Cost/context assessment: concise notes on token/cache/tool efficiency.
  - Recommendations: concrete issues, fixes, or further investigation. Prefer narrow product/workflow fixes over generic prompt advice.
  - Call out unknowns explicitly. Do not overstate conclusions.