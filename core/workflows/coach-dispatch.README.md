# Skill Coach Dispatch

Auto-triggers skill-coaching workflow when cross-run retrospectives produce improvement candidates with sufficient convergence.

## Purpose

After a cross-run retro (M11.12) scans archived lifecycles and detects convergent improvement patterns, this module evaluates which skill-related patterns have sufficient backing and consistency to warrant coached iteration. It gates dispatch by:

- **kind filter:** only `skill-prompt`, `skill-schema`, `skill-config`
- **consistency threshold:** `consistencyScore >= coachPolicy.consistencyThreshold` (default 0.8)
- **minimum lifecycle backing:** `lifecycleCount >= coachPolicy.minLifecycles` (default 3)
- **forbidden targets:** patterns matching `coachPolicy.forbiddenTargets` are skipped silently

## Exports

```ts
export async function scanAndDispatchCoach(input: CoachDispatchInput): Promise<void>
```

### Input

```ts
interface CoachDispatchInput {
  projectId: string;
  playbookId: string;
  candidates: Array<{
    id: number;
    kind: string;
    targetPath: string;
    suggestionText: string;
    consistencyScore: number;
    lifecycleCount: number;
  }>;
  coachPolicy: CoachPolicy;
}
```

### Config

```ts
interface CoachPolicy {
  enabled: boolean;                    // default: false in supervised mode
  consistencyThreshold: number;        // default: 0.8
  minLifecycles: number;               // default: 3
  forbiddenTargets?: string[];         // optional skill paths to skip
}
```

Add to `target-projects/<slug>/project.config.ts`:

```ts
agentConfig: {
  // ...
  coachPolicy: {
    enabled: false,
    consistencyThreshold: 0.8,
    minLifecycles: 3,
    forbiddenTargets: [],
  },
}
```

## Events Emitted

- **`coach.skipped-forbidden-target`** — pattern matched a forbidden target
- **`coach.candidates-persisted`** — coach run succeeded; output candidates stored with `sourcePlaybookId`
- **`coach.run-failed`** — coach workflow failed for a single candidate

## Tests

See `coach-dispatch.test.ts` for coverage of:
- enabled/disabled gate
- kind filtering
- consistency score threshold
- minLifecycles threshold
- forbidden target matching + event emission
- combined filter scenarios
