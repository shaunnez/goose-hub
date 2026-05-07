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