# Personas

Personas are runtime-assigned by `selectPersona()` in `core/agent-runtime/select-persona.ts`.
They are not configured as files — names are drawn from a built-in pool and tracked as rows
in the local SQLite `persona_stats` table. No config files in this directory are needed or read.

To inspect active personas for this project, query `persona_stats` where `projectId = 'nannymudnz'`.
