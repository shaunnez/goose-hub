# Training: Building a Learning & Convergence Loop

How to build a system that learns across iterations and sessions, tracks progress
toward a quality goal, detects convergence, mines decision patterns, and exports
playbooks for reuse. This is the Karpathy-style observe-classify-analyze-improve
loop. The companion template at the end is pluggable.

---

## What Is a Learning Loop?

A fix loop (doc 05) runs N iterations and stops. A **learning loop** does something
more: it records what it learned, mines patterns from past decisions, detects when
progress has stalled, and exports transferable knowledge. It's the difference between
"run tests and fix bugs" and "get measurably better at building software over time."

The core cycle:

```
OBSERVE -> CLASSIFY -> ANALYZE -> IMPROVE -> (measure) -> (repeat or converge)
```

This runs within a single lifecycle iteration AND across multiple lifecycles/sessions.
The system has two speeds:
- **Fast path (per-iteration):** Log decisions, record learnings, compute quality scores
- **Analytical path (cross-session):** Mine patterns, compute convergence, export playbooks

---

## The Two Learning Speeds

### Fast Path: Within a Lifecycle

Every iteration records structured data:

```
ITERATION N
├── Decisions: "I chose X because Y" (DecisionRecord)
├── Learnings: "I discovered Z" (LearningEntry)
├── Quality: score N/100 (QualityScore)
├── Regressions: "A broke because B" (RegressionEntry)
└── State: saved to disk (JSON)
```

This data is immediately useful -- the next iteration can see what the previous one
learned and avoid repeating mistakes.

### Analytical Path: Across Lifecycles

After a lifecycle completes, its state is archived. Periodically (nightly, weekly, or
on-demand), the analytical path runs:

```
ARCHIVED LIFECYCLES
├── Pattern Mining: group decisions by (type, phase), find most common actions
├── Retrospective: compute phase timing, identify failure patterns
├── Playbook Export: aggregate learnings, compute gate thresholds
└── Improvement Candidates: spawn new lifecycles to fix systemic issues
```

---

## Core Data Models

### DecisionRecord

Every autonomous decision is logged:

```
DecisionRecord:
  decision_type: enum     # MODEL_SELECTION, SCOPE_CHANGE, SKIP_GATE, ESCALATE, etc.
  what: str               # What action was taken
  why: str                # Reasoning (this is the learning signal)
  timestamp: str          # ISO 8601
  iteration: int          # Which iteration
  phase: str              # Which lifecycle phase
  domain: str?            # Business domain tag (for domain-scoped mining)
```

**Why log the "why":** The action alone isn't enough. "Skipped code review" could be
lazy or correct. "Skipped code review because this is a 1-line config change with no
business logic" is a pattern worth mining.

### LearningEntry

Discovered knowledge:

```
LearningEntry:
  category: enum          # GOTCHA, PATTERN, REGRESSION_ROOT_CAUSE, TOOL_ISSUE, ARCHITECTURE
  description: str        # What was learned
  timestamp: str
  iteration: int
  related_files: list[str]  # Files that produced this learning
  domain: str?              # Business domain tag
  goal_id: str?             # Strategic goal reference
  source_feature: str?      # Feature name (for cross-lifecycle transfer)
```

### QualityScore

Composite quality measurement at a point in time:

```
QualityScore:
  score: float            # 0-100
  timestamp: str
  iteration: int
  components:             # What contributed to this score
    p0_count: int         # Critical findings
    p1_count: int         # High findings
    p2_count: int         # Medium findings
    p3_count: int         # Low findings
    regressions_open: int
    review_converged: bool
    uat_passed: bool
    static_passed: bool
    harness_pass_rate: float  # passed / total
```

---

## Convergence Detection

Convergence answers: "Should we keep iterating or have we plateaued?"

### Score-Based Convergence

```python
def is_converged(scores: list[QualityScore]) -> tuple[bool, str]:
    if len(scores) < 2:
        return False, "Need at least 2 scores"

    # Check for critical blockers (P0/P1 regressions block convergence)
    latest = scores[-1]
    if latest.components.p0_count > 0 or latest.components.p1_count > 0:
        return False, f"Open P0={latest.p0_count} P1={latest.p1_count}"

    # Check for stalling (score delta < threshold)
    recent_scores = [s.score for s in scores[-3:]]
    delta = max(recent_scores) - min(recent_scores)
    if delta < 5.0:
        return True, f"Score stalled (delta={delta:.1f} < 5.0)"

    return False, "Still improving"
```

