# Compare chore, bug
Compare chore, bug, feature on siple task

# Decline PR ??

# Investigation group
needs to sum up costs and tokens

# Parallel repair
Plan

  1. Add repair mode config
     Add repairMode: "legacy" | "native" | "auto" behind project pipeline settings.

     Default: legacy.

     Semantics:
      - legacy: current fix-feedback path.
      - native: targeted WP repair only; ambiguous mapping escalates to needs-human.
      - auto: targeted WP repair when confident; otherwise fall back to legacy.
  2. Refactor shared repair context
     Extract the existing fix-feedback helpers that already find:
      - latest pr.opened
      - pipelineRunId
      - worktreePath
      - devRunId
      - latest failing qa.completed or review.completed

     Put this in a shared core/helper module so both fix-feedback and parallel-repair use the same source-of-
     truth.
  3. Build the WP mapper first
     New module: slices/parallel-repair/wp-mapper.ts.

     Inputs:
      - Engineering spec
      - latest failure payload
      - current PR lifecycle
      - event stream

     Mapping rules:
      - finding file intersects exactly one wp.filesOwned: high confidence
      - failed QA criteriaResults[].ac maps to an AC whose verify command or statement references one WP-owned
        path: medium/high confidence
      - review finding criterion maps to an AC, then to one WP: medium confidence
      - finding touches interfaceContracts[].file: include owning WP and direct dependents
      - multiple unrelated WPs or no concrete path/AC anchor: ambiguous

     Output:

     {
       confidence: "high" | "medium" | "ambiguous";
       wpIds: string[];
       reasons: Array<{ wpId: string; evidence: string }>;
     }

  4. Create slices/parallel-repair
     Do not call runParallelImplementWorkflow() as-is. It creates a fresh integration worktree and opens a new
     PR, which is wrong for repair.

     Instead, extract/reuse the lower-level WP execution pieces:
      - run selected implement-wp builders
      - create scratch worktrees from the current PR worktree HEAD
      - copy owned files back into the existing PR worktree
      - commit only selected WP files
      - push the existing PR branch
      - never open a new PR
      - preserve the original pipelineRunId

     Also add repairFeedback to the implement-wp context/schema/prompt so the WP builder knows the exact QA/
     review findings it is repairing.
  5. Wire dispatcher routing
     Update dispatchNeedsFix:

     if (
       useMultiAgentPipeline &&
       latestPr.pipelineRunId &&
       repairMode !== "legacy"
     ) {
       runParallelRepairWorkflow(...)
     } else {
       runFixFeedbackWorkflow(...)
     }

     For native, ambiguous means needs-human.
     For auto, ambiguous means legacy fallback.

  6. Events
     Add event kinds to core/event-stream/store.ts and timeline labels:
      - parallel-repair.planned
      - parallel-repair.wp-started
      - parallel-repair.wp-committed
      - parallel-repair.wp-failed
      - parallel-repair.completed
      - parallel-repair.exhausted

     Required payload on all workflow-level events:

     {
       "pipelineRunId": "...",
       "attemptId": "...",
       "sourceFailureKind": "qa|review",
       "sourceFailureRunId": "...",
       "mappingConfidence": "high|medium|ambiguous",
       "repairMode": "wp-targeted"
     }

  7. Tests
     Minimum focused tests:
      - mapper: QA finding in WP2-owned file maps only WP2
      - mapper: review finding in WP1-owned file maps only WP1
      - mapper: interface contract finding includes dependent WP
      - mapper: no file/AC anchor returns ambiguous
      - dispatcher: legacy still calls fix-feedback
      - dispatcher: native calls parallel-repair only for multi-agent PR with pipelineRunId
      - workflow: same pipelineRunId, same PR branch, same worktreePath, no new PR
      - workflow: ambiguous native repair escalates or emits exhausted without pretending to be targeted
      - timeline: repair events group under the existing pipeline phase


# Need to change banner that shows triage/dev/qa
Should be "view error" -> takes to timeline.

# Skill enhancement
review claude-code-skills-training-deck.md


# Todo more
Triage / repo run fails -- needs to error out

