# M12.08: Webhook Setup Runbook

**Status:** Documentation slice for M12 project bootstrap.

## Summary

Provides end-to-end instructions for setting up GitHub webhooks to integrate with Goose Hub. Covers new repository onboarding, secret management, ngrok local development, event configuration, and troubleshooting.

## Deliverable

`docs/runbooks/webhook-setup.md` — Comprehensive webhook setup guide covering:

- What the webhook does and why it's needed
- Exact payload URL and endpoint path (`POST /webhooks/github`)
- Required GitHub events (`issues` with actions `opened` and `labeled`)
- Secret generation and storage (GITHUB_WEBHOOK_SECRET env var)
- ngrok setup for local development
- New and existing repository webhook configuration
- Verification steps and common troubleshooting

The runbook is verified against the webhook handler code in `apps/server/src/domains/webhooks/handler.ts`.

## Notes

- This is a documentation-only slice (M12.08). No code changes.
- End-to-end webhook testing with a real repository is deferred to M12.09 (#311).
- The runbook documents M12 capabilities: `issues` event support and `factory:*` label routing.