### Score Regression Detection

```python
def has_score_regression(scores: list[QualityScore]) -> tuple[bool, float]:
    if len(scores) < 2:
        return False, 0.0

    current = scores[-1].score
    previous = scores[-2].score
    drop = previous - current

    if drop > 10.0:
        return True, drop  # Quality regressed significantly
    return False, drop
```

### Ship-Readiness Check

```python
def is_ship_ready(state) -> tuple[bool, list[str]]:
    blockers = []
    if state.quality_score < 80.0:
        blockers.append(f"Quality {state.quality_score} < 80.0")
    if state.code_quality_score < 60.0:
        blockers.append(f"Code quality {state.code_quality_score} < 60.0")
    if state.p0_regressions > 0:
        blockers.append(f"{state.p0_regressions} open P0 regressions")
    if state.total_regressions > 3:
        blockers.append(f"{state.total_regressions} total regressions > 3")
    return len(blockers) == 0, blockers
```

---

## Decision Pattern Mining

After lifecycles complete, mine their decisions to find reusable patterns.

### The Mining Process

```
1. Load all archived lifecycle state files
2. Extract decisions[] array from each
3. Group by (decision_type, phase) tuple
4. For each group:
   a. Find most common action (Counter.most_common(1))
   b. Find most common reason
   c. Calculate consistency = top_count / total_count
   d. Record example features that produced this pattern
5. Save patterns to database / JSON
```

### DecisionPattern

```
DecisionPattern:
  decision_type: str        # e.g., "MODEL_SELECTION"
  phase: str                # e.g., "BUILDING"
  action_summary: str       # Most common action taken
  reason_summary: str       # Most common reason given
  occurrence_count: int     # How many times this pattern was seen
  consistency_score: float  # 0.0-1.0 (1.0 = always the same action)
  example_features: list    # Up to 5 features that showed this pattern
  last_seen: str            # Most recent occurrence
```

**Consistency score is key.** A pattern with consistency 0.95 (same action 95% of
the time) is a reliable rule. A pattern with consistency 0.40 is a judgment call
that depends on context.

### Using Mined Patterns

When making a new decision, check the pattern library:

```
1. Look up (decision_type, phase) in patterns
2. If consistency > 0.8: follow the pattern (it's a reliable rule)
3. If consistency 0.5-0.8: consider the pattern but evaluate context
4. If consistency < 0.5: no reliable pattern exists, use judgment
5. Log the decision either way (future mining will update the pattern)
```

---

## Playbook Export/Import

A playbook is a portable bundle of everything learned from a project:

### PlaybookManifest

```
PlaybookManifest:
  schema_version: "1.0"
  generated_at: str
  source_project: str
  feature_count: int          # How many lifecycles contributed
  learnings:                  # Aggregated across all features
    - category: str
      description: str
      occurrence_count: int   # How many times this was learned
      first_seen: str
      last_seen: str
      domain: str?
  gate_thresholds:            # Learned pass thresholds per gate
    - gate_name: str
      phase: str
      mean_score: float
      min_score: float
      max_score: float
      std_dev: float?
  decision_patterns:          # Mined patterns (see above)
  cost_baselines:             # Cost per phase, per model
```

### Export Process

```
1. Load all archived lifecycles (up to 1000)
2. Aggregate learnings:
   - Group by (category, description)
   - Count occurrences
   - Track first_seen / last_seen
3. Compute gate thresholds:
   - Group gates by (name, phase)
   - Calculate mean/min/max scores
   - Compute std_dev if >1 sample
4. Query decision_patterns table
5. Create PlaybookManifest JSON
6. Save to file and/or database
```

### Import Process

```
1. Load PlaybookManifest JSON
2. Validate schema version
3. Upsert decision_patterns into database
4. Save playbook to playbooks table
5. Patterns are now available for future decision-making
```

