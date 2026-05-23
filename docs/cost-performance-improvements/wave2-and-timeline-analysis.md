# Wave 2 And Timeline Cost Improvements

Date: 2026-05-23

Scope:

- Issue #990 timeline: `/projects/goose-hub-self/items/990/timeline`
- Issue #991 timeline: `/projects/goose-hub-self/items/991/timeline`
- Primary evidence: `~/.factory/data/factory.db` tables `events`, `agent_run_costs`, and `scout_reports`

## Executive Summary

The highest-confidence fix is to update the problematic skill prompts first, then add a small shared read-discipline block to the runtime/master instructions.

Do not start by broadly rewriting `CLAUDE.md`. The current shared runtime prompt already covers workspace boundaries and tool preference. The failures here are mostly skill-specific:

- `wave2-interface-designer` lacks the hard read/search cap already present in `wave2-risk-analyst`.
- `wave2-interface-designer` is too schema/API-shaped for UI work; it forces UI bugs into `typescript-interface` and `function-signature` artefacts.
- Several Wave 1 scouts returned “workspace tools unavailable” or “factory resources unavailable” instead of using the read tools the workflow expected them to use.
- `playwright-repro` can drift into source-code discovery instead of staying focused on a browser repro.
- `scout-test-inventory` and some spec-author runs repeatedly hit large/truncated files.

## Plan

### 1. Update `wave2-interface-designer`

Target file: `skills/wave2-interface-designer/prompt.md`

Changes:

- Add a hard verification budget: at most 5 total read/search calls, and preferably 3 when scout reports already cite files.
- Add a no-reread rule: never read the same file twice unless the first result was truncated, and name the missing section before rereading.
- Add a stop condition: once the target boundary and artefact shape are known, stop using tools and return JSON.
- Treat `<scoutReports>` as primary evidence, not as a starting point for a fresh investigation.
- Add UI/component artefact kinds:
  - `component-contract`
  - `state-transition`
  - `test-contract`
  - `props-contract`
- Allow `OPEN_QUESTION` instead of forcing a typed artefact when the task is not an interface/schema problem.
- Add examples for UI bugs so accordion/chat-state tasks do not get squeezed into Zod/DDL language.

Expected impact:

- Prevents the #990 failure mode: 24 reads, 23 searches, 1.18M input tokens, `$3.051245` against a `$1` budget.
- Reduces normal successful runs like #991 from 11 reads + 8 searches toward risk-analyst levels.

Confidence: high.

### 2. Tune `wave2-risk-analyst`

Target file: `skills/wave2-risk-analyst/prompt.md`

Changes:

- Keep the existing 3 targeted reads/greps cap; it is working.
- Clarify tool priority:
  - read owner/source file first
  - read the closest test file second
  - spend the final read on wiring/ownership only if the risk depends on it
- Count all non-output tool calls against the cap, including `get_project_context`, `get_head_sha`, and `list_files`, unless the skill prompt explicitly exempts them.
- Add this rule: if the remaining open question is about handler ownership or wiring, use one remaining read on the owner file before returning.
- Keep “valid partial risk register over exhaustive analysis”.

Expected impact:

- Preserves the useful bounded behavior seen in #991 (`$0.339095`, 1 read, 1 search).
- Reduces avoidable open questions where a single owner-file read would settle the issue.

Confidence: medium-high.

### 3. Update Wave 1 scout prompts for tool/context correctness

Target files:

- `skills/scout-code-path/prompt.md`
- `skills/scout-user-journey/prompt.md`
- `skills/scout-schema/prompt.md`
- optionally `skills/scout-test-inventory/prompt.md`

Changes:

- Remove or soften any language that makes agents look for MCP resources instead of the factory read tools.
- Add a direct first step: use `list_dir` or `search_text` in the workspace, not `resources/list`.
- If no tool is visible, report the exact missing tool names. Do not say “factory resources unavailable”.
- If the issue names a directory, start there and make at most 3 targeted reads/searches.
- For irrelevant scouts, return an empty `findings` array with `UNCERTAINTY` or `INSIGHT` explaining irrelevance, not a tooling failure.

Expected impact:

- Fixes the repeated “workspace file/search tools were not available” reports in #990 and #991 from scouts that produced no file-backed findings.
- Reduces noise passed to Wave 2.

Confidence: high that this is an issue; medium that prompt-only changes fully solve it, because the tool allowlist/runtime should also be checked.

