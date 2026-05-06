---
name: drift
description: >
  ORM drift detection and query integrity verification. Runs the unified 8-layer
  harness against the live database and codebase. Checks model↔DB alignment,
  column references, forbidden attributes, and module imports.
  Trigger: /drift, "run drift check", "check ORM drift", "verify models"
---

# ORM Drift Detection Skill

## What This Does

Runs `scripts/verify_orm_drift.py` — the unified 8-layer verification harness — and reports results.

## Layers

| Layer | Check | Requires DB |
|-------|-------|-------------|
| 1 | Schema Presence — do all ORM tables exist in DB? | Yes |
| 2 | Column Alignment — phantoms + missing columns | Yes |
| 3 | Type Alignment — type/precision/length/tz mismatches | Yes |
| 4 | Nullable Alignment — nullable flag drift | Yes |
| 5 | FK Integrity — foreign key target resolution | Yes |
| 6 | Forbidden Attributes — renamed column usage in code | No |
| 7 | Import Validation — ORM attribute access verification | No |
| 8 | Module Import Test — catch AttributeError on import | No |

## How to Run

When triggered, execute:

```bash
cd backend && python3 ../scripts/verify_orm_drift.py --verbose
```

### Options

- **Full scan (default):** All 8 layers against all 38 modeled tables
- **Specific layer:** `--layer 6` (just forbidden attributes — fast, no DB needed)
- **Specific tables:** `--tables orders,order_items` (subset check)
- **JSON output:** `--json` (machine-readable for CI)
- **Code-only checks (no DB):** `--layer 6` or `--layer 7` or `--layer 8`

## Interpreting Results

- **0 failures, 0 warnings** = clean — models match DB, code references are correct
- **Failures in Layer 2** = column drift — ORM has columns DB doesn't (phantom) or DB has columns ORM doesn't (missing)
- **Failures in Layer 3** = type/precision drift — column types don't match between ORM and DB
- **Failures in Layer 6** = someone used a renamed column name (e.g., `OrderItem.name` instead of `OrderItem.item_name`)
- **Failures in Layer 7** = code references a column that doesn't exist on the model
- **Failures in Layer 8** = a module crashes on import (likely AttributeError from wrong column name)
- **3 WARN for pgvector columns** = expected and normal (embedding columns have no standard SA type)

## Exit Codes

- `0` = all layers pass
- `1` = drift detected (any FAIL finding)
- `2` = infrastructure error (can't connect to DB or parse models)

## When to Run

- After any model change (`operational_models.py`)
- After any migration (`alembic_analytics/versions/`)
- After any query migration (text() → select())
- Before shipping any feature that touches the semantic layer or skills
- As part of CI (target: run on every push)

## Fixing Drift

If the harness finds drift:
1. **Layer 2 phantom** → Remove the column from the ORM model
2. **Layer 2 missing** → Add the column to the ORM model (match DB exactly)
3. **Layer 3 type** → Fix the SQLAlchemy type to match `information_schema`
4. **Layer 6 forbidden** → The message tells you the correct attribute name
5. **Layer 7 invalid access** → Check the model for the correct column name
6. **Layer 8 import error** → The traceback shows exactly which attribute is wrong
