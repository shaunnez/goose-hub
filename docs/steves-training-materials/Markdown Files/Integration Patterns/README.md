# Integration Templates

Three files. Read in order.

| File | Read time | Purpose |
|---|---|---|
| [`INTEGRATION_PATTERN.md`](./INTEGRATION_PATTERN.md) | 10 min | Doctrine. Why SDK/CLI over MCP. ReAct guarantees. Progressive disclosure. The seven rules. |
| [`NEW_SDK_INTEGRATION.md`](./NEW_SDK_INTEGRATION.md) | copy & swap | Fill-in-the-blank scaffold for any vendor that ships a Python SDK. |
| [`NEW_CLI_INTEGRATION.md`](./NEW_CLI_INTEGRATION.md) | copy & swap | Fill-in-the-blank scaffold for vendors with only a CLI. Subprocess discipline + snapshot replay. |

The companion deck — `documentation/tooling-philosophy-no-mcp.pptx` — is the
20-minute readout version of `INTEGRATION_PATTERN.md`.

## Worked examples in this codebase

- **Foundry** — `backend/app/services/foundry/` — mixin-per-domain SDK wrapper.
  See `search.py` for the auto-detect-level pattern, `merchant.py` for
  per-call field whitelisting.
- **Jira** — `backend/app/services/jira_service.py` +
  `backend/app/agents/admin_assistant/tools/jira_tools.py` — regex-first
  auto-detect, `_SEARCH_FIELDS` constant, 500-char description cap, 365-day
  default bound, `asyncio.to_thread` over a sync SDK.

Read both before writing a new integration.