### 4. Add shared read-discipline block to runtime/master instructions

Target file: `core/agent-runtime/runtime-instructions.ts`

Add a short section after the Factory tools section, not a broad `CLAUDE.md` rewrite:

```md
## Read discipline

Treat provided context and prior reports as primary evidence.
Do not restart discovery unless the reports contradict each other or lack the file needed for your schema.
Before using tools, decide the exact question the tool call will answer.
Do not read the same file twice unless the first result was truncated; name the missing section before rereading.
For scout and Wave runs, prefer valid partial JSON plus OPEN_QUESTION over extra exploration.
```

Expected impact:

- Gives all skills a baseline against repeated reads and broad rediscovery.
- Keeps skill-specific rules in skill prompts, where they can be stricter.

Confidence: medium. This will help, but it should not replace skill-local caps.

### 5. Add runtime guardrails and telemetry follow-ups

Potential follow-up issues:

- Add a per-run duplicate-read warning event when the same file is read more than once outside a truncation recovery path.
- Add per-skill soft tool-call caps for scouts/Wave agents.
- Add a report that ranks `agent_run_costs` by `input_tokens / output_tokens` and duplicate-read count.
- Add a prompt-contract test that asserts `wave2-interface-designer` includes a read/search cap like `wave2-risk-analyst`.

Confidence: medium.

## Timeline Analysis: Issue #990

Issue #990 is the investigation-page accordion/default-state bug.

### Cost Summary

| Skill | Runs | Cost | Input tokens | Output tokens | Assessment |
|---|---:|---:|---:|---:|---|
| spec-author | 2 | `$3.433950` | 631,296 | 9,249 | Expensive; likely one retry/second spec pass. Needs repair-loop scrutiny. |
| wave2-interface-designer | 1 | `$3.051245` | 1,180,082 | 6,736 | Bad. Over budget and produced no durable report. |
| playwright-repro | 1 | `$0.777277` | 947,474 | 14,816 | Too much source discovery for a browser repro. |
| investigate | 1 | `$0.663617` | 253,783 | 1,944 | Reasonable after Wave 2 failure; used reports and bounded reads. |
| wave2-risk-analyst | 1 | `$0.520100` | 195,008 | 2,172 | Mostly healthy; bounded and produced useful risks. |
| scout-test-inventory | 1 | `$0.439651` | 562,453 | 3,958 | Useful findings, but too many large/truncated reads. |
| scout-code-path | 1 | `$0.058309` | 73,402 | 724 | Cheap but ineffective; produced a tooling uncertainty. |
| scout-user-journey | 1 | `$0.036603` | 44,190 | 769 | Cheap but ineffective; produced a tooling uncertainty. |
| triage | 1 | `$0.012685` | 14,310 | 434 | Efficient. |
| repo-match | 1 | `$0.011303` | 14,062 | 168 | Efficient. |

### Per-Agent Findings

#### triage

- Efficiency: good. Cheap, correct classification.
- Context: correct. It had the issue text and produced `type:bug`, medium priority reasoning.
- Improvements: none urgent.
- Confidence: low issue / low improvement impact.

#### repo-match

- Efficiency: good.
- Context: correct. It selected `shaunnez/goose-hub` for an `apps/web` UI bug.
- Improvements: none urgent.
- Confidence: low issue / low improvement impact.

#### scout-code-path

- Efficiency: superficially cheap, but unproductive.
- Context: questionable. It reported that workspace file/search tools were unavailable and produced no findings.
- Improvements: update prompt/tool contract so scouts use `read_file`, `list_dir`, `list_files`, and `search_text`, not MCP resources. Runtime should also verify the intended read tools are actually exposed.
- Confidence: high issue / medium-high improvement impact.

#### scout-user-journey

- Efficiency: cheap, but unproductive.
- Context: questionable. It also reported no file read/search tool availability.
- Improvements: same as scout-code-path; give a fallback pattern for UI-flow scouts: start from issue-provided directory, read route/component owner file, return a bounded journey finding or explicit irrelevance.
- Confidence: high issue / medium-high improvement impact.

#### scout-test-inventory

- Efficiency: mixed. It produced useful coverage findings, but used 15 reads and several repeated/truncated reads. It accounted for 562,453 input tokens.
- Context: correct. It found relevant investigation/acceptance/spec tests and e2e flows.
- Improvements: add a test-inventory-specific cap and prefer `search_text` for `describe(` / `it(` over full reads of large e2e files. Read only the closest test bodies after search finds anchors.
- Confidence: medium-high issue / medium improvement impact.

