# Auth Comprehensive Audit — Engineering Spec v3

## Objective
Close every gap between the old merchant system and the new dual-realm identity
model. Every issue below is **grounded in code** — verified by the 10-layer auth
integrity harness (`scripts/verify_auth_integrity.py`).

**Baseline:** 15 critical, 28 high, 9 medium findings across 8/9 layers failing.
**Target:** 0 critical, 0 high across all 9 layers passing + Layer 10 (live) passing.

Based on: 8 investigation agents + 2 Codex design reviews + integrity harness.

---

## Verification Harness

Run after EVERY work package to track progress:
```bash
python3 scripts/verify_auth_integrity.py           # Static analysis (9 layers)
python3 scripts/verify_auth_integrity.py --live     # + live API smoke (10 layers)
python3 scripts/verify_auth_integrity.py --json     # Machine-readable output
```

---

## TIER 1: CRITICAL — Platform Users Can't Use The System

### WP1: Platform-aware organization resolver
**Harness:** Layer 1 — 1 CRITICAL + 20 HIGH findings
**Problem:** `get_current_organization()` (auth.py:765-868) returns 403 for platform users
because they have no `UserOrganization` entry. This breaks **196 call sites** across
20 files including ALL analytics, permissions, dashboards, automation, and mission control.
**Evidence:**
- `analytics.py` — 32 calls → all 28 analytics endpoints return 403
- `permissions.py` — 19 calls → `/permissions/effective` returns 403
- `permission_deps.py` — 10 calls → ALL permission checks fail (platform bypass never executes because 403 propagates before function body)
- `automation.py` — 16 calls → entire Temporal workflow system disabled
- `action_plan_status.py` — 13 calls → Mission Control completely unavailable
- `state_management.py` — 7 calls → dashboard layouts return 403
- `location_dependencies.py` — 2 calls → location context resolution fails

**Files:** `backend/app/core/auth.py`
**Fix:**
- Create `get_optional_organization()` → returns `Optional[Organization]`
- For PlatformUser with `all_orgs_access`: return None (no org scoping needed)
- For PlatformUser with `allowed_org_ids`: return first allowed org
- For TenantUser: existing behavior (require org membership via UserOrganization)
- Update `permission_deps.py` to use optional org resolver (platform users skip org check)
- Update `location_dependencies.py` to use optional org resolver

### WP2: Platform validated_context for WS
**Harness:** Layer 2 — 12 CRITICAL findings
**Problem:** `validated_context=None` for platform WS connections (ws_shared.py:497-498).
Agent tools call `get_validated_context()` which raises RuntimeError when context is None.
**Evidence (exact crash paths):**
- `tool_security.py:343` — `verify_location_access()` crashes
- `tool_security.py:386` — `verify_domain_access()` crashes
- `tool_security.py:413` — `verify_skill_access()` crashes
- `tool_security.py:451` — `verify_resource_ownership()` crashes
- `tool_security.py:555` — `get_validated_location_ids()` crashes
- `tool_security.py:577` — `filter_to_accessible_locations()` crashes
- `skill_composition_tool.py:136` — crashes in production (try/except returns security error)
- `context.py:163,194,198,291` — legacy wrappers also crash

**Files:** `backend/app/api/v1/ws_shared.py`, `backend/app/agents/assistant/tool_security.py`, `backend/app/agents/assistant/context.py`
**Fix:**
- Create `PlatformValidatedContext` with `all_orgs_access=True`
- Set `accessible_location_id_strings=None` (None = "all access", [] = "no access")
- In `ws_shared.py:497`: create PlatformValidatedContext for platform realm
- In `tool_security.py`: 7 functions need `if context.accessible_location_id_strings is None → skip filtering`
- In `context.py`: update `get_validated_location_ids()` wrapper to handle None context
- In `skill_composition_tool.py:136`: replace `get_validated_context()` with `get_validated_context_safe()`

### WP3: Fix selectRealm + org switching
**Harness:** Layer 6 — 1 CRITICAL; Layer 9 — 1 HIGH
**Problem:** `switchOrganization()` (AuthContext.tsx:1106-1114) is client-only — no backend
API call, so the JWT token still carries the old org_id. Permissions cache not invalidated.
**Evidence:**
- AuthContext.tsx:1106-1114: `switchOrganization` only updates local React state
- No `/auth/switch-org` API call anywhere in codebase
- usePermissions.ts: cache key is `permissionsCacheUserId` only — no org_id

**Files:** `frontend/app/contexts/AuthContext.tsx`, `backend/app/api/v1/auth.py`
**Fix:**
- Backend: Add `POST /auth/switch-org` endpoint that mints new tokens with updated org_id
- Frontend: `switchOrganization()` → async, call `/auth/switch-org`, update tokens + session
- After org switch: invalidate permissions cache, refresh LocationContext

