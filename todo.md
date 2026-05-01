scrollbars / overflow
Agents are meant to be merging into a feature branch E.g. feature-milestone-3 -> worktree-agent-xxx. Remember - this is eventually going to be autonomous.

## Steves

  Tier 1 — New standalone issues (genuinely missing from the plan):                                                                                                                             
  - "Define three-tier verification framework (Structural/Functional/Regression) as Factory harness standard" → add to M6 milestone
  - "Extract learning loop data models (DecisionRecord, LearningEntry, QualityScore) into Retrospector skill schema" → add to M9 milestone                                                      
  - "Document spawn security rules (argv discipline, stdout cap, binary resolution) as Factory FACTORY_RULES entry" → add to M4           
                                                                                                                                                                                                
  Tier 2 — Checklist additions to existing issues (not new issues, just context):                                                                                                               
  - 8-category code quality rubric → add to whatever M6 issue covers code_quality_audit gate                                                                                                    
  - Fix-or-register rule → add to QA skill issue                                                                                                                                                
  - -f feature-name isolation discipline → add to orchestrator concurrency issue                                                                                                                
                                                                                                                                                                                                
  The analysis doc already exists as the reference; issues just need to point at it.    

                                                                                                                                                                                                  
  Milestones created: M4 (5), M8 (6), M9 (7)                                                                                                                                                    
                                                                                                                                                                                                
  Tier 1 — 3 new issues:                                                                                                                                                                        
  - #76 — Three-tier verification framework → M8, priority:high, schedule:next
  - #77 — Learning loop data models → M9, priority:medium, schedule:later                                                                                                                       
  - #78 — Subprocess spawn security rules → M4, priority:high, schedule:next
                                                                                                                                                                                                
  Tier 2 — Checklist additions:                                                                                                                                                                 
  - 8-category code quality rubric + scoring table added to #76 (fix-or-register was already there)                                                                                             
  - -f feature-name workflow isolation note added to #78 with flag to M5 parallel design                                                                                                        
                                                                                                                                                                                                
  Tier 2 item 2 (fix-or-register → QA skill issue) was already in #76's body from Tier 1; no separate addition needed. 