#### wave2-risk-analyst

- Efficiency: acceptable. It used 4 reads, 1 search, and produced 4 useful risks.
- Context: mostly correct. It used `scout-test-inventory` and targeted component reads. It unnecessarily read `CLAUDE.md` once, apparently truncated.
- Improvements: keep the existing cap; count governance-file reads as suspect for Wave 2 unless directly cited in input. Prefer owner/test files only.
- Confidence: low-medium issue / medium improvement impact.

#### wave2-interface-designer

- Efficiency: bad. It used 24 reads, 23 searches, 4 `list_files`, 3 `read_many_files`, and `get_project_context`. It reread `InvestigationSection.tsx` 4 times and repeatedly searched broad `apps/web/src` and `apps/web/src/components/detail/components` paths.
- Context: partly wrong. The skill expected interface artefacts such as Zod schemas, SQL DDL, and TS interfaces for a UI accordion presentation bug. It never wrote a durable `scout_reports` row because it breached budget.
- Improvements: highest priority. Add hard read/search cap, UI/component output modes, stop condition, no reread rule, and partial-output fallback.
- Confidence: high issue / high improvement impact.

#### investigate

- Efficiency: reasonable. After Wave 2 failed, it used only 2 reads and 6 decision records, then produced a clear root cause.
- Context: mostly correct. It had enough Wave 1 and risk-analyst evidence to synthesize even without interface-designer output.
- Improvements: when Wave 2 is incomplete, include a decision summary that names which Wave 2 report was missing and whether remaining evidence is sufficient.
- Confidence: low-medium issue / medium improvement impact.

#### playwright-repro

- Efficiency: poor for #990. It used 25 searches, 17 reads, 6 list calls, and 3 `read_many_files`, costing `$0.777277` and 947,474 input tokens.
- Context: partially wrong for its role. A repro agent should not need broad route/source discovery after investigation already named the page and components.
- Improvements: pass the target URL, route, expected visible assertion, and key test id from investigation/spec context. Cap source reads unless a selector is unknown. The agent should build a repro, not reinvestigate the app.
- Confidence: high issue / high improvement impact.

#### spec-author

- Efficiency: mixed to poor. Two runs cost `$3.433950` total. The second run was cheaper than the first but still reread truncated files.
- Context: likely correct but too large. Prompt context was about 9.5k-9.7k estimated tokens before tool use.
- Improvements: include a compact investigation synthesis and Wave 2 digest; avoid forcing spec-author to re-open component/test files unless needed for exact acceptance contracts. Investigate why there were two spec-author runs.
- Confidence: medium issue / medium improvement impact.

#### implement-wp

- Efficiency: not fully measurable from cost rows because the recorded WP2 run was orphaned by server restart.
- Context: correct. It loaded relevant owned files and made a bounded plan for `AcceptanceContractDetails`.
- Improvements: operational, not prompt-first: reduce orphaning risk and preserve partial cost/output on server restart.
- Confidence: low prompt issue / medium runtime improvement impact.

## Timeline Analysis: Issue #991

Issue #991 is the chat widget close/reopen state bug.

### Cost Summary

| Skill | Runs | Cost | Input tokens | Output tokens | Assessment |
|---|---:|---:|---:|---:|---|
| implement-wp | 1 | `$3.152077` | 1,211,199 | 8,272 | Expensive but productive; verification tooling gap inflated work. |
| spec-author | 2 | `$0.929330` | 115,822 | 11,674 | Acceptable, but two passes should be inspected. |
| wave2-interface-designer | 1 | `$0.662832` | 242,603 | 3,755 | Useful but still over-investigates vs risk analyst. |
| investigate | 1 | `$0.661707` | 251,969 | 2,119 | Good synthesis. |
| dev-review | 1 | `$0.371503` | 136,625 | 1,996 | Reasonable. |
| wave2-risk-analyst | 1 | `$0.339095` | 123,662 | 1,996 | Good bounded behavior. |
| scout-test-inventory | 1 | `$0.327912` | 421,700 | 2,586 | Useful but high input. |
| playwright-repro | 1 | `$0.141232` | 126,167 | 10,357 | Reasonable. |
| scout-user-journey | 1 | `$0.047093` | 58,501 | 715 | Cheap but ineffective; tooling uncertainty. |
| scout-code-path | 1 | `$0.037139` | 43,999 | 920 | Cheap but ineffective; tooling uncertainty. |
| scout-schema | 1 | `$0.013433` | 14,911 | 500 | Cheap but probably irrelevant. |
| triage | 1 | `$0.013903` | 14,259 | 713 | Efficient. |
| repo-match | 1 | `$0.011345` | 14,011 | 186 | Efficient. |

