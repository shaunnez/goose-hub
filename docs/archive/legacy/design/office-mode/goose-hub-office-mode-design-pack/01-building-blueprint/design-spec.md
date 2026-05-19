# Board 01 — Building Blueprint

## Purpose

Define the whole Goose Hub building as a spatial model of the orchestration system.

This is not a pretty concept piece. It is the master spatial contract for the Office Mode renderer.

## Core decision

Use this model:

- Building = Goose Hub
- Ground floor = Lobby / intake / budget / notifications
- Each main floor = one project
- Rooms on a project floor = workflow phases
- Watchtower = auditor / autonomy gate
- Basement = backstage learning loop
- Elevator = project navigation and cross-room movement
- Tickets = WorkItems
- Geese = persistent Personas
- Room lighting = activity
- Door queues = collapsed work depth
- Sealed rooms = holdout boundaries

## Why this is better than workflow floors

Workflow floors create too much elevator movement and lose project identity.

Project floors preserve:
- project-specific config
- budgets
- autonomy mode
- stack profile
- milestone identity
- persona continuity
- visual ownership

Workflow phases still remain visible as rooms inside each project floor.

## Required labelled areas

### A. Watchtower

Represents:
- Auditor
- autonomy gate
- audit.failed
- audit.autonomy-gate-fired

Visual:
- small tower above building
- sleeping auditor goose
- beacon light
- red spotlight when active

Label:
`WATCHTOWER — auditor / autonomy gate`

### B. Project floors

Each project has one floor.

Label each:
`PROJECT FLOOR — <project name>`

Each project floor should show:
- triage corner
- discovery suite
- research / investigation lab
- sealed library
- spec booth
- dev floor
- dev-review nook
- QA chamber
- review chamber
- retro room
- done shelf
- archive cabinet

### C. Lobby

Represents:
- inbox drop box
- GitHub webhook inlet
- external funnel sources
- courier desk
- budget board
- daily token gauge
- human notification bell

Label:
`LOBBY — inbox / budget / human gates`

### D. Basement / backstage

Represents:
- ImprovementCandidates
- coach office
- skill prompt improvements
- workflow improvements
- persona improvements
- corkboard

Label:
`BACKSTAGE — learning loop / improvement candidates`

### E. Elevator shaft

Represents:
- navigation between projects
- courier movement from lobby
- task movement into project floors
- visual transition mechanic

Label:
`ELEVATOR — project navigation / task routing`

## Visual language

### Persistent entities

- Project = floor
- WorkItem = ticket card
- Persona = named goose
- EngineeringSpec = board document
- WorkPackage = clipped sub-ticket
- ScoutReport = sealed envelope
- ImprovementCandidate = corkboard note
- QualityScore = gauge

### Transient entities

- AgentRun = goose lit/animated at desk
- Wave = flock formation
- ReviewRound = silhouettes behind frosted glass
- ToolInvocation = monitor flicker / typing
- Event = animation trigger, not object

## Camera modes supported by this blueprint

1. Building view
   - See all project floors
   - No individual geese
   - Activity shown as glow, queue numbers, badges

2. Floor view
   - One project floor
   - Rooms visible
   - Hero tasks labelled
   - Ambient tasks animated

3. Room view
   - Detailed room interactions
   - Individual geese visible
   - Thought bubbles readable

4. Persona view
   - Clicked goose
   - Timeline, current issue, run history

## Implementation notes

The building blueprint should be generated as an abstract labelled pixel-art cross-section first.

Do not over-detail the rooms yet. Board 02 will define the canonical project floor.
