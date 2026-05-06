# Unknown
0. When a task gets blocked... i need some way of fixing it. Need to consider how i can send it back to the dev/qa/triage... Assuming i should be able to do this in the "transition" drop down. Ideally the banner shown "Human intervention reuqired" has a link or guidance... Lets plan it
0a. QA and Investigation section "rerun and other buttons"
1. Remove fake triage

# Todo
Invoke web standards [retrospectivesection, reviewsection, timelineevents] -- way to big. Interface should be in logical place (lib) and shared. 
Too many components and lines of code inside each of them, things could be split out into seperate files. 
Tests - whats level are we at seems low?
Loading ... should always be something inside timeline "agent run" window indicating it's loading. This is seen on code.
Timeline needs header like other pages. Put expand / collapse next to it.

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

# Retrospective design thing

  Ok before we do that. There is alot of data in that JSON that isn't really showing through on the retrospective page. Where is decision patterns, decision summaries,              
  learningEntries, outcome. On the personaQualityScores it should show the trend i guess (whatever that is?), and also the personas actual name (from the db).                       
                                                                                                                                                                                     
  Also, perhaps use some of the styling found on the review page? Make it look better     

# light 

  {
    "workItemNumber": 513,
    "outcome": "success",
    "summaryBullets": [
        "**Went well:** TDD loop was tight — 5 tests written red, then green, with all 17 pre-existing timeline tests staying green; multi-reviewer pipeline (4 reviewers, confidence 0.82–0.87) converged quickly with no blockers.",
        "**Could be smoother:** `REGRESSION_CHECK` was skipped across every review because no `e2eCommand` is configured; an e2e spec was added but never executed, leaving a gap that reviewers had to call out explicitly.",
        "**Main takeaway (dev/TDD + retrospector):** The tick-based expand-signal pattern was correct but non-obvious enough that the dev self-scored time-to-capability at 13/15; a short inline comment on the mount-time guard would have pre-empted the gap without any reviewer needing to flag it."
    ],
    "improvementCandidates": [
        {
            "kind": "project-config",
            "targetPath": ".claude/settings.json",
            "suggestionText": "Add an `e2eCommand` entry to the project config so REGRESSION_CHECK can execute the e2e suite rather than skipping — three consecutive review stages flagged the gap on this run.",
            "confidence": "high"
        },
        {
            "kind": "skill-prompt",
            "targetPath": ".claude/skills/superpowers/executing-plans.md",
            "suggestionText": "Add an explicit scope-hygiene rule prohibiting edits to config files (settings.json, CI config) that are unrelated to the feature being implemented — four independent reviewers noted the out-of-scope settings.json change as a recurring noise pattern.",
            "confidence": "high"
        }
    ],
    "decisionSummaries": [
        {
            "kind": "VERDICT",
            "summary": "Retro complete: clean success on #513 with two high-confidence improvement candidates — add e2eCommand to project config and add scope-hygiene guard to executing-plans skill prompt."
        }
    ]
}

