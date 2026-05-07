# Webhook Setup Runbook

## What the Webhook Does

The GitHub webhook enables Goose Hub to receive real-time push notifications from your target repositories. When events occur (issues opened, labeled, etc.), GitHub sends a signed POST request to your Goose Hub server, triggering Factory workflows without polling delays. This enables:

- **State-source updates**: New issues and label changes immediately propagate to the Factory orchestrator
- **Instant dispatch**: `factory:investigating` and `factory:triaging` labels trigger workflows within seconds of being applied
- **Triage automation**: `issues.opened` events dispatch batch triage workflows

Without the webhook, Goose Hub relies on periodic polling, which adds latency and wastes API quota. The webhook is optional but recommended for responsive local-first development.

## Payload URL and Endpoint

The Goose Hub server exposes a single webhook endpoint:

```
POST https://<your-host>/webhooks/github
```

Examples:
- **Production** (ngrok or public domain): `https://abc123.ngrok.io/webhooks/github` or `https://goose-hub.example.com/webhooks/github`
- **Local development with ngrok**: `https://<ngrok-generated-url>/webhooks/github` (see [ngrok setup](#local-development-with-ngrok) below)

The server validates the webhook signature and responds with `200 OK` on success, `401` on signature mismatch, and `400` on malformed JSON.

## Required Events

Configure GitHub to send the following event types:

| Event Type | Action(s) | Purpose |
|---|---|---|
| **Issues** | opened, labeled | Triggers triage on new issues; routes `factory:*` labels to dispatch workflows |

**Why only these events:**

The current webhook handler (M12) processes the `issues` event and dispatches based on action:
- `issues.opened` → `dispatchTriageBatch(slug)` (runs triage workflows)
- `issues.labeled` with `factory:*` label → `dispatchForLabel(slug, issueNumber, labelName)` (routes to specific workflow)

All other events are acknowledged but ignored. Future milestones (M14+) may add support for pull_request, push, and issue_comment events; see `PLAN.md` section 28.

## Secret Setup

The webhook uses HMAC-SHA256 to sign requests. GitHub includes the signature in the `X-Hub-Signature-256` header; Goose Hub validates it using a pre-shared secret.

### Generate a Secret

Use a cryptographically secure random string (minimum 32 characters):

```bash
# macOS / Linux
openssl rand -hex 32

# or
head -c 32 /dev/urandom | base64
```

Example output:
```
a7f3c9e1d4b2f6a8c0e5d9b1f4a7c2e6
```

### Store the Secret

1. **Add to `.env` file** (Goose Hub root):
   ```bash
   GITHUB_WEBHOOK_SECRET=a7f3c9e1d4b2f6a8c0e5d9b1f4a7c2e6
   ```

2. **Load on server start**:
   The server loads `.env` on startup via `dotenv` (see `apps/server/src/index.ts`). The secret is required:
   ```typescript
   if (process.env.GITHUB_WEBHOOK_SECRET == null || process.env.GITHUB_WEBHOOK_SECRET.length === 0) {
     throw new Error('GITHUB_WEBHOOK_SECRET env var is required to start the server');
   }
   ```

3. **Restart the server** after updating `.env`:
   ```bash
   pnpm --filter @goose-hub/server dev
   ```

### Add Secret to GitHub

In your target repository's webhook settings:

1. Navigate to **Settings** → **Webhooks** → **Add webhook** (or edit existing)
2. Enter the **Payload URL** (see [Payload URL and Endpoint](#payload-url-and-endpoint))
3. Under **Secret**, paste your secret value
4. Leave **Content type** as `application/json`
5. Ensure **Active** is checked
6. Click **Add webhook** or **Update webhook**

**Security note:** GitHub masks the secret in the UI after you save it. You cannot retrieve it; if lost, regenerate and update both Goose Hub `.env` and the GitHub webhook settings.

## Local Development with ngrok

For local development, use ngrok to expose your machine's port 3001 to the internet.

### Install ngrok

**macOS (via Homebrew):**
```bash
brew install ngrok
```

**Linux / Windows:**
Download from [ngrok.com](https://ngrok.com/download) or use your package manager.

### Run Goose Hub Server

In one terminal, start the server with `GITHUB_WEBHOOK_SECRET`:

```bash
export GITHUB_WEBHOOK_SECRET="your-secret-here"
pnpm --filter @goose-hub/server dev
```

The server listens on `http://localhost:3001`.

### Start ngrok Tunnel

In another terminal:

```bash
ngrok http 3001
```

ngrok outputs something like:

```
ngrok                                                                          (Ctrl+C to quit)

Session Status                online
Account                       your-email@example.com
Version                        3.x.x
Region                         us-west (us-west)
Latency                        12ms
Web Interface                  http://127.0.0.1:4040

Forwarding                     https://abc123def456.ngrok.io -> http://localhost:3001

Connections                    ttl    opn     dl      in      out
                               0      0       0       0B      0B
```

### Use the ngrok URL

Copy the HTTPS URL (`https://abc123def456.ngrok.io`). This is your public webhook endpoint:

```
https://abc123def456.ngrok.io/webhooks/github
```

Use this as your **Payload URL** in GitHub webhook settings (see [Add Secret to GitHub](#add-secret-to-github)).

**Important:** The ngrok tunnel is ephemeral. Each time you restart ngrok, you get a new URL. Either:
- **Update the webhook in GitHub** after restarting ngrok, or
- **Use ngrok's authtoken** to reserve a static domain (requires a paid ngrok account)

### Monitor Webhook Events

While ngrok is running, open its web dashboard:

```
http://127.0.0.1:4040
```

You can see:
- **Requests sent by GitHub** (HTTP method, path, headers)
- **Server responses** (status code, response body)
- **Request/response payloads** (in JSON)

Use this to debug signature mismatches or payload parsing errors.

## New Repository Setup

1. **Set up target project config:**
   Follow the bootstrap workflow (M12) to scaffold `target-projects/<slug>/project.config.ts` and install `factory:*` labels on the target repo.

2. **Add webhook to the target repo:**
   - Navigate to **Settings** → **Webhooks** → **Add webhook**
   - Enter **Payload URL**: `https://<your-host>/webhooks/github`
   - Enter **Secret**: (same secret you configured in `.env`)
   - Check **Issues** events (opened, labeled)
   - Leave **Active** checked
   - Click **Add webhook**

3. **Test the webhook:**
   - In the target repo, open a new issue
   - Check Goose Hub logs: `pnpm --filter @goose-hub/server dev`
   - Look for `webhook dispatch` or `dispatchTriageBatch` log entries
   - Verify the issue appears in Goose Hub UI

## Updating an Existing Webhook

If you need to change the webhook configuration (e.g., update events, rotate secret, or move to a new server):

1. **In the target repo's webhook settings:**
   - Navigate to **Settings** → **Webhooks** → select the webhook

2. **Update the fields:**
   - To change the **Payload URL**: update the field and save
   - To **change events**: check/uncheck the event types and save
   - To **rotate the secret**: generate a new secret, update `.env` on the server, update the GitHub **Secret** field, and save

3. **Test delivery:**
   - GitHub provides a **Recent Deliveries** tab showing the history of webhook calls
   - Click a delivery to see the request/response
   - Look for `200 OK` status and `"ok": true` in the response body

## Verification

To confirm the webhook is working:

### 1. Check Recent Deliveries (GitHub UI)

- In the target repo, go to **Settings** → **Webhooks** → select the webhook
- Scroll to **Recent Deliveries**
- Look for successful `200` responses with `"ok": true` in the response body

### 2. Check Server Logs

```bash
# Terminal running the server should show:
webhook dispatch — dispatched / event: issues / action: labeled
```

### 3. Monitor via ngrok Dashboard (Local Dev Only)

If using ngrok:
```
http://127.0.0.1:4040
```

Click on a request to see full headers, payload, and response.

### 4. Check Event Stream (UI)

If the target project is registered in Goose Hub, navigate to **Events** and look for:
- `webhook.dispatched` events (when the webhook fires)
- Workflow dispatch events (when a label triggers an action)

## Troubleshooting

### Signature Mismatch (401 Unauthorized)

**Symptom:** GitHub Recent Deliveries shows `401` responses with `{"error": "invalid signature"}`.

**Causes and solutions:**

1. **Secret mismatch:**
   - Verify the secret in `GITHUB_WEBHOOK_SECRET` matches the secret in the GitHub webhook settings
   - Regenerate if unsure: `openssl rand -hex 32` → update `.env` → restart server → update GitHub webhook settings

2. **Request body tampering:**
   - Ensure the server is receiving the raw request body unchanged
   - If behind a reverse proxy, ensure the proxy is not re-encoding the body
   - Check proxy logs for payload modifications

3. **Timing attack:**
   - Extremely unlikely; the server uses `timingSafeEqual` to prevent timing attacks
   - If suspicious, restart both the server and regenerate the secret

### Webhook Not Firing

**Symptom:** You label an issue, but the webhook doesn't appear in Recent Deliveries.

**Causes and solutions:**

1. **Webhook is not active:**
   - Check the webhook settings; ensure **Active** is checked

2. **Payload URL is unreachable:**
   - Test the URL in a browser: `curl https://<your-host>/webhooks/github` (should return `405 Method Not Allowed` since it only accepts POST)
   - If using ngrok, ensure the tunnel is still running and the URL is current
   - Check firewall/network settings; the server may be blocking inbound HTTPS

3. **Wrong events selected:**
   - Ensure **Issues** is checked in the webhook settings
   - The server only processes `X-GitHub-Event: issues` headers; other events are acknowledged but ignored

4. **Repository not in allowlist:**
   - The handler has a hardcoded allowlist in `REPO_TO_SLUG` (currently only `shaunnez/goose-hub` → `goose-hub-self`)
   - This is expected during M12; multi-repo support comes in later milestones
   - Check the handler code: `apps/server/src/domains/webhooks/handler.ts`

### Invalid JSON Response (400 Bad Request)

**Symptom:** GitHub Recent Deliveries shows `400` responses with `{"error": "invalid JSON"}`.

**Causes and solutions:**

1. **Server not receiving raw body:**
   - Ensure the request header `Content-Type: application/json` is present
   - GitHub sets this automatically; if missing, check the reverse proxy config
   - Try toggling the webhook off/on to trigger a re-send

2. **Server bug:**
   - Check the server logs for parsing errors
   - File an issue if the server is not parsing valid JSON

## Notes and Limitations (M12)

- **Repository allowlist:** The webhook handler currently routes only `shaunnez/goose-hub` to the orchestrator. Other target projects require updates to `REPO_TO_SLUG` in `handler.ts` or a future milestone's dynamic registration (expected in M14+).
- **Event filtering:** Only the `issues` event is processed. Push, pull_request, and issue_comment events will be acknowledged (HTTP 200) but ignored. Future support planned for M14+.
- **No automatic webhook installation:** The bootstrap workflow (M12.04) detects the stack and scaffolds config, but does not automatically install the webhook. This runbook provides the manual steps; automatic installation is deferred to a future milestone.
- **End-to-end testing:** This runbook was verified against the webhook handler code (`apps/server/src/domains/webhooks/handler.ts`). Final end-to-end webhook testing with a real repository is planned for M12.09 (#311), which runs the full bootstrap workflow and tests the webhook in a real project.

## See Also

- [M12.04: bootstrap-project workflow](../PLAN.md#m12-project-bootstrap-workflow) — how to scaffold a new project
- [CONTEXT.md: Webhook Decision](../CONTEXT.md) — architectural notes on webhook event design
- [ADR 0006: Hono Framework](../adr/0006-server-framework-hono.md) — webhook server framework choice