### WP4: Platform location access + demo fallback removal
**Harness:** Layer 7 — 3 HIGH + 5 MEDIUM findings
**Problem:** Platform users get no locations from backend (403 from org resolver).
LocationContext silently falls back to hardcoded demo UUID `7368c941-...` with fake
"STBI - Atlanta" data. Platform users unknowingly query demo data.
**Evidence:**
- `LocationContext.tsx:65` — `DEFAULT_LOCATION_ID = '7368c941-...'`
- `LocationContext.tsx:107-119` — empty response → falls back to demo
- `LocationContext.tsx:149-161` — error → falls back to demo
- `metrics-client.ts:448` — another hardcoded fallback
- `config.ts:102` — `getDefaultLocationId()` returns same demo UUID

**Files:** `backend/app/api/v1/analytics.py`, `frontend/app/contexts/LocationContext.tsx`, `frontend/lib/config.ts`, `frontend/lib/metrics-client.ts`
**Fix:**
- Backend: `/locations/accessible` use `get_optional_organization()` (from WP1). For platform users, query ALL active locations across ALL orgs.
- Frontend: Remove `DEFAULT_LOCATION_ID` and demo fallback from LocationContext
- Frontend: Remove hardcoded UUID from `config.ts:102` and `metrics-client.ts:448`
- Frontend: Empty state UI — "Select an organization" for platform users, "No locations" for tenant
- Frontend: Add `all_orgs_access: boolean` to `AuthSession` interface, populate from `/auth/me`

---

## TIER 2: HIGH — Security + Correctness

### WP5: Fix registry Gate 1 bug
**Harness:** Layer 5 — 1 CRITICAL finding
**Problem:** `registry.py:188` — Empty `allowed_agents=[]` bypasses access check.
Python truthiness: `if user_context.allowed_agents and ...` → `[]` is falsy → short-circuits.
**Evidence:** Exact line: `if user_context.allowed_agents and manifest.agent_type not in user_context.allowed_agents:`
**Files:** `backend/app/agents/platform/registry.py`
**Fix:** Change to: `if user_context.allowed_agents is not None and manifest.agent_type not in user_context.allowed_agents:`

### WP6: Add capability checks to 33 endpoints
**Harness:** Layer 3 — 3 HIGH findings
**Problem:** 33 admin endpoints use `require_platform` as sole auth → any platform user
(even support tier) can access engineer/SRE features.
**Evidence:**
- `admin_analytics.py` — 18 `require_platform` references, 0 `require_capability`
- `admin_agent.py` — 7 `require_platform`, 0 `require_capability`
- `observability.py` — 8 `require_platform`, 0 `require_capability`

**Files:** `admin_analytics.py`, `admin_agent.py`, `observability.py`, `s4_admin_cache.py`
**Fix:**
- admin_analytics (17 endpoints): `require_capability("admin:support")` — read-only analytics
- admin_agent (6 endpoints): `require_capability("admin:engineer")` — session management
- observability (7 endpoints): `require_capability("admin:support")` — monitoring
- cache flush (1 endpoint): `require_capability("admin:engineer")` — destructive
- cache stats (1 endpoint): `require_capability("admin:support")` — read-only
- ml_ops read (8): already `require_platform` — keep as-is (read-only diagnostics)
- ml_ops write (5): already has `require_capability("admin:engineer")` ✅

### WP7: Schema contract cleanup
**Harness:** Layer 4 — 1 HIGH + 1 MEDIUM finding
**Problem:** `is_admin` field in UserSummary/UserDetail schemas but column DROPPED from
users table. Legacy `super_admin_email`/`super_admin_tier` fields still in AuditLogEntry.
AuditLogDetail missing 8+ DB columns with `extra="forbid"` → 500 on detail endpoint.
**Evidence:**
- `super_admin_schemas.py` — 2 `is_admin` references in schemas
- `super_admin_schemas.py` — 5 `super_admin_email`/`super_admin_tier` references
- DB columns not in AuditLogDetail: `entry_hash`, `user_agent`, `request_id`, `previous_state`, `new_state`, `previous_log_hash`, `target_id`, `session_id`

**Files:** `backend/app/schemas/super_admin_schemas.py`
**Fix:**
- Remove `is_admin` from UserSummary/UserDetail → add `is_platform_user: bool` (populated from platform_roles join)
- AuditLogDetail: add missing fields OR change `extra="forbid"` to `extra="ignore"`
- Replace `super_admin_email`/`super_admin_tier` with `user_email`/`realm`
- Align AuditLogCreateInternal with new field names

