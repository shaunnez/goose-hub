# Repo Registry - Shift4 Smartpay

Generated from `legacy/repo-summary.md` on 2026-06-05.

This project is intentionally local-db first. Jira and Bitbucket are integration
surfaces only; creating this config does not import Jira issues or mutate
Bitbucket.

## Jira

- Base URL: `https://shift4.atlassian.net`
- Project keys: `TAS`, `MM`
- Import mode configured: `assigned-to-me`

## Bitbucket

- `smartpayCloud`: 142 repos
- `smartpayplatform`: 96 repos

The full repo slug list lives in `project.config.ts` so repo matching can use it
directly.
