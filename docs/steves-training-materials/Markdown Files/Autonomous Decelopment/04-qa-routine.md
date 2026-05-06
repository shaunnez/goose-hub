# Training: Building a QA Routine

How to build a deterministic, layered QA harness that verifies your application
end-to-end without spending LLM tokens on browser mechanics. This document teaches
the pattern; the companion template at the end is pluggable.

---

## Philosophy: Deterministic Harnesses, Not AI Testing

Traditional AI-driven QA asks a language model to "look at the page and decide if
it looks right." This is expensive, non-reproducible, and unreliable.

The pattern here is different: **deterministic scripts drive the browser and APIs,
with structured assertions that produce machine-readable results.** Zero LLM tokens
are spent on browser mechanics. The LLM orchestrates (decides what to test, interprets
results, dispatches fixes), but measurement is purely programmatic.

---

## The 6-Layer Architecture

Every QA harness should cover these 6 layers, in order:

| Layer | Name | What It Checks | Requires |
|-------|------|----------------|----------|
| 1 | **Authentication** | Login succeeds, cookies/tokens present, session valid | Browser (Playwright) |
| 2 | **Navigation** | All routes load without 500/blank, expected DOM selectors present | Browser |
| 3 | **Console Errors** | No real JS errors (safe patterns filtered out) | Browser |
| 4 | **API Contracts** | Key endpoints return expected status codes + valid JSON shapes | HTTP client (httpx/fetch) |
| 5 | **Feature Smoke** | Core features produce expected outputs (e.g., streamed responses) | App-specific |
| 6 | **UX Interactions** | Interactive scenarios (click, fill, assert) pass | Browser |

**Why this order:** Each layer depends on the previous. If auth fails, navigation
is meaningless. If navigation fails, console errors are noise. The layers form a
dependency chain -- fail early, fail fast.

---

## Two Modes of Operation

### Mode 1: Full Run (Default)

Run all 6 layers. Used for ship-readiness checks:

```bash
python3 scripts/qa_harness.py --full --json
```

Output: JSON with `ship_ready: bool` + per-layer results.

### Mode 2: Directed Run (Targeted QA)

When you know what changed, test only the affected layers with custom scenarios:

```json
{
  "description": "What you're testing and why",
  "auth_mode": "default",
  "focus_layers": [1, 2, 6],
  "focus_routes": ["/dashboard", "/settings"],
  "ux_scenarios": [
    {
      "name": "New feature works",
      "route": "/dashboard",
      "setup_steps": [
        {"action": "click", "selector": "button:has-text('New')"}
      ],
      "assertions": [
        {"check_type": "visible", "selector": "[data-testid='new-item']"}
      ]
    }
  ]
}
```

```bash
python3 scripts/qa_harness.py --directive /tmp/qa_directive.json --json
```

---

## Layer Design Patterns

### Layer 1: Authentication

```python
# Playwright login flow
async def check_auth(page, credentials):
    await page.goto(LOGIN_URL)
    await page.fill('[name="email"]', credentials.email)
    await page.fill('[name="password"]', credentials.password)
    await page.click('button[type="submit"]')
    await page.wait_for_url(EXPECTED_POST_LOGIN_URL, timeout=15000)

    # Verify auth artifacts
    cookies = await page.context.cookies()
    has_session = any(c['name'] == SESSION_COOKIE for c in cookies)
    return CheckResult(passed=has_session, detail="Session cookie present")
```

**Key rule:** Never use `waitForTimeout` for auth. Always use `waitForURL` or
`waitForSelector` -- deterministic signals, not arbitrary delays.

### Layer 2: Navigation

```python
# Check every route loads
ROUTES = ["/", "/dashboard", "/settings", "/profile"]

async def check_navigation(page):
    results = []
    for route in ROUTES:
        await page.goto(f"{BASE_URL}{route}")
        status = page.url  # Did it redirect to error?
        has_content = await page.locator(EXPECTED_SELECTORS[route]).count() > 0
        results.append(CheckResult(
            route=route,
            passed=has_content and "/error" not in status,
        ))
    return results
```

### Layer 3: Console Errors

```python
# Collect and filter console errors
SAFE_PATTERNS = [
    "favicon.ico",
    "DevTools",
    "ResizeObserver loop",
    "third-party cookie",
]

async def check_console(page, messages):
    real_errors = [
        m for m in messages
        if m.type == "error"
        and not any(p in m.text for p in SAFE_PATTERNS)
    ]
    return CheckResult(passed=len(real_errors) == 0, errors=real_errors)
```

### Layer 4: API Contracts

```python
# HTTP-level endpoint checks (no browser needed)
import httpx

ENDPOINTS = [
    {"path": "/api/health", "method": "GET", "expected_status": 200},
    {"path": "/api/users/me", "method": "GET", "expected_status": 200},
    {"path": "/api/data", "method": "GET", "expected_status": 200},
]

async def check_api_contracts(client, auth_headers):
    results = []
    for ep in ENDPOINTS:
        resp = await client.request(ep["method"], ep["path"], headers=auth_headers)
        passed = resp.status_code == ep["expected_status"]
        if passed and resp.headers.get("content-type", "").startswith("application/json"):
            # Optionally validate JSON shape
            body = resp.json()
            passed = isinstance(body, (dict, list))
        results.append(CheckResult(endpoint=ep["path"], passed=passed))
    return results
```