### Per-Agent Findings

#### triage

- Efficiency: good.
- Context: correct.
- Improvements: none urgent.
- Confidence: low issue / low improvement impact.

#### repo-match

- Efficiency: good.
- Context: correct.
- Improvements: none urgent.
- Confidence: low issue / low improvement impact.

#### scout-schema

- Efficiency: good, but likely unnecessary.
- Context: technically correct but semantically irrelevant. The issue was chat UI state, not schema/type boundary work.
- Improvements: tighten Wave 1 scout selection so schema scouts only run when issue text or planner signals schema/API/type boundary work.
- Confidence: medium issue / medium improvement impact.

#### scout-code-path

- Efficiency: cheap, but ineffective.
- Context: questionable. It returned no findings and claimed readable resources were unavailable.
- Improvements: same tool-context fix as #990. A code-path scout should have traced `apps/web/src/components/chat/` from the issue body.
- Confidence: high issue / high improvement impact.

#### scout-user-journey

- Efficiency: cheap, but ineffective.
- Context: questionable. It could not inspect workspace files, despite the issue giving a UI path.
- Improvements: same tool-context fix; add a UI scout fallback that uses the issue's `Location` path and repro steps.
- Confidence: high issue / high improvement impact.

#### scout-test-inventory

- Efficiency: mixed. It found relevant tests but consumed 421,700 input tokens.
- Context: correct.
- Improvements: search-first test inventory; avoid reading every component/lib test fully unless needed. Return test names and paths after search anchors.
- Confidence: medium issue / medium improvement impact.

#### wave2-risk-analyst

- Efficiency: good. It used 1 search, 1 read, 1 list, plus two low-value context/git calls, and cost `$0.339095`.
- Context: mostly correct. It identified async repopulation, missing regression coverage, and close-path ambiguity.
- Improvements: count `get_project_context` and `get_head_sha` against the cap; spend a remaining read on `ChatDock.tsx` before leaving an ownership open question.
- Confidence: medium issue / medium improvement impact.

#### wave2-interface-designer

- Efficiency: mixed. It produced useful artefacts, but used 11 reads and 8 searches, costing almost 2x the paired risk analyst.
- Context: partly correct. It found the right ChatPanel/ChatDock contract, but the prompt forced output through `typescript-interface` and `function-signature` artefacts instead of a UI state-transition contract.
- Improvements: same high-priority prompt update as #990. Add UI artefact kinds and hard read cap.
- Confidence: high issue / high improvement impact.

#### investigate

- Efficiency: good. It used Wave reports and only a few direct reads.
- Context: correct. It identified ChatDock/ChatPanel and the active conversation restore behavior.
- Improvements: none urgent; possible improvement is to surface when Wave 1 scouts were ineffective and which reports it actually trusted.
- Confidence: low issue / low-medium improvement impact.

#### playwright-repro

- Efficiency: good relative to #990. It used 7 reads, 1 search, and cost `$0.141232`.
- Context: correct enough. Investigation named the chat flow and files.
- Improvements: pass selector/test-id hints to reduce even the 7 reads.
- Confidence: low-medium issue / low-medium improvement impact.

#### spec-author

- Efficiency: acceptable. Two runs cost `$0.929330`, much lower than #990.
- Context: correct. It produced spec/ACs that drove implementation and deterministic QA.
- Improvements: inspect why two spec-author runs happen; avoid duplicate spec-author when first output is accepted or when second pass only repairs formatting.
- Confidence: medium issue / medium improvement impact.

#### implement-wp