# deep

 {                                                                                                                                                                                  
      "tier": "deep",                                                                                                                                                                
      "output": {                                                                                                                                                                    
          "workItemNumber": 513,                                                                                                                                                     
          "triggerReasons": [                                                                                                                                                        
              "standard-deep"                                                                                                                                                        
          ],                                                                                                                                                                         
          "outcome": "success",                                                                                                                                                      
          "summary": {                                                                                                                                                               
              "wentWell": "TDD discipline held: 5 tests written red before implementation, all 5 green after; 17 existing timeline tests unaffected; tick-signal cleanly extended    
  existing TimelineContext with no new slice or cross-slice imports; all 4 reviewers converged on approval.",                                                                        
              "didNotGoWell": "settings.json mutated out-of-scope, removing previously configured hooks; e2e spec added but no e2eCommand configured making it non-runnable in CI —  
  both surfaced across all 4 reviewer passes.",                                                                                                                                      
              "architecturalTakeaway": "Tick-based expand/collapse signal (increment counter, useEffect guard on non-zero) is correct for React but requires reading the guard to    
  understand mount-time skip; explicit callback API would reduce cognitive load."                                                                                                    
          },                                                                                                                                                                         
          "personaQualityScores": [                                                                                                                                                  
              {                                                                                                                                                                      
                  "personaId": "goose-hub-self/developer",                                                                                                                           
                  "score": 0.88,                                                                                                                                                     
                  "trend": "stable",                                                                                                                                                 
                  "sampleCount": 1                                                                                                                                                   
              },                                                                                                                                                                     
              {                                                                                                                                                                      
                  "personaId": "goose-hub-self/retrospector/2",                                                                                                                      
                  "score": 0.84,                                                                                                                                                     
                  "trend": "stable",                                                                                                                                                 
                  "sampleCount": 1                                                                                                                                                   
              }                                                                                                                                                                      
          ],                                                                                                                                                                         
          "learningEntries": [                                                                                                                                                       
              {                                                                                                                                                                      
                  "observation": "settings.json was restructured (hooks removed) as a side-effect of the #513 feature commit.",                                                      
                  "rationale": "Out-of-scope file mutations risk reverting intentional configuration and erode reviewer trust even when all feature criteria are met.",              
                  "improvementKind": "scope-discipline",                                                                                                                             
                  "confidence": "high"                                                                                                                                               
              },                                                                                                                                                                     
              {                                                                                                                                                                      
                  "observation": "E2e spec was added to the commit but no e2eCommand is configured, leaving it non-executable in CI.",                                               
                  "rationale": "Unreachable tests provide false confidence of e2e coverage without actually delivering it.",                                                         
                  "improvementKind": "tooling-gap",                                                                                                                                  
                  "confidence": "high"                                                                                                                                               
              },                                                                                                                                                                     
              {                                                                                                                                                                      
                  "observation": "Issue #513 had no checkboxes; all 4 reviewers independently inferred 4-5 distinct acceptance-criteria lists from the same prose.",                 
                  "rationale": "Prose-only ACs force redundant interpretation work across agents and allow divergent coverage assessments.",                                         
                  "improvementKind": "issue-quality",                                                                                                                                
                  "confidence": "high"                                                                                                                                               
              },                                                                                                                                                                     
              {                                                                                                                                                                      
                  "observation": "Tick-based expand/collapse signal (expandSignal counter, useEffect skips zero on mount) is correct but the mount-time guard is non-obvious.",      
                  "rationale": "Patterns with hidden initialization guards increase onboarding cost; explicit callback APIs achieve the same result with less cognitive overhead.",  
                  "improvementKind": "api-design",                                                                                                                                   
                  "confidence": "medium"                                                                                                                                             
              }                                                                                                                                                                      
          ],                                                                                                                                                                         
          "decisionPatterns": [                                                                                                                                                      
              {                                                                                                                                                                      
                  "pattern": "Reviewers independently infer ACs from prose when no checkboxes exist",                                                                                
                  "occurrences": 4,                                                                                                                                                  
                  "confidence": "low",                                                                                                                                               
                  "note": "All 4 reviewer passes performed independent criteria inference from the same prose body, producing 4-5 distinct lists."                                   
              },                                                                                                                                                                     
              {                                                                                                                                                                      
                  "pattern": "VERDICT approval confidence caps at 0.82–0.87 when ACs are inferred rather than explicit",                                                             
                  "occurrences": 4,                                                                                                                                                  
                  "confidence": "low",                                                                                                                                               
                  "note": "Every reviewer cited informal prose as the reason confidence did not reach 0.9."                                                                          
              }                                                                                                                                                                      
          ],                                                                                                                                                                         
          "improvementCandidates": [                                                                                                                                                 
              {                                                                                                                                                                      
                  "file": ".claude/settings.json",                                                                                                                                   
                  "action": "Audit and restore hooks removed by the out-of-scope mutation in the #513 commit; add a pre-commit or review gate that flags settings.json changes in    
  feature PRs for explicit human sign-off.",                                                                                                                                         
                  "evidence": "INSIGHT decision summary: 'settings.json hook/permission restructure is out-of-scope for this feature and removes previously configured hooks' —      
  independently surfaced by all 4 reviewer agents.",                                                                                                                                 
                  "confidence": "high"                                                                                                                                               
              }                                                                                                                                                                      
          ],                                                                                                                                                                         
          "decisionSummaries": [                                                                                                                                                     
              {                                                                                                                                                                      
                  "kind": "VERDICT",                                                                                                                                                 
                  "summary": "Deep retro complete: #513 shipped cleanly via disciplined TDD with all feature criteria met across 4 independent reviewers, but settings.json          
  out-of-scope mutation and non-runnable e2e spec are the two actionable gaps requiring follow-up."                                                                                  
              }                                                                                                                                                                      
          ]                                                                                                                                                                          
      }                                                                                                                                                                              
  }      