### Layer 5: Feature Smoke

```python
# Application-specific feature checks
# Example: verify a chat/streaming feature
async def check_feature_smoke(client, auth_headers):
    # Send a test prompt
    resp = await client.post("/api/chat", json={"message": "test"}, headers=auth_headers)

    # Check streaming events (SSE)
    events = parse_sse(resp.text)
    has_tokens = any(e["type"] == "token" for e in events)
    has_done = any(e["type"] == "done" for e in events)

    return CheckResult(passed=has_tokens and has_done)
```

### Layer 6: UX Interactions

```python
# Mechanical Playwright scenarios
async def check_ux(page, scenarios):
    results = []
    for scenario in scenarios:
        await page.goto(f"{BASE_URL}{scenario.route}")

        # Execute setup steps
        for step in scenario.setup_steps:
            if step.action == "click":
                await page.click(step.selector)
            elif step.action == "fill":
                await page.fill(step.selector, step.value)
            elif step.action == "wait_for_selector":
                await page.wait_for_selector(step.selector, timeout=10000)

        # Run assertions
        for assertion in scenario.assertions:
            if assertion.check_type == "visible":
                count = await page.locator(assertion.selector).count()
                passed = count > 0
            elif assertion.check_type == "text_contains":
                text = await page.locator(assertion.selector).text_content()
                passed = assertion.expected in (text or "")
            elif assertion.check_type == "hidden":
                count = await page.locator(assertion.selector).count()
                passed = count == 0

            results.append(CheckResult(
                scenario=scenario.name,
                assertion=assertion.description,
                passed=passed,
            ))
    return results
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Ship ready (all checks pass) |
| 1 | Not ship ready (at least one FAIL) |
| 2 | Infrastructure error (services down, browser won't launch) |

Exit codes make the harness usable in CI/CD pipelines and by other scripts.

---

## Integration with Fix Loops

The QA harness is the "measure" step in a fix loop:

```
QA harness (measure) -> findings -> triage -> fix -> QA harness (verify) -> repeat
```

When integrated with a lifecycle or hardening loop:
1. Run `qa_harness.py --full --json`
2. Parse JSON output
3. For each failure: `state_tool add-finding "<summary>" <category> <severity>`
4. Enter fix loop (triage -> fix -> verify)
5. Re-run harness to confirm fixes and check for regressions

---

## Rules

1. **NEVER spawn sub-agents for browser testing.** The harness handles everything.
2. **NEVER write Playwright specs.** Use directive JSON for custom scenarios.
3. **NEVER use `waitForTimeout` for auth.** Use `waitForURL` or `waitForSelector`.
4. **Docker services must be running** before invoking the harness.
5. If the harness exits non-zero, **report findings** -- do not mark work as complete.

---

## Pluggable Template

Copy everything below into `scripts/qa_harness.py` structure or adapt to your
framework. Replace `{{placeholders}}` with your specifics.

---

```markdown
---
name: QA
description: >
  Run the UAT harness for end-to-end verification. Deterministic {{LAYER_COUNT}}-layer
  Playwright+httpx harness. Zero LLM tokens for browser mechanics.
  Trigger: /QA, "run QA", "test the app", "verify everything works"
---

# QA -- UAT Harness

## What This Skill Does

Runs `scripts/{{qa_script}}.py` -- a {{LAYER_COUNT}}-layer deterministic harness that
tests {{layer_summary}}.

## Quick Reference

```bash
# Full run
python3 scripts/{{qa_script}}.py --full

# Specific layers
python3 scripts/{{qa_script}}.py --layer 1 --layer 2

# JSON output
python3 scripts/{{qa_script}}.py --full --json

# Directed testing
python3 scripts/{{qa_script}}.py --directive /tmp/qa_directive.json --json
```

## Layers

| Layer | Name | What It Checks |
|-------|------|----------------|
| 1 | Authentication | {{auth_description}} |
| 2 | Navigation | {{nav_description}} |
| 3 | Console Errors | {{console_description}} |
| 4 | API Contracts | {{api_description}} |
| 5 | Feature Smoke | {{smoke_description}} |
| 6 | UX Interactions | {{ux_description}} |

## Directed Testing Format

```json
{
  "description": "What and why",
  "auth_mode": "{{default_auth}}",
  "focus_layers": [1, 2, 6],
  "focus_routes": ["{{route_1}}", "{{route_2}}"],
  "ux_scenarios": [
    {
      "name": "Scenario name",
      "route": "{{route}}",
      "setup_steps": [
        {"action": "click", "selector": "{{selector}}"}
      ],
      "assertions": [
        {"check_type": "visible", "selector": "{{selector}}", "description": "What it proves"}
      ]
    }
  ]
}
```

**Actions:** click, fill, select, hover, press, wait_for_selector, wait_for_text, screenshot
**Assertions:** visible, hidden, text_contains, url_contains, count_gte, has_attribute, no_error_toast

## Exit Codes

- `0` = ship ready
- `1` = not ship ready
- `2` = infrastructure error

## Rules

- NEVER spawn sub-agents for browser testing -- the harness handles everything
- NEVER write Playwright specs -- use directive JSON instead
- Docker/services must be running before invoking
- If exit non-zero, report findings -- do not mark lifecycle as complete
```

---

**End of QA Routine Training Document**
