# ADR 0006 — Server framework: Hono

Status: accepted
Date: 2026-04-30
Closes part of: #26 (M2.01)

## Context

`apps/server` is the local API and SSE host. Issue #26 says "Express or Hono — pick one, ADR if surprising". We're picking Hono.

## Decision

Use Hono on Node (`@hono/node-server`) for `apps/server`.

## Consequences

- Lightweight, modern, web-standards `Request`/`Response`. Lets `/events` use `ReadableStream` directly without Express's special handling.
- Keeps the door open to alternative runtimes if Goose Hub ever ships as a binary.
- Slightly less ubiquitous documentation than Express — a few patterns (graceful shutdown, file uploads) take a couple of extra lines, but neither is on the M2 surface.
- No body-parser or middleware sprawl; matches FACTORY_RULES rule 27 (no heavyweight deps without ADR — Hono is light enough that this ADR is being precise rather than gating).

## Alternatives considered

- **Express** — works fine, but its SSE story leans on third-party plugins or manual `res.write()` plumbing; web-standards bodies in Hono are cleaner.
- **Fastify** — fast, but the Web `Response`/`Request` interop and SSE patterns are still less natural than Hono.