### WP8: Impersonation cookie fix
**Problem:** End impersonation returns tokens in body only, not cookies.
**Harness:** Not directly detected (Layer 8 only checks auth routes, not impersonation).
**Files:** `backend/app/api/v1/platform_admin/impersonation.py`
**Fix:** Set cookies in response, matching start_impersonation pattern.

---

## TIER 3: DESIGN/UX — Platform User Experience

### WP9: Login UX for MFA + realm selection
**Problem:** Main login page redirects to /ask immediately after login() — but login()
can return `pendingLogin` for MFA or realm selection. No UI for these flows.
**Files:** `frontend/app/(auth)/login/page.tsx`
**Fix:**
- After `login()`, check for `pendingLogin` state before redirecting
- If `mfa_required`: show TOTP input inline
- If `realm_selection_required`: show realm picker
- Only redirect to /ask after auth is truly complete (tokens in cookies)

### WP10: Platform user UI identity
**Harness:** Layer 9 — 1 MEDIUM finding
**Problem:** `UserMenu.tsx:51` shows `'No organization'` for platform users.
**Evidence:** Exact code: `{currentOrganization?.name || 'No organization'}`
**Files:** `frontend/app/components/UserMenu.tsx`, `frontend/app/components/settings/ProfileHeader.tsx`
**Fix:**
- UserMenu: if `session.realm === 'platform'`, show tier name instead of org name
- Show "All Organizations" instead of "No organization"
- ProfileHeader: show platform tier badge

### WP11: Frontend all_orgs_access state model
**Harness:** Layer 6 — 1 HIGH finding (missing from frontend types)
**Problem:** Frontend has no `all_orgs_access` concept. Platform users get treated like
tenant users with no org.
**Evidence:** `all_orgs_access` returns 0 results in frontend grep — field doesn't exist.
**Files:** `frontend/app/contexts/AuthContext.tsx`, `frontend/app/contexts/LocationContext.tsx`
**Fix:**
- Add `all_orgs_access: boolean` to `AuthSession` interface
- Populate from `/auth/me` response (already returned by backend)
- LocationContext: if `all_orgs_access`, fetch all locations grouped by org
- `_completeLogin()`: for platform realm, don't force-pick a default org

### WP12: Permissions cache invalidation on org switch
**Harness:** Layer 9 — 1 HIGH finding
**Problem:** `usePermissions.ts` cache key is `permissionsCacheUserId` only — no org_id.
After org switch, stale permissions persist for TTL duration.
**Evidence:** Grep for `org_id` in usePermissions.ts returns 0 results.
**Files:** `frontend/app/hooks/usePermissions.ts`
**Fix:**
- Add `org_id` to cache key
- On org switch (from WP3): trigger cache invalidation
- Force refetch of `/permissions/effective` with new org context

---

## Execution Order

**Batch 1 (CRITICAL — parallel):** WP1, WP2, WP3, WP4
**Batch 2 (HIGH — parallel):** WP5, WP6, WP7, WP8
**Batch 3 (DESIGN — parallel):** WP9, WP10, WP11, WP12

Each batch: build → run `verify_auth_integrity.py` → commit → next batch.

## Acceptance Criteria

| # | Criteria | Harness Layer | Verify |
|---|---------|---------------|--------|
| AC1 | `get_optional_organization` exists | Layer 1 → 0 critical | `grep "def get_optional_organization" backend/` |
| AC2 | Platform WS tools don't crash | Layer 2 → 0 critical | Send WS message as platform user |
| AC3 | Org switch calls backend API | Layer 6 → 0 critical | Network tab shows `/auth/switch-org` |
| AC4 | No demo location fallbacks | Layer 7 → 0 high | `grep "7368c941" frontend/` → 0 |
| AC5 | Gate 1 uses `is not None` | Layer 5 → 0 critical | `grep "is not None" registry.py` |
| AC6 | 33 endpoints have capability checks | Layer 3 → 0 high | `grep "require_capability" admin_analytics.py` |
| AC7 | No `is_admin` in schemas | Layer 4 → 0 high | `grep "is_admin" super_admin_schemas.py` → 0 |
| AC8 | Impersonation sets cookies | Manual | End impersonation, check cookies |
| AC9 | Login handles MFA/realm inline | Manual | Login with dual-realm user |
| AC10 | UserMenu shows tier label | Layer 9 → 0 medium | `grep "No organization" UserMenu.tsx` → 0 |
| AC11 | `all_orgs_access` in frontend | Layer 6 → 0 high | `grep "all_orgs_access" AuthContext.tsx` |
| AC12 | Permissions cache includes org_id | Layer 9 → 0 high | `grep "org_id" usePermissions.ts` |
| AC13 | Full harness passes | All layers | `python3 scripts/verify_auth_integrity.py` exit 0 |
| AC14 | Live API smoke passes | Layer 10 | `python3 scripts/verify_auth_integrity.py --live` exit 0 |