- Efficiency: expensive but productive. It cost `$3.152077`, with 1.21M input tokens. It read only 8 files and used verification tools, so the high cost appears driven by long implementation/verification context, repeated lint/typecheck, and large accumulated transcript rather than broad investigation.
- Context: mostly correct. It had the right WP scope and files. It also discovered a tooling gap: `run_tests` routed Playwright spec execution through Vitest and returned zero suites, while app-level e2e script execution was unavailable.
- Improvements:
  - Give implementers the correct e2e verification tool/script when WP includes Playwright.
  - Avoid repeated lint/typecheck calls when a single bundled verification command would suffice.
  - Make deterministic QA's interface-contract expectations align with what the implementer is expected to export.
- Confidence: medium issue / medium-high improvement impact.

#### dev-review

- Efficiency: reasonable.
- Context: correct. It reviewed three changed files and one acceptance criterion.
- Improvements: no major prompt issue. It missed that QA later required exported `ChatPanelProps` and `handleChatClose`, but that looks like spec/QA contract alignment, not review drift.
- Confidence: low-medium issue / low-medium improvement impact.

#### QA

- Efficiency: good. Deterministic structural QA skipped the agent and failed quickly.
- Context: partially misaligned. It expected `ChatPanelProps` and `handleChatClose` exports. The implementer may have satisfied behavior but not the structural interface contract.
- Improvements: ensure spec-author/interface-designer artefacts that become QA structural contracts are explicitly marked as required exports, or else QA should not require export visibility.
- Confidence: high issue / high improvement impact.

#### fix-feedback implement

- Efficiency: unknown. It was orphaned by server restart.
- Context: likely minimal and correct, but run did not complete.
- Improvements: runtime orphan recovery and persistence.
- Confidence: low prompt issue / medium runtime improvement impact.

## Cross-Cutting Findings

### Finding 1: `wave2-interface-designer` is the most urgent prompt fix

Evidence:

- #990: failed over budget, `$3.051245 > $1`, no durable report.
- #991: completed usefully, but cost nearly 2x paired risk analyst.
- It lacks the explicit bounded-read language already present in `wave2-risk-analyst`.

Recommendation: update this prompt first.

### Finding 2: Wave 1 scout context/tool contract is inconsistent

Evidence:

- #990 `scout-code-path` and `scout-user-journey` reported unavailable file/search tools.
- #991 `scout-code-path`, `scout-user-journey`, and `scout-schema` reported unavailable workspace/read resources.
- These scouts should have used factory read tools or returned irrelevance, not tooling failure.

Recommendation: adjust prompts and add a focused runtime/tool exposure check.

### Finding 3: `scout-test-inventory` needs search-first discipline

Evidence:

- #990: 562,453 input tokens.
- #991: 421,700 input tokens.
- It produced useful findings, but repeated/truncated reads of test/e2e files were expensive.

Recommendation: search for test declarations first, read body only for closest tests.

### Finding 4: `playwright-repro` should not rediscover the app

Evidence:

- #990: 947,474 input tokens, 25 searches, 17 reads.
- #991: 126,167 input tokens, 7 reads, 1 search.

The delta suggests context quality matters. When investigation context is specific enough, repro stays bounded.

Recommendation: pass URL, target route, exact assertion, and selector/test-id hints.

### Finding 5: QA structural contracts need clearer authorship

Evidence:

- #991 QA failed structurally because `ChatPanelProps` and `handleChatClose` were not exported.
- Those names came from interface-designer/spec artefacts. If they are meant to be required public contracts, the implementer prompt must say so. If they are design suggestions, QA should not require export presence.

Recommendation: label interface artefacts as either `required-contract` or `suggested-shape`, and have QA enforce only required contracts.

## Proposed Implementation Order

1. Patch `wave2-interface-designer` prompt.
2. Patch Wave 1 scout prompts for tool/context correctness.
3. Lightly tune `wave2-risk-analyst`.
4. Add shared read-discipline runtime instructions.
5. Add prompt-contract tests for the caps and output modes.
6. Add telemetry/runtime warnings for duplicate reads and broad search loops.
7. Align interface-designer/spec-author/QA structural contract semantics.

## Success Metrics

- `wave2-interface-designer` no longer breaches `$1` on simple UI tasks.
- `wave2-interface-designer` average input tokens move closer to `wave2-risk-analyst`.
- Wave 1 scouts stop reporting “workspace tools unavailable” when factory read tools are exposed.
- `scout-test-inventory` stays under 200k input tokens for normal UI issues.
- `playwright-repro` stays under 200k input tokens unless it is explicitly asked to author a new broad repro harness.
- QA structural failures map to explicitly required spec/interface contracts.