Cannot see claude $ on timeline

Budgets for claude were too low on triage 

When grill me is ready to ask question, banner should appear saying "question ready - grill " with link

It would be good to see what the grill question was in timeline, all i can see is it going and searching files - no context of what its doing

Scouts .. not sure what model .. nor plahwright

REPO MATCH ON OPUS??

How many turns should scouts have

MIssing budget for scouts and things

Wave agents now showing "started at" and appearing abnove investigation run which is also not showing started at...

Missing cost / tokens on swarm / wave / investigation


# todo - make into a plan

Problem: Blocked factory:dev-ready issues are never re-dispatched

  When decompose-prd creates child issues, they all land in factory:dev-ready simultaneously. GitHub webhooks fire for each one.
  Issues with unmet deps (Depends on #N) get schedule:blocked-by applied and are dropped.

  When the blocking issue completes (factory:done), nothing re-triggers the blocked issue. The webhook handler only reacts to
  issues.labeled — it ignores issue/PR close events. The per-project tick only runs runTriageBatch which only processes
  factory:triaging items. No sweep exists for factory:dev-ready + schedule:blocked-by.

  Result: Blocked child issues sit permanently stuck unless a human manually intervenes.

  Fix shape: A sweep in the tick that fetches factory:dev-ready items with schedule:blocked-by, runs filterEligibleByDependencies
  on them (which already restores schedule:current as a side-effect), and dispatches the newly eligible ones. Requires adding
  getItemsByState() to the StateSource interface.
  
# Pretty sure our bootstrap is out of data with agents
fix

# GO through settings

# Should be able to set agents to codex ones?

# Budgets not showing defaults

# Review this...

⏺ Full picture (ignoring worktrees):

  ┌─────────────────────────────────────────┬──────────────────────┬─────────────────────────────────────────┐
  │                Consumer                 │       Bundles        │                 Broken?                 │
  ├─────────────────────────────────────────┼──────────────────────┼─────────────────────────────────────────┤
  │ core/agent-runtime/swarm.ts:271         │ ['read']             │                   yes                   │
  ├─────────────────────────────────────────┼──────────────────────┼─────────────────────────────────────────┤
  │ core/workflows/grill-and-prd.ts:442     │ ['read']             │                   yes                   │
  ├─────────────────────────────────────────┼──────────────────────┼─────────────────────────────────────────┤
  │ core/workflows/grill-and-prd.ts:748,837 │ ['read', 'core']     │            yes (core=empty)             │
  ├─────────────────────────────────────────┼──────────────────────┼─────────────────────────────────────────┤
  │ slices/qa/workflow.ts:451               │ ['read', 'qa-tools'] │ no — qa-tools has native Read/Glob/Grep │
  ├─────────────────────────────────────────┼──────────────────────┼─────────────────────────────────────────┤
  │ slices/review/workflow.ts:293           │ ['read', 'validate'] │     no — validate has native tools      │
  └─────────────────────────────────────────┴──────────────────────┴─────────────────────────────────────────┘

  Advice: Update read bundle definition to ['Read', 'Glob', 'Grep', 'Bash(cat *)', 'Bash(ls *)'] — same as read-only. One change fixes all broken consumers. QA and Review unaffected (their
  native-tool bundles dominate already; read tools were dead weight there anyway).

  Don't change individual callsites — the bundle abstraction exists for this reason. Update the comment to note it's temporary until MCP server is wired.
  
# Costs page in detail
-- might need to improve this, both persona and stage (other)

# Chat 
Implement this...

# Researcher
Implement this

# Timeline bugs
Playwright repro and evidence, nice to somehow see images here

# General
Comments on home page doesn't feel right - overview
Chore - need to ensure the right tabs are shown in sidebar + transition drop down
Playwright repo run - images posted to github but didn't exist? Maybe on weird branch or wrong path or something

string values everywhere
orkItem.priority === 'high' || workItem.priority === 'critical'
 'factory:needs-qa',
      'factory:needs-human', --->centralise

....././././././. -> fix?

# PRD 
Use can APPROVE or DECLINE
- They can free edit the PRD or ADD comments 
- Approve moves it forward, decline moves it to "blocked" or done.  

# Overview
Should show states "compelted" or "blocked" of each state 
Like we now do on prd form

# Grill me
  1. Grill page shows triage comments, probably not great.
  2. Overview shows comments... weird it shows the griller comments
  3. When i responded to the griller, this god added to github issue comments.. why?

  After respodning to grill me, should show "agent is thinking" until it's reponse. 
  Also seeing "griller is processing your reply"... better messasging as i think this is "sending to prd state"
  Make it look like the timelone agent is loading thing.


Rejecting PRD doubles up on grill me run
Load more events on timeline ont working?

e2e tests around grill prd and fail? 

# Need to fix the dispatch file (so much code)

# Milesotne 11 testing
 Validation checklist (exit criteria, PLAN.md §28)

                                                                                                                          
  Per PLAN.md line 1778, you need to manually verify these five scenarios:
                                                                                                                          
  1. Same-repo dep block — Create issue A with Depends on #B (B open). Scheduler must refuse to dispatch A. Verify        
  factory:blocked-by-dependency label appears.                                                                            
  2. Unblock on close — Close B. Scheduler's next tick must pick up A and dispatch it.                                    
  3. Cross-repo dep — Create a dep across goose-hub-self and your M10 second project. Verify same block/unblock behaviour.
  4. Unregistered cross-repo dep — Add Depends on unregistered-org/unknown-repo#1 to an issue. Verify it escalates to     
  factory:needs-human, not a crash.                                                                                       
  5. Multi-parallel — Two non-conflicting issues with no deps. Verify both dispatch simultaneously (up to                 
  maxParallelAgents), not serialized.                                                                                     
                                                
  Also run the exit audit generics:                                                                                       
  - pnpm typecheck and pnpm test pass in both apps
  - pnpm lint clean                                                                                                       
  - No slice imports from other slices in M11 slices
  - slice.test.ts + README.md present in every modified slice  

# more on m11

---                                                                                                                                         
  Dependency scheduler (M11.03) — confirmed gap                                                                                               
                                                                                                                                              
  filterEligibleByDependencies is never called from triage-batch.ts or dispatch.ts. The issue (#292) has all ACs ticked as done, but the      
  wiring into the actual dispatch path is missing. This isn't a "later milestone" design — the AC explicitly says "Before dispatching a       
  workflow, the scheduler calls..." That's a real miss. The unit tests pass in isolation but the hook into the real dispatch loop was never
  added.                                                                                                                                      
                                                
  You can't currently test the blocked-dep scenario end-to-end because dispatch ignores deps entirely.                                        
  
  ---                                                                                                                                         
  Retrospective page — yes, it's real and wired 
                                                                                                                                              
  core/workflows/retrospective.ts does call both archiveLifecycle (line 223) and computeTrend (line 130). The archive and trend data flow on
  every retrospective run. Your retrospective detail page in the UI has: decision summaries, learning entries, persona scores, trend icon,    
  improvement candidates, and a PlaybooksTab in the roster. M11.11 is genuinely working — you'll see data there after any completed run.
                                                                                                                                              
  The POST /api/projects/:slug/learning/mine endpoint is also wired (router.ts:107 calls minePatterns), so you can manually trigger pattern   
  mining.                             
                                                                                                                                              
  ---                                           
  M11.14 auto-trigger — wired, gated by config
                                                                                                                                              
  The code IS there in cross-run-retro.ts (lines 398–408). It fires when coachPolicy.enabled = true in agentConfig. Default is false in
  supervised mode per the issue spec. So it's not broken — it's off by default. To enable: set coachPolicy.enabled = true in your project     
  config, plus it needs ≥3 archived lifecycles and consistencyScore ≥ 0.8. You won't see it trigger until you've run enough issues through to
  done.                                                                                                                                       
                                                
  ---                                 
  M11.11 — what it actually does
                                                                                                                                              
  Two things happen every time an issue reaches factory:done:
                                                                                                                                              
  1. archiveLifecycle writes a row to archived_lifecycles — a permanent record of all decision summaries, learning entries, quality scores,   
  and costs for that run.                                                                                                                     
  2. computeTrend reads the last 5 quality scores for a role and returns improving | stable | declining, shown as an icon on the retrospective
   page.                                                                                                                                      
                                      
  Then separately, minePatterns (manual trigger or eventually automatic) reads across all archived lifecycles to find recurring decision      
  patterns — groups them by (kind, role), computes how consistent they are (e.g. "Dev always queries GitHub Issues first — 80% of the time").
  Those patterns feed the playbook and eventually skill-coach.                                                                                
                                                
  To see it: run 3+ issues through to done, then hit the retrospective section on any of them. The trend arrow should be populated. Hit POST  
  /api/projects/:slug/learning/mine to see patterns in the DB.
                                                                                                                                              
  ---                                           
  M11.10 — do you need it?            
                          
  Since filterEligibleByDependencies isn't wired into dispatch, any M11.10 integration tests testing "dep blocks dispatch" would currently
  fail or be testing a stub. The e2e tests you have cover the full lifecycle pipeline, not dep-aware scheduling specifically. So: M11.10 is   
  blocked on the M11.03 wiring gap. Fix the wiring first, then M11.10 tests become meaningful.
                                                                                                                                              
  Priority: the single most impactful fix is wiring filterEligibleByDependencies into triage-batch.ts before dispatch. That one call makes the
   headline M11 feature actually work. Want me to do that?

---                                                                                                                     
  Dependency parser / blocked scheduling                                                                                  
                                                                                                                          
  parseDependencies exists and is tested. But filterEligibleByDependencies (the thing that actually stops dispatch) is    
  never called from triage-batch or dispatch. So: no, if you create issue A depending on open B, the scheduler will still 
  dispatch A. The filter is implemented and unit-tested in isolation but not wired into the production dispatch path.     
                                                                                                                          
  UI blocked badge on Kanban card — the UI parser copy exists in apps/web/src/lib/dependency-parser.ts. Whether the Kanban
   card actually renders it depends on M11.05's UI wiring, which I'd need to verify separately.                           
                                                                                                                          
  Bottom line: dep blocking is not actually enforced end-to-end right now.                                                
                                      
  ---                                                                                                                     
  Lifecycle archive + pattern miner + convergence detector                                                                
                                                                                                                          
  These are wired — archiveLifecycle and computeTrend both get called from core/workflows/retrospective.ts. So after a run
   completes and retrospective fires, data flows through. You can't "browse" it directly in UI yet — it writes to SQLite. 
  To see it you'd query the DB directly or wait until a retrospective run surfaces results. No dedicated UI panel exists.
                                                                                                                          
  Cross-merge retrospective + playbook writer + gate thresholds                                                           
                                      
  exportPlaybook + computeGateThresholds are called from core/workflows/cross-run-retro.ts and the CLI (goose playbook    
  export <slug>). So the CLI command works. Gate thresholds get computed and stored, but there's no UI showing them —
  you'd use the CLI.                                                                                                      
                                                
  Skill coach                         

  Exists at skills/skill-coach/. No workflow calls it. Manual trigger only — you'd invoke it explicitly, it proposes diffs
   to skill prompts. The auto-trigger (M11.14) is described as shipped but per the code survey no workflow wires the
  auto-trigger either.                                                                                                    
                                                
  Predictive model router (one sentence)

  No implementation found in the codebase — marked shipped in PLAN.md but the code doesn't exist.                         
  
  ---                                                                                                                     
  Smoke gate in UI / timeline                   
                                                                                                                          
  runSmoke in core/orchestrator/smoke.ts is never called. The workflow.smoke-failed event type is registered in the event
  schema, so if it ran it would appear in timeline. But it doesn't run. Smoke gate is a stub.                             
                                                
  ---                                                                                                                     
  M11.10 — do you need it?                      
                                      
  Depends what your e2e tests cover. There's apps/web/e2e/pipeline/full-lifecycle.spec.ts but it's not
  dep-scheduling-specific. M11.10 would specifically test: dep blocks dispatch, dep close unblocks, cross-repo dep,       
  unregistered dep → needs-human, multi-parallel. Given that filterEligibleByDependencies isn't wired into dispatch at
  all, writing those tests right now would fail — so M11.10 is blocked on first fixing the wiring gap, then testing it.   
                                                
  ---                                 
  TL;DR on M11 health
                     
  ┌──────────────────────────┬─────────────┬─────────────────┬───────────────────┐
  │         Feature          │ Code exists │ Wired into prod │ Visually testable │                                        
  ├──────────────────────────┼─────────────┼─────────────────┼───────────────────┤
  │ Dep parser               │ Yes         │ Partial         │ No                │                                        
  ├──────────────────────────┼─────────────┼─────────────────┼───────────────────┤
  │ Dep blocking at dispatch │ Yes         │ No              │ No                │                                        
  ├──────────────────────────┼─────────────┼─────────────────┼───────────────────┤
  │ Lifecycle archive        │ Yes         │ Yes             │ CLI/DB only       │                                        
  ├──────────────────────────┼─────────────┼─────────────────┼───────────────────┤                                        
  │ Pattern miner            │ Yes         │ Yes             │ CLI/DB only       │
  ├──────────────────────────┼─────────────┼─────────────────┼───────────────────┤                                        
  │ Playbook writer          │ Yes         │ Yes (CLI)       │ CLI               │
  ├──────────────────────────┼─────────────┼─────────────────┼───────────────────┤                                        
  │ Skill coach              │ Yes         │ No              │ Manual invoke     │
  ├──────────────────────────┼─────────────┼─────────────────┼───────────────────┤                                        
  │ Model router             │ No          │ No              │ No                │
  ├──────────────────────────┼─────────────┼─────────────────┼───────────────────┤                                        
  │ Smoke gate               │ Yes         │ No              │ No                │
  └──────────────────────────┴─────────────┴─────────────────┴───────────────────┘     

# Todo
1. Loading ... should always be something inside timeline "agent run" window indicating it's loading. This is seen on code but not other types. Obviously disappears when run is done and/or "resume" shows

2. General loading - details page all have "no content" part, but should have a consistent "loading" page as well.

3. Remove fake triage

# Retrospective  

  Review — holdout, per-PR, forward-looking. Input: issue body + PR diff. Question: did the code meet the spec? No access to agent reasoning by design.                              
                                                                                                                                                                                     
  Retro — per-run, backward-looking. Input: run_summary (outcome, decision summaries, retry count, QA fail flag) + trigger reasons. Question: how well did the agents perform?       
                                                
  The gap you identified is real. Retro currently only sees decision summaries — one-sentence self-reports the agents themselves wrote. It's meta-analysis of curated output, not raw
   log analysis. So it can catch things like "settings.json mutated out-of-scope" only because the reviewer emitted a decision summary saying exactly that. It cannot independently  
  discover things agents didn't report themselves.                                                                                                                                   
                                                
  Your vision (analyze raw logs → identify skill-level failure patterns → recommend/draft skill.md changes) is a meaningfully different and more powerful thing. What that would     
  require:
                                                                                                                                                                                    
  1. Raw event log access — retro would need the full agent.decision-summary event stream plus any agent.tool-call or agent.message events, not just the condensed run_summary       
  2. Skill file access — read current skills/<name>/skill.md to understand what the agent was instructed to do, compare against what it actually did
  3. Skill diff output — produce either a proposed patch to a skill file, or a registered issue with the proposed change                                                             
                                                                                                                                                                                    
  The current retro is more like a sprint retrospective (what went well/badly on this delivery). What you're describing is closer to agent coaching — reading the transcript,        
  comparing it to the playbook, and updating the playbook.                                                                                                                           
                                                                                                                                                                                     
  That's a strong milestone candidate. The current output (persona quality scores, improvement candidates) gives you the scaffolding — you'd extend the skill to accept raw events + 
  skill contents, and add a skillImprovementCandidates section to the schema alongside improvementCandidates.
                                                                                                                                                                                    
  Worth filing as a separate issue, or do you want to scope it out now?       