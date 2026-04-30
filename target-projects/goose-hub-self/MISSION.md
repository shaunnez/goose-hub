# Mission — Goose Hub (self)

This project applies Factory to itself. Goose Hub uses its own orchestration to develop and maintain Goose Hub.

## Scope

Goose Hub is a personal command centre for AI-assisted software delivery. The self-target configuration enables Factory to manage its own issues, run its own workflows, and dog-food every capability it ships.

## Constraints

- All changes go through the same milestone-gated, issue-driven workflow as any other target project.
- Governance files (`MISSION.md`, `FACTORY_RULES.md`, `CLAUDE.md`, `project.config.ts`, `personas/**`) are immutable by Factory PRs; only `factory:bootstrap-pr`-tagged PRs may create them.
- The system must remain operable during its own development — no self-hosting changes that break the running orchestrator without a tested migration path.

## Relationship to root MISSION.md

This file extends, and does not replace, the root `MISSION.md`. The root document governs Goose Hub's overall purpose; this document governs how Factory operates when the target project is Goose Hub itself.
