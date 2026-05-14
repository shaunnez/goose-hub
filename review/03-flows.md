# Flows

Mermaid diagrams for the loops you actually care about.

## 1. Webhook → workflow dispatch

```mermaid
flowchart TB
    GH[GitHub webhook: label changed] --> H[apps/server webhooks/handler.ts]
    H -->|verify signature| R{dispatch-routing.ts<br/>label switch}

    R -->|factory:triaging| TR[dispatchTriageBatch]
    R -->|factory:investigating| IN[dispatchInvestigate]
    R -->|factory:dev-ready| FX[dispatchFixIssue]
    R -->|factory:spec-ready| PI[dispatchParallelImplement]
    R -->|factory:needs-qa| QA[dispatchQa]
    R -->|factory:needs-review| RV[dispatchReview]
    R -->|factory:retrospecting| RT[dispatchRetro]
    R -->|factory:qa-failed| QF[dispatchQaFailed]
    R -->|factory:needs-fix| NF[dispatchNeedsFix]
    R -->|factory:grilling| GR[dispatchGrillAndPrd]
    R -->|factory:decomposing| DC[dispatchDecomposePrd]
    R -->|factory:merge-conflict| MC[dispatchResolveConflict]
    R -->|factory:archived /<br/>factory:rejected| TL[dispatchTerminalLabel<br/>fires sprint-review trigger]
    R -->|unknown label| NOOP[logger.info, no-op]

    FX --> L[withParallelLock<br/>per-issue lock + maxParallelAgents cap]
    L -->|locked| W[workflow body]
    L -->|cap full| Q[enqueueWorkflow<br/>drains on release]
    L -->|already in-flight| D[drop duplicate]
```

Key file: `apps/server/src/shared/dispatch-routing.ts:60` (`dispatchForLabel`).
Lock: `apps/server/src/shared/dispatch-lock.ts:58` (`withParallelLock`).

## 2. fix-issue workflow (the dev-side happy path)

```mermaid
sequenceDiagram
    autonumber
    participant T as Tick (or webhook)
    participant Disp as dispatchFixIssue
    participant Smk as runSmoke
    participant Ws as workspaces.ts
    participant Adv as advise-on-plan (advisor)
    participant Imp as skills/implement
    participant Gh as connectors/github
    participant Ev as skills/evidence-post
    participant Src as state-source (GitHub)

    T->>Disp: slug, issueNumber
    Disp->>Smk: 6-check preflight (cached 60s)
    Smk-->>Disp: ok / fail (event: workflow.smoke-failed)
    Disp->>Ws: prepare worktree<br/>(git fetch + checkout branch)
    Note over Disp: priority:high|critical only
    Disp->>Adv: invokeSkill(advise-on-plan)
    Adv-->>Disp: { verdict: proceed|revise|abort }
    Disp->>Imp: invokeSkill(implement)
    Imp-->>Disp: { filesChanged, testCommands, plan }
    Disp->>Gh: openPullRequest(branch, base)
    Gh-->>Disp: { url, number }
    Disp->>Ev: invokeSkill(evidence-post) (best-effort)
    Disp->>Src: transitionState(factory:needs-qa)
    Src-->>Src: label flip on GitHub → webhook → dispatchQa
```

Skipped here for compactness: dev-review (Codex pre-QA), parallel WP
builders (M19.03 path via `factory:spec-ready`), retry counters, and
budget gating. All happen between steps 5 and 7.

Key files: `slices/fix-issue/workflow.ts`, `apps/server/src/shared/dispatch-dev.ts`.

## 3. QA → Review → approval gate

```mermaid
sequenceDiagram
    autonumber
    participant Disp as dispatchQa
    participant V as core/verify (deterministic)
    participant Qa as skills/qa (HOLDOUT)
    participant Rv as skills/review (HOLDOUT)
    participant Src as state-source
    participant UI as web UI (banner)
    participant H as Human
    participant Gh as connectors/github

    Disp->>V: lint + typecheck + tests
    V-->>Disp: structural pass/fail
    Note over Disp,Qa: skip Qa if structural fails — go straight to qa-failed
    Disp->>Qa: invokeSkill(qa) — fresh context, no dev reasoning
    Qa-->>Disp: { verdict: pass|fail|partial, tiers, findings }
    alt pass
        Disp->>Src: transitionState(factory:needs-review)
        Src-->>Rv: dispatchReview
        Rv->>Rv: invokeSkill(review) — fresh context
        Rv-->>Src: transitionState(factory:approved)
        Src->>UI: SSE state.transitioned event
        UI->>H: Approve / Reject banner
        H->>UI: click Approve
        UI->>Gh: mergePR
        Gh-->>UI: 200 → factory:retrospecting (auto)
    else fail / partial
        Disp->>Src: transitionState(factory:qa-failed)
        Src-->>Disp: webhook → dispatchQaFailed
        Disp->>Disp: increment retry counter
        alt retries < max
            Disp->>Src: transitionState(factory:needs-fix)
        else retries exhausted
            Disp->>Src: transitionState(factory:needs-human)
        end
    end
```

Key files: `slices/qa/workflow.ts`, `slices/review/workflow.ts`,
`core/retry/retry-counter.ts`, `apps/server/src/domains/issues/transitions.ts`.

