# todo more
State transitioned
06/05/2026, 18:05:05
factory:qa-failed → factory:needs-fix (by orchestrator)

This then went to implement run -> triage/repo-match->qa run

agent.fix-feedback-complete
06/05/2026, 18:07:09
{
  "filesWritten": 3,
  "testsWritten": 0,
  "confidence": "high",
  "testsRun": {
    "command": "pnpm test --reporter=json",
    "paths": [
      "src/components/detail/components/CommentsSection.test.tsx",
      "apps/server/src/domains/issues/router.test.ts"
    ]
  }
}

http://localhost:5173/projects/goose-hub-self/items/518/timeline

Then went to review finally and doing implementaiton again.

# Todo main

Have ai read steves training dos against code and come up with plan

 ---                                                                                                                    
  Swarm/Multi-Agent Patterns in Steve's Materials                                                                        
                                                                                                                         
  What's actually there (detailed, production-tested)                                                                    
                                                                                                                         
  Investigation Swarm (lifecycle.md + 01-planning-phase.md) — most important:                                            
  - Wave 1: 4–6 Sonnet scouts dispatched ALL in background simultaneously (Schema Scout, Code Path Tracer, Pattern       
  Matcher, Test Inventory, Dependency Mapper, UX Scout)                                                                  
  - Wave 2: 1–2 Opus/Sonnet deep investigators fed Wave 1 results
  - Cross-validation loop between waves (agents check each other's work)                                                 
  - Orchestrator NEVER explores code directly — it dispatches, synthesizes, steers                                       
  - While agents run: orchestrator works its task queue (no idling)                                                      
                                                                                                                         
  Parallel builder dispatch (lifecycle.md):                                                                              
  - One Task agent per work package, dispatched concurrently                                                             
  - File ownership model prevents conflicts — no two WPs own the same file                                               
  - Model allocation table with maxConcurrent per role (Wave 1 scouts: 6, Opus builders: 2, etc.)
                                                                                                                         
  Parallel adversarial review (lifecycle.md):                                                                            
  - Round 1: 2 Codex agents launched simultaneously with different focus prompts                                         
  - Round 2+: single follow-up until convergence                                                                         
  - Session reuse: plan reviewer A → reused for work review; plan reviewer B → reused for ship audit
                                                                                                                         
  Parallel LLM eval (llm-eval.md):                                                                                       
  - One eval agent per chunk, all parallel, results consolidated after                                                   
                                                                                                                         
  Retrospective spawns improvement lifecycles (08-learning-convergence-loop.md):
  - Nightly retrospective can autonomously spawn new lifecycles to fix systemic issues                                   
  - This IS the M9 Retrospector                                                                                          
                                                                                                                         
  ---                                                                                                                    
  The Gap in Your Plan                          
  ---
  The Gap in Your Plan

  Steve's pattern: Single workflow = one orchestrator + N specialist agents dispatched within it. The orchestrator is a
  manager, never a doer.

  Your current plan: Single workflow = one agent doing everything sequentially. M11.08 adds parallelism across different
  work items, not within a single workflow.

  These are different dimensions. You're missing the intra-workflow multi-agent pattern entirely.

  What this affects concretely:
  1. Your investigate skill will run one agent sequentially — Steve's runs 4–6 in parallel. Investigation quality and
  spec grounding will be materially worse.
  2. Your plan phase has no parallel adversarial review round
  3. Your build phase has no parallel WP execution

  ---
  Recommendation

  This isn't just inspirational — it's the core dispatch pattern that makes the lifecycle viable. You need a milestone or
   issues that encode:

  1. Skill authoring convention: skills can dispatch sub-agents (already implied by your skill structure but not explicit
   in the FACTORY_RULES)
  2. Investigation skill: implements the 2-wave swarm pattern
  3. Builder dispatch pattern: one Task per WP, concurrent, file ownership

  The lifecycle.md skill is the single most valuable artifact here — it's a production-proven implementation of exactly
  what Factory is building. Worth reading it as the reference design before any M5+ work.

# Todo
Invoke web standards [retrospectivesection, reviewsection, timelineevents] -- way to big. Interface should be in logical place (lib) and shared. 
Too many components and lines of code inside each of them, things could be split out into seperate files. 
Tests - whats level are we at seems low?
Loading ... should always be something inside timeline "agent run" window indicating it's loading. This is seen on code.
General loading - details page all have "no content" part, but should have a consistent "loading" page as well.
Remove fake triage
Agent swarms investigation... implementation?

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