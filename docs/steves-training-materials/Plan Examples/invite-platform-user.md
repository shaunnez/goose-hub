# Invite Platform User — Engineering Spec

## Objective
Add ability to create Shift4 platform employees directly from the admin users page.
Currently, platform admins can only be created by promoting existing users. This adds
a "create from scratch" flow: enter email + name + tier → user account created +
platform role assigned + welcome email sent.

## Acceptance Criteria

| # | Criteria | Verify |
|---|---------|--------|
| AC1 | POST /admins/invite creates User + PlatformRole + sends email | curl test |
| AC2 | Frontend create-user modal has "Customer" / "Platform Employee" toggle | visual |
| AC3 | Platform Employee mode shows tier dropdown, hides org/role/locations | visual |
| AC4 | Platform Employee mode calls /admins/invite (not /users/create) | network tab |
| AC5 | New platform user can log in with temp password | login test |
| AC6 | New platform user has correct capabilities from tier | /auth/me check |

## Architecture

**Current:** create_super_admin (POST /admins) requires existing user_id → promotion only.
**New:** POST /admins/invite accepts email + name + tier → creates user + role in one call.

Flow:
```
Admin clicks "Create User" → selects "Platform Employee" → enters email, name, tier
→ POST /api/v1/super-admin/admins/invite
→ Backend: create User (hashed temp password) → create PlatformRole → send welcome email
→ Response: { user_id, email, tier, email_sent }
```

## Work Packages

### WP1: Backend endpoint (backend)
**Files:** `backend/app/api/v1/platform_admin/admins.py`, `backend/app/schemas/super_admin_schemas.py`

1. Add `PlatformUserInviteRequest` schema to super_admin_schemas.py:
   - email: EmailStr (required)
   - full_name: str (required, min 2, max 200)
   - tier: str (required, pattern support|engineer|sre|platform)
   - temporary_password: str (required, min 12, max 128)
   - send_welcome_email: bool (default True)

2. Add `PlatformUserInviteResponse` schema:
   - user_id: UUID
   - email: str
   - tier: str
   - platform_role_id: UUID
   - email_sent: bool

3. Add endpoint to admins.py:
   ```python
   @router.post("/admins/invite", response_model=PlatformUserInviteResponse)
   async def invite_platform_user(
       request: PlatformUserInviteRequest,
       http_request: Request,
       db: AsyncSession = Depends(get_app_db),
       user: PlatformUser = Depends(require_capability("admin:platform")),
   ):
   ```

   Logic:
   - Check email not already in users table
   - Create User (email, full_name, hashed password, is_active=True, email_verified=True)
   - Look up permission set by tier (reuse tier_to_ps_name mapping from create_super_admin)
   - Create PlatformRole (user_id, permission_set_id, activated_by=user.id)
   - Send welcome email via email_service.send_welcome_email() (no org name — use "Shift4 Platform")
   - Audit log
   - Return response

### WP2: Frontend modal enhancement (frontend)
**Files:** `frontend/app/s4-admin/users/page.tsx`

1. Add state: `createUserType: 'customer' | 'platform'` (default 'customer')
2. Add state: `createPlatformTier: string` (default 'support')
3. Add user type toggle at top of modal (before email field):
   - Two buttons: "Customer" / "Platform Employee"
   - Styled like the existing setup_mode toggle
4. When "Platform Employee" selected:
   - Hide: org search, role dropdown, location checkboxes, setup mode toggle, personal message
   - Show: tier dropdown (Support/Engineer/SRE/Platform)
   - Always show: email, full name, temp password fields, send email toggle
5. Submit handler: if userType === 'platform', call `invitePlatformUser()` instead of `createUser()`

### WP3: Hook function (frontend)
**Files:** `frontend/app/hooks/usePlatformAdminContext.ts`

Add `invitePlatformUser()` function:
```typescript
const invitePlatformUser = useCallback(async (request: {
  email: string;
  fullName: string;
  tier: string;
  temporaryPassword: string;
  sendWelcomeEmail: boolean;
}) => {
  const response = await fetch(`${API_BASE}/admins/invite`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      email: request.email,
      full_name: request.fullName,
      tier: request.tier,
      temporary_password: request.temporaryPassword,
      send_welcome_email: request.sendWelcomeEmail,
    }),
  });
  // ... handle response
}, [getAuthHeaders]);
```

Export it from the hook's return value.

## Execution Order
WP1 → WP3 → WP2

Backend first (endpoint exists), then hook function (API call), then UI (uses hook).

## Risk Register

| Risk | Severity | Mitigation |
|------|---------|-----------|
| Duplicate email | LOW | Backend checks users table before creating |
| Weak password | LOW | Schema enforces min 12 chars; frontend shows password validator |
| Welcome email fails | LOW | Email is best-effort; response shows email_sent=false |