**Cross-project transfer:** Export from Project A, import into Project B. The new
project immediately benefits from patterns learned in the old one.

---

## The Nightly Retrospective

An automated analysis that runs periodically:

```
NIGHTLY RETROSPECTIVE
├── Load archives from date range
├── Phase Timing Analysis:
│   ├── Average time per phase
│   ├── Identify slow phases (>2x average)
│   └── Recommend: "PLANNING averaging 4h, consider pre-investigation"
├── Harness Layer Failures:
│   ├── Failure rate per layer across archives
│   ├── Layers failing >50% of the time
│   └── Recommend: "Layer 3 (console errors) fails in 80% of lifecycles"
├── Regression Patterns:
│   ├── Most common regression root causes
│   ├── Files that appear in regressions most often
│   └── Recommend: "auth.py appears in 60% of regressions"
├── Cost Analysis:
│   ├── Cost per quality point
│   ├── Model allocation efficiency
│   └── Recommend: "Opus overused in Wave 1 investigation"
└── Improvement Candidates:
    ├── Ranked list of process improvements
    ├── Each with estimated impact and effort
    └── Optionally: spawn improvement lifecycles autonomously
```

---

## Session Mining (User Feedback Loop)

An additional learning channel: mine the user's corrections from session transcripts.

### What to Detect

| Category | Signal | Example |
|----------|--------|---------|
| PROCESS_COMPLAINT | User says "stop", "don't", "why did you" | "Stop summarizing at the end" |
| QUALITY_ISSUE | User points out a bug or mistake | "That column doesn't exist" |
| ARCHITECTURE_DIRECTION | User redirects the approach | "Use events, not polling" |
| STALL_NUDGE | User pushes past a stuck point | "Just do it, stop asking" |
| POSITIVE_SIGNAL | User confirms an approach worked | "Yes, exactly like that" |

### Mining Process

```
1. Scan session transcripts (JSONL files)
2. Identify user messages that are corrections or confirmations
3. Classify each by category
4. Count recurring patterns
5. Generate improvement proposals:
   - "User corrected column name 3 times -> add to known errors"
   - "User redirected approach on auth 5 times -> add to learnings"
6. Feed into retrospective analysis
```

---

## The Full Learning Architecture

```
                    FAST PATH (per-iteration)
                    ┌──────────────────────────────┐
                    │ record_decision(type, what, why)
                    │ add_learning(category, desc)
                    │ compute_quality_score(...)
                    │ is_converged() -> continue?
                    └──────────────┬───────────────┘
                                   │
                                   v
                    LIFECYCLE COMPLETION
                    ┌──────────────────────────────┐
                    │ Archive state snapshot
                    │ Extract decisions to DB
                    │ Mark for mining
                    └──────────────┬───────────────┘
                                   │
                    ANALYTICAL PATH (cross-session)
                    ┌──────────────┴───────────────┐
                    │                              │
                    v                              v
              Pattern Mining              Nightly Retrospective
              ┌──────────────┐           ┌──────────────┐
              │ Group decisions│           │ Phase timing  │
              │ by type:phase │           │ Failure rates │
              │ Calculate     │           │ Cost/quality  │
              │ consistency   │           │ Improvements  │
              └──────┬───────┘           └──────┬───────┘
                     │                          │
                     v                          v
              Playbook Export            Spawn Improvements
              ┌──────────────┐           ┌──────────────┐
              │ Learnings    │           │ New lifecycles│
              │ Gate thresholds│         │ targeting     │
              │ Decision patterns│       │ systemic      │
              │ Cost baselines │          │ issues        │
              └──────────────┘           └──────────────┘
                     │
                     v
              Import Into New Project
              ┌──────────────┐
              │ Pre-loaded   │
              │ patterns for │
              │ day-1 quality│
              └──────────────┘
```

---

## Practical Implementation Guide

### Step 1: Add Decision/Learning Recording to Your State