## 4. State machine (the happy path is just one slice of this)

```mermaid
stateDiagram-v2
    [*] --> factory_triaging : new issue
    factory_triaging --> factory_accepted : triage skill
    factory_accepted --> factory_investigating : type:bug | type:chore
    factory_accepted --> factory_grilling : vague feature
    factory_grilling --> factory_prd_drafting : grill complete
    factory_prd_drafting --> factory_decomposing : prd approved
    factory_decomposing --> factory_dev_ready : sub-issues filed
    factory_investigating --> factory_investigation_complete
    factory_investigation_complete --> factory_dev_ready
    factory_dev_ready --> factory_in_progress : fix-issue picks up
    factory_dev_ready --> factory_spec_ready : M19 spec-author path
    factory_spec_ready --> factory_in_progress : parallel-implement
    factory_in_progress --> factory_needs_qa
    factory_needs_qa --> factory_needs_review : qa pass
    factory_needs_qa --> factory_qa_failed : qa fail
    factory_qa_failed --> factory_needs_fix : retries remaining
    factory_qa_failed --> factory_needs_human : retries exhausted
    factory_needs_fix --> factory_needs_qa : fix-feedback loop
    factory_needs_review --> factory_approved : review pass
    factory_needs_review --> factory_needs_fix : review needs-fix
    factory_needs_review --> factory_needs_human : review unsure
    factory_approved --> factory_retrospecting : human merges
    factory_approved --> factory_merge_conflict : merge 405
    factory_merge_conflict --> factory_retrospecting : resolve-conflict OK
    factory_merge_conflict --> factory_needs_human : resolve fails
    factory_retrospecting --> factory_done : retro completes
    factory_done --> factory_archived
    factory_needs_human --> [*] : manual
    factory_rejected --> [*] : manual
```

Canonical: `core/state-machine/states.ts`, `transitions.ts`.
28 states; terminal: `done`, `archived`, `rejected`. Diagram omits a
couple of admin states for clarity.

## 5. Per-project tick scheduler

```mermaid
sequenceDiagram
    participant S as startPerProjectScheduler
    participant P1 as Project A interval (60s)
    participant P2 as Project B interval (60s)
    participant Tk as dispatchTriageBatch
    participant Sm as runSmoke
    participant Db as project_state.last_tick_at

    S->>P1: setInterval(tick, A.tickIntervalSeconds * 1000)
    S->>P2: setInterval(tick, B.tickIntervalSeconds * 1000)

    par independent loops
        P1->>Sm: smoke gate (cached 60s per slug)
        Sm-->>P1: ok
        P1->>Tk: dispatchTriageBatch(A.slug)
        Tk-->>Db: update last_tick_at
    and
        P2->>Sm: smoke gate
        Sm-->>P2: ok (separate cache key)
        P2->>Tk: dispatchTriageBatch(B.slug)
    end
```

A crash in project A's tick does not stop project B. Each tick re-derives
state from GitHub + SQLite (rule 7: stateless across ticks).

Key files: `core/projects/scheduler.ts`, `core/orchestrator/smoke.ts`,
`apps/server/src/shared/dispatch.ts`.

## 6. Event store fan-out

```mermaid
flowchart LR
    Caller[any core/slice] -->|appendEvent| ES[EventStore]
    ES -->|JSON.stringify + redact| Ins[(SQLite INSERT)]
    Ins -->|RETURNING row| ES
    ES -->|emit 'event'| Emit[EventEmitter]
    Emit --> Sub1[SSE buildSseStream → web client]
    Emit --> Sub2[Other subscribers: retro trigger, sprint review, etc.]

    classDef wrap fill:#fee,stroke:#900,color:#900
    note1[safeListener wraps subscribers:<br/>thrown errors are caught + logged<br/>once per error shape, process-lifetime]:::wrap
    Sub1 -.- note1
    Sub2 -.- note1
```

`core/event-stream/store.ts:169` is the only writer.
`closeOrphanedRuns()` (line 300) runs on startup to emit synthetic
`agent.run-failed` for any `agent.run-started` without a matching
`run-completed` / `run-failed`.

## 7. Retro + learning loop (M9 + M11)

```mermaid
flowchart TB
    M[PR merged, factory:retrospecting] --> Pol{retrospectivePolicy<br/>+ deep triggers fired?}
    Pol -->|light| RL[skills/retrospective-light<br/>3-bullet summary]
    Pol -->|deep| RD[skills/retrospective-deep<br/>full analysis + scores]
    RL --> AR[(archived_lifecycles<br/>+ decision_patterns)]
    RD --> AR
    AR --> CM{lifecycleCount >= 3<br/>AND consistency >= 0.8?}
    CM -->|yes| CR[skills/retrospective-cross-run<br/>PlaybookManifest]
    CR --> IC[(improvement_candidates)]
    IC --> CG{coachPolicy.enabled<br/>AND not forbidden target?}
    CG -->|yes| SK[skills/skill-coach<br/>proposes diff to prompt.md]
    SK --> Iss[Factory GitHub issue<br/>type:improvement]
    Iss --> H[Human approves<br/>before any merge]
```

Forbidden coach targets are hard-coded: `qa`, `review`, all retros,
`skill-coach` itself. See ADR 0025.
