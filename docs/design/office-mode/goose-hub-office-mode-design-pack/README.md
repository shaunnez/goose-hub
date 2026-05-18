# Goose Hub Office Mode — Visual Design Pack

This pack turns the operational model into labelled visual build artefacts.

Every board folder should eventually contain:

- design-spec.md
  - Systems semantics
  - Canonical behaviour
  - Spatial rules
  - Animation/event meaning

- image-prompt.md
  - Copyable image-generation prompt
  - Used to generate the canonical visual board

- board-image.png
  - Generated canonical image
  - Treated as frozen visual reference

The goal is NOT concept art alone.

The goal is:
- implementation contracts
- visual semantics
- orchestration language
- cinematic workflow behaviour
- atmospheric identity

---

# Board Set

## 01 — Building Blueprint
Folder:
01-building-blueprint

Contains:
- Full building-level systems layout
- Spatial semantics
- Elevator/navigation contract
- Watchtower/backstage semantics
- Labelled SVG blueprint
- Image-generation prompt
- Canonical board image

Purpose:
Defines the physical structure of Goose Hub.

---

## 02 — Canonical Project Floor
Folder:
02-canonical-project-floor

Contains:
- One full project floor layout
- Room semantics
- Queue behaviour
- Movement lanes
- Holdout boundaries
- Image-generation prompt
- Canonical board image

Purpose:
Defines how workflow phases physically coexist inside a project floor.

---

## 03 — Ticket Lifecycle Storyboard
Folder:
03-ticket-lifecycle-storyboard

Contains:
- 12-panel lifecycle storyboard
- Event sequencing
- Retry loops
- Merge flow
- Retro/archive behaviour
- Image-generation prompt
- Canonical board image

Purpose:
Defines the canonical WorkItem journey.

---

## 04 — Zoom Semantics
Folder:
04-zoom-semantics

Contains:
- Building zoom
- Floor zoom
- Room zoom
- Persona zoom
- Visibility rules
- Aggregation rules
- Image-generation prompt
- Canonical board image

Purpose:
Defines abstraction layers and scalability behaviour.

---

## 05 — Holdout Chambers
Folder:
05-holdout-chamber

Contains:
- Sealed library semantics
- QA holdout semantics
- Review convergence semantics
- One-way information flow
- Trust boundaries
- Input/output ports
- Retry/convergence counters
- Image-generation prompt
- Canonical board image

Purpose:
Defines trustworthy isolated reasoning spaces.

---

## 06 — Visual System
Folder:
06-visual-system

Contains:
- Palette
- Iconography
- Sprite semantics
- Artifact semantics
- Animation language
- Label conventions
- Environmental feedback language
- Image-generation prompt
- Canonical board image

Purpose:
Defines the visual vocabulary of Goose Hub.

---

## 07 — Dynamic Choreography System
Folder:
07-dynamic-choreography-system

Contains:
- State transition choreography
- Scout fan-out/convergence
- QA rollback flow
- Human freeze semantics
- Merge celebration flow
- Audit interruption behaviour
- Image-generation prompt
- Canonical board image

Purpose:
Defines the movement grammar of the office.

---

## 08 — Runtime Operational HUD
Folder:
08-runtime-operational-hud

Contains:
- Queue overlays
- Hero task labels
- Retry indicators
- Swarm glyphs
- Budget pressure overlays
- Room load heatmaps
- Event feed semantics
- Runtime observability language
- Image-generation prompt
- Canonical board image

Purpose:
Defines live orchestration readability.

---

## 09 — Atmospheric Holdout Library
Folder:
09-atmospheric-holdout-library

Contains:
- Cinematic sealed library scene
- Atmospheric scout investigation
- Trust-through-isolation mood
- Image-generation prompt
- Canonical board image

Purpose:
Defines emotional identity for autonomous investigation.

---

## 10 — Atmospheric Night Office
Folder:
10-atmospheric-night-office

Contains:
- Overnight swarm activity
- Calm autonomous ambience
- Rain/light mood
- Passive operational life
- Image-generation prompt
- Canonical board image

Purpose:
Defines the “ships while you sleep” fantasy.

---

## 11 — Atmospheric QA Failure Event
Folder:
11-atmospheric-qa-failure

Contains:
- QA failure choreography
- Retry pressure mood
- Controlled rollback atmosphere
- Escalation visuals
- Image-generation prompt
- Canonical board image

Purpose:
Defines operational tension and recovery.

---

## 12 — Atmospheric Merge Celebration
Folder:
12-atmospheric-merge-celebration

Contains:
- Merge success mood
- Done shelf/archive flow
- Calm celebration semantics
- Retro routing
- Image-generation prompt
- Canonical board image

Purpose:
Defines emotional payoff and completion.

---

# Recommended Workflow

## Phase 1 — Blueprint Canon
Generate:
- 01 → 08

Focus on:
- semantics
- labels
- systems
- movement
- readability
- orchestration truth

Do NOT optimise for beauty yet.

Freeze:
- room meaning
- movement grammar
- abstraction rules
- observability language

---

## Phase 2 — Atmospheric Canon
Generate:
- 09 → 12

Focus on:
- mood
- emotional identity
- ambience
- cinematic feeling
- “living company” fantasy

These images should inherit the SAME semantics from the blueprint phase.

No fake workflow behaviour should appear in atmospheric boards.

---

# Core Design Principle

> The office is not a kanban with sprites.
> It is a faithful visualisation of coordination.

And eventually:

> Goose Hub should feel like a tiny autonomous software company quietly operating inside a living building.