```python
# In your state model, add:
decisions: list[DecisionRecord] = Field(default_factory=list)
learnings: list[LearningEntry] = Field(default_factory=list)
quality_scores: list[QualityScore] = Field(default_factory=list)

# Methods:
def record_decision(self, type, what, why):
    self.decisions.append(DecisionRecord(
        decision_type=type, what=what, why=why,
        iteration=self.iteration, phase=self.phase,
    ))

def add_learning(self, category, description, related_files=None):
    self.learnings.append(LearningEntry(
        category=category, description=description,
        iteration=self.iteration, related_files=related_files or [],
    ))
```

### Step 2: Add Convergence Detection

```python
def check_convergence(self):
    if len(self.quality_scores) < 2:
        return False, "Insufficient data"

    # Block on critical regressions
    latest = self.quality_scores[-1]
    if latest.p0_count > 0:
        return False, "Open P0 regressions"

    # Detect stalling
    recent = [s.score for s in self.quality_scores[-3:]]
    if max(recent) - min(recent) < self.convergence_threshold:
        return True, "Score converged"

    return False, "Still improving"
```

### Step 3: Add Pattern Mining

```python
def mine_patterns(archives):
    groups = defaultdict(list)
    for archive in archives:
        for decision in archive.decisions:
            key = (decision.decision_type, decision.phase)
            groups[key].append(decision)

    patterns = []
    for (dtype, phase), decisions in groups.items():
        actions = Counter(d.what for d in decisions)
        reasons = Counter(d.why for d in decisions)
        top_action, top_count = actions.most_common(1)[0]

        patterns.append(DecisionPattern(
            decision_type=dtype,
            phase=phase,
            action_summary=top_action,
            reason_summary=reasons.most_common(1)[0][0],
            occurrence_count=len(decisions),
            consistency_score=top_count / len(decisions),
        ))
    return patterns
```

### Step 4: Add Playbook Export

```python
def export_playbook(archives):
    # Aggregate learnings
    learning_groups = defaultdict(list)
    for archive in archives:
        for learning in archive.learnings:
            key = (learning.category, learning.description)
            learning_groups[key].append(learning)

    aggregated = [
        PlaybookLearning(
            category=cat, description=desc,
            occurrence_count=len(entries),
            first_seen=min(e.timestamp for e in entries),
            last_seen=max(e.timestamp for e in entries),
        )
        for (cat, desc), entries in learning_groups.items()
    ]

    return PlaybookManifest(
        learnings=aggregated,
        decision_patterns=mine_patterns(archives),
        feature_count=len(archives),
    )
```

---

## Pluggable Template

Copy everything below into your project. This is a complete learning loop skill.

---

```markdown
---
name: {{learning-loop-name}}
description: >
  Self-improving {{domain}} loop that tracks toward {{goal}} through multiple
  sessions. Observes, classifies, analyzes, and improves. Mines patterns from
  past decisions. Exports playbooks for reuse.
  Trigger: /{{learning-loop-name}}, "{{trigger_1}}", "{{trigger_2}}"
---

# {{Loop Display Name}} -- Learning & Convergence Loop

## 1. Identity

You are a **self-improving quality engineer** running an observe-classify-analyze-
improve cycle against {{system_under_test}}. You track every decision, learn from
every iteration, detect when progress stalls, and export what you learn for reuse.

**Your tools:**
- `python3 scripts/{{state_script}}.py` -- state machine with learning
- `python3 scripts/{{harness_script}}.py` -- measurement harness
- `python3 scripts/{{miner_script}}.py` -- pattern mining
- `python3 scripts/{{playbook_script}}.py` -- playbook export/import
- `Task` tool -- dispatch sub-agents

**Your constraints:**
- ALWAYS record decisions with reasoning (the "why" is the learning signal)
- ALWAYS record learnings when you discover something unexpected
- NEVER continue past convergence (stalled score + no critical regressions)
- ALWAYS check for existing patterns before making decisions
- NEVER discard prior session learnings -- they compound

---

## 2. State Machine

```
OBSERVE -> CLASSIFY -> ANALYZE -> IMPROVE -> MEASURE -> (converge or repeat)
    ^                                                        |
    +------------------------ loop --------------------------+
```

### Convergence Criteria

- Quality score stalled (delta < {{convergence_threshold}} across last 3 scores)
- Zero open P0/P1 regressions
- Target score reached: {{target_score}}/100
- OR max iterations: {{max_iterations}}

---

## 3. Per-Iteration Protocol

### OBSERVE (Measure Current State)

```bash
python3 scripts/{{harness_script}}.py --full --json
```

Record quality score:
```bash
python3 scripts/{{state_script}}.py record-score \
  --score {{score}} \
  --p0 {{count}} --p1 {{count}} --p2 {{count}} --p3 {{count}}
```

### CLASSIFY (Categorize Findings)

| Category | Signal | Action |
|----------|--------|--------|
| {{category_1}} | {{signal}} | {{action}} |
| {{category_2}} | {{signal}} | {{action}} |
| {{category_3}} | {{signal}} | {{action}} |

Record decisions:
```bash
python3 scripts/{{state_script}}.py record-decision \
  "{{decision_type}}" "{{what}}" "{{why}}"
```

### ANALYZE (Check Patterns + Convergence)

1. Check existing patterns:
   ```bash
   python3 scripts/{{miner_script}}.py query --type {{decision_type}} --phase {{phase}}
   ```
   If consistency > 0.8: follow the pattern.
   If consistency < 0.5: use judgment.

2. Check convergence:
   ```bash
   python3 scripts/{{state_script}}.py check-convergence
   ```
   If converged: advance to REPORTING.
   If regressed: investigate before continuing.

### IMPROVE (Apply Fixes)

1. Dispatch builders for fixable findings
2. Record learnings:
   ```bash
   python3 scripts/{{state_script}}.py add-learning \
     "{{category}}" "{{what_was_learned}}" --files "{{related_files}}"
   ```
3. Restart/reload services
4. Return to OBSERVE

---

## 4. Cross-Session Protocol

### After Lifecycle Completes

```bash
# Archive the lifecycle state
python3 scripts/{{state_script}}.py archive

# Mine patterns from all archives
python3 scripts/{{miner_script}}.py mine --all

# Export playbook
python3 scripts/{{playbook_script}}.py export --output playbook.json
```

### Before Starting New Lifecycle

```bash
# Import playbook (if available)
python3 scripts/{{playbook_script}}.py import --input playbook.json

# Check patterns for the type of work
python3 scripts/{{miner_script}}.py query --type {{work_type}}
```

### Nightly Retrospective (Optional)

```bash
python3 scripts/{{retrospective_script}}.py analyze \
  --date-from {{start}} --date-to {{end}}
```

Outputs:
- Phase timing analysis (slow phases)
- Failure rate per harness layer
- Cost per quality point
- Improvement candidates (ranked)

---

## 5. Decision Types

| Type | When | Example |
|------|------|---------|
| MODEL_SELECTION | Choosing which model for a task | "Used Opus for schema change (>5 files)" |
| SCOPE_CHANGE | Expanding/contracting work scope | "Added WP4 for migration script" |
| SKIP_GATE | Skipping a skippable gate | "Skipped code review -- 1-line config" |
| ESCALATE | Pulling in human/higher authority | "Escalated -- auth architecture unclear" |
| FIX_STRATEGY | Choosing how to fix a finding | "Refactored vs patched -- chose refactor" |

---

## 6. Learning Categories

| Category | When | Example |
|----------|------|---------|
| GOTCHA | Surprising behavior | "Column name differs between DB and ORM" |
| PATTERN | Reusable approach | "Service consolidation: authority pattern" |
| REGRESSION_ROOT_CAUSE | Why something broke | "Shared enum changed without migration" |
| TOOL_ISSUE | Tool/infra problem | "Playwright timeout needs 15s on CI" |
| ARCHITECTURE | Design decision | "Events > polling for cross-service sync" |

---

## 7. Convergence Thresholds

| Metric | Threshold | Meaning |
|--------|-----------|---------|
| Score delta | < {{convergence_threshold}} | Score has stalled |
| Regression drop | > {{regression_threshold}} | Quality regressed |
| Ship-ready score | >= {{ship_threshold}} | Ready to ship |
| Code quality floor | >= {{quality_floor}} | Minimum code quality |
| Max iterations | {{max_iterations}} | Hard stop |
```

---

**End of Learning & Convergence Loop Training Document**
