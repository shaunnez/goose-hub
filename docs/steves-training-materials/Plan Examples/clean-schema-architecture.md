# Spec: Clean Schema Architecture — Ledger-to-Business Translation

## Objective
Restructure the data pipeline so `pos_operational` tables contain ONLY real business objects. Ledger artifacts (split checks, overring reversals, non-sales items, modifiers, deleted items) move to a `pos_audit` schema. Eliminates 110 filter instances across 8 files. Every downstream query becomes correct by construction.

## Acceptance Criteria
- `SELECT SUM(total_price) FROM order_items JOIN orders o ON order_id = o.id WHERE o.location_id = X AND o.business_date BETWEEN Y AND Z` returns penny-exact revenue matching `tblRpt_SalesSummary.Sales_Amt`
- `SELECT COUNT(*) FROM orders WHERE location_id = X AND business_date = Y` returns correct order count (no splits, no overrings)
- Zero `is_check`, `is_overring`, `not_sales`, `is_modifier` exclusion filters in semantic layer
- CASK penny-exact against SP output for Sep 2025 – Feb 2026
- Validation scripts verify: `pos_audit` raw count = MSSQL raw count, `pos_operational` clean count = MSSQL filtered count

---

## Architecture

### Current Flow
```
MSSQL → Extractors (partial dedup) → StagingLoader → pos_operational (mixed) → 110 filters → queries
```

### New Flow
```
MSSQL → Extractors (dedup kept where needed) → StagingLoader
    ├→ pos_audit (ONLY tables with ledger artifacts: checks, main_items, payments, deleted_items, HRSales, DailyLabor)
    ├→ pos_operational (passthrough tables with NO artifacts: employees, products, tills, shifts, revenue_classes, employee_jobs)
    └→ Phase 2 Transform (SQL) → pos_operational (clean orders + items from audit) → queries (no filters)

Table routing:
  AUDIT-ROUTED (has ledger artifacts, needs Phase 2 filtering):
    - checks → pos_audit.checks → Phase 2 → pos_operational.orders
    - main_items → pos_audit.main_items → Phase 2 → pos_operational.order_items
    - payments → pos_audit.payments → Phase 2 → pos_operational.payment_transactions
    - deleted_items → pos_audit.deleted_items → Phase 2 → pos_operational.order_item_voids
    - HRSales → pos_audit.interval_sales_raw → Phase 2 aggregate → pos_operational.hourly_sales
    - DailyLabor → pos_audit.daily_labor_detail → Phase 2 aggregate → pos_operational.daily_labor_summary
    - check_item_discounts → pos_audit.check_item_discounts → Phase 2 → pos_operational.discount_applications
    - taxes_check → pos_audit.taxes_check → Phase 2 → pos_operational.tax_details

  DIRECT-STAGED (no artifacts, unchanged pipeline):
    - employees → pos_operational.employees
    - employee_shifts → pos_operational.employee_shifts
    - employee_jobs → pos_operational.employee_job_assignments
    - products → pos_operational.products
    - tills → pos_operational.tills
    - revenue_classes → pos_operational.revenue_classes
    - order_item_modifiers → pos_operational.order_item_modifiers (staged AFTER Phase 2)
    - surcharge_applications → pos_operational.surcharge_applications (staged AFTER Phase 2)
    - order_voids → pos_operational.order_voids (staged AFTER Phase 2)
    - till_transactions → pos_operational.till_transactions (staged AFTER Phase 2 — has order_id FK)
```

### Key Design Decisions

**D1: Dedup stays in extractors, not removed.** ChecksExtractor dedup (SUM/MAX on duplicate CheckID rows from JOIN explosions) and TimePunchesExtractor CTE (PayrollTips fan-out prevention) are DATA QUALITY operations — they fix source artifacts, not business logic. Removing them would inflate audit data. They stay in Phase 1.

**D2: Grain-changing aggregation moves to Phase 2.** HRSalesExtractor (15-min → hourly) and PrlDailyLaborExtractor (employee/job/day → location/day) are BUSINESS LOGIC operations. Phase 1 preserves original grain in `pos_audit`. Phase 2 aggregates into `pos_operational` summary tables.

**D3: Child tables handled by CASCADE + re-staging.** `payment_transactions`, `discount_applications`, `tax_details`, `surcharge_applications`, `order_voids` have `ON DELETE CASCADE` from `orders`. `order_item_modifiers` has CASCADE from BOTH `orders` AND `order_items`. `order_item_voids` has CASCADE from `order_items` (via `order_item_id` FK). Phase 2 deletes artifact orders → CASCADE auto-cleans all children. Then:
- Audit-routed children (payments, discounts, taxes): Phase 2 re-inserts from `pos_audit.*` with `INNER JOIN pos_operational.orders` (only clean parents).
- Direct-staged children (modifiers, surcharges, order_voids): staged AFTER Phase 2 completes. Pipeline order enforces this.
- order_item_voids: Phase 2 re-inserts from `pos_audit.deleted_items` with `INNER JOIN pos_operational.orders` on resolved check_id (unresolved ~8% get order_id = NULL, allowed by FK).

**D4: InclAdj baked into order, NOT MV.** Phase 2 computes `orders.net_revenue = SUM(clean_items.total_price) + incl_adj`. Column definitions: `total_price` = net item revenue (MSSQL `AmtSold` = FullPrice minus discounts). `full_price` = gross item revenue (MSSQL `FullPrice` before discounts). So: `orders.net_revenue = SUM(total_price) + incl_adj`, `orders.subtotal = SUM(full_price)` (gross). MV simply sums these pre-computed values. One authoritative formula, one place.

**D5: order_item_voids explicitly managed in Phase 2.** Migration 0005 already DROPPED FKs on order_item_voids (no CASCADE exists). Phase 2 must explicitly DELETE + re-INSERT. Keep current table structure. Do NOT add `void_type` column. Phase 2 deletes stale voids in the window, then re-inserts from `pos_audit.deleted_items`. The `order_item_id` column stays nullable (voided items excluded from clean `order_items`). Void events reference orders via `order_id` (present in clean table for non-overring orders, NULL for ~8% unresolved).

**D6: `pos_audit` has NO FKs to `pos_operational`.** Audit tables are standalone — `location_id` is a UUID column (not FK), no CASCADE dependencies. Cleanup is by simple `DELETE WHERE location_id = X`.

---

## Work Packages

### WP1: Create `pos_audit` schema + tables (Alembic migration)
**File:** `backend/alembic_analytics/versions/0022_pos_audit_schema.py`

```sql
CREATE SCHEMA IF NOT EXISTS pos_audit;

-- Raw checks (ALL — splits, overrings, everything)
-- Grain: 1 row per CheckID (dedup kept in extractor)
CREATE TABLE pos_audit.checks (
    id UUID PRIMARY KEY,
    location_id UUID NOT NULL,
    source_record_id VARCHAR(100),
    business_date DATE NOT NULL,
    open_datetime TIMESTAMP,
    close_datetime TIMESTAMP,
    server_emp_num INTEGER,
    table_number INTEGER,
    guest_count INTEGER,
    subtotal NUMERIC(12,2),
    net_sales NUMERIC(12,2),
    tax_amount NUMERIC(12,2),
    total_amount NUMERIC(12,2),
    discount_amount NUMERIC(12,2),
    tip_amount NUMERIC(12,2),
    void_amount NUMERIC(12,2),
    gratuity_amount NUMERIC(12,2),
    surcharge_amount NUMERIC(12,2),
    service_charge_amount NUMERIC(12,2),
    incl_adj NUMERIC(12,2),
    is_check BOOLEAN DEFAULT false,
    is_overring BOOLEAN DEFAULT false,
    is_voided BOOLEAN DEFAULT false,
    order_type_id INTEGER,
    order_type_description VARCHAR(200),
    ticket_time_minutes INTEGER,
    collision_count INTEGER DEFAULT 1,  -- how many source rows collapsed
    source_system VARCHAR(50) DEFAULT 'mssql',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_checks_loc_date ON pos_audit.checks (location_id, business_date);

-- Raw items (ALL — modifiers, options, not_sales, overrings, deleted)
-- Grain: 1 row per MainItemID
CREATE TABLE pos_audit.main_items (
    id UUID PRIMARY KEY,
    check_id UUID NOT NULL,  -- references pos_audit.checks.id (no FK)
    location_id UUID NOT NULL,
    source_record_id VARCHAR(100),
    business_date DATE,
    item_name VARCHAR(255),
    category VARCHAR(100),
    sub_category VARCHAR(200),
    quantity NUMERIC(10,3),
    unit_price NUMERIC(12,2),
    total_price NUMERIC(12,2),    -- Sales_Amt
    full_price NUMERIC(12,2),     -- FullPrice
    discount_amount NUMERIC(12,2),
    cost NUMERIC(12,2),
    is_modifier BOOLEAN DEFAULT false,
    is_option BOOLEAN DEFAULT false,
    not_sales BOOLEAN DEFAULT false,
    is_overring BOOLEAN DEFAULT false,
    is_voided BOOLEAN DEFAULT false,     -- DeleteID > 0
    delete_id INTEGER DEFAULT 0,
    voided_by UUID,
    void_reason VARCHAR(200),
    modifier_total NUMERIC(12,2) DEFAULT 0,
    item_tax NUMERIC(12,2) DEFAULT 0,
    is_to_go BOOLEAN DEFAULT false,
    source_system VARCHAR(50) DEFAULT 'mssql',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_items_loc_date ON pos_audit.main_items (location_id, business_date);
CREATE INDEX idx_audit_items_check ON pos_audit.main_items (check_id);

-- Raw 15-minute interval sales (original grain from tblPos_HRSales)
CREATE TABLE pos_audit.interval_sales_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL,
    business_date DATE NOT NULL,
    interval_number INTEGER NOT NULL,  -- 0-95 (15-min intervals)
    net_sales NUMERIC(12,2),
    gross_sales NUMERIC(12,2),
    order_count INTEGER,
    guest_count INTEGER,
    discount_amount NUMERIC(12,2),
    void_amount NUMERIC(12,2),
    source_system VARCHAR(50) DEFAULT 'mssql',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_interval_loc_date ON pos_audit.interval_sales_raw (location_id, business_date);

-- Raw employee-level daily labor (original grain from tblRpt_PrlDailyLabor)
CREATE TABLE pos_audit.daily_labor_detail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL,
    business_date DATE NOT NULL,
    employee_number INTEGER,
    job_id INTEGER,
    department_id INTEGER,
    regular_hours NUMERIC(10,2),
    overtime_hours NUMERIC(10,2),
    regular_cost NUMERIC(12,2),    -- POS pre-computed (includes tipped employee placeholder rates)
    overtime_cost NUMERIC(12,2),   -- POS pre-computed (includes 1.5x multiplier)
    weekly_ot_hours NUMERIC(10,2),
    daily_ot1_hours NUMERIC(10,2),
    daily_ot2_hours NUMERIC(10,2),
    day7_ot_hours NUMERIC(10,2),
    pay_rate NUMERIC(10,2),
    min_wage_adjustment NUMERIC(12,2),
    source_system VARCHAR(50) DEFAULT 'mssql',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_labor_loc_date ON pos_audit.daily_labor_detail (location_id, business_date);

-- Raw payments
CREATE TABLE pos_audit.payments (
    id UUID PRIMARY KEY,
    check_id UUID NOT NULL,
    location_id UUID NOT NULL,
    business_date DATE,
    payment_type_id INTEGER,
    payment_type_name VARCHAR(100),
    is_cash BOOLEAN DEFAULT false,
    amount NUMERIC(12,2),
    tip_amount NUMERIC(12,2),
    change_amount NUMERIC(12,2),
    server_emp_num INTEGER,
    cashier_emp_num INTEGER,
    station_id INTEGER,
    source_system VARCHAR(50) DEFAULT 'mssql',
    source_record_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_payments_loc_date ON pos_audit.payments (location_id, business_date);

-- Raw deleted items (void ledger)
CREATE TABLE pos_audit.deleted_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id UUID NOT NULL,
    business_date DATE NOT NULL,
    check_id UUID,  -- nullable (~8% unresolved via OUTER APPLY)
    item_name VARCHAR(255),
    server_emp_num INTEGER,
    deleted_by_emp_num INTEGER,
    approved_by_emp_num INTEGER,
    delete_id INTEGER,
    quantity_deleted NUMERIC(10,3),
    amount_deleted NUMERIC(12,2),
    amount_deleted_cash NUMERIC(12,2),
    amount_deleted_charge NUMERIC(12,2),
    void_reason VARCHAR(200),
    open_interval INTEGER,
    not_sales BOOLEAN DEFAULT false,
    source_system VARCHAR(50) DEFAULT 'mssql',
    source_record_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_deletes_loc_date ON pos_audit.deleted_items (location_id, business_date);
```

**NO audit tables for passthrough tables** (tills, till_transactions, employees, products, revenue_classes, employee_jobs). These have no ledger artifacts and stage directly to pos_operational.

### WP2: Modify extractors — Phase 1 routing to `pos_audit`
**Files:**
- `backend/scripts/pos_import/extractors/mssql_extractor.py`
- `backend/scripts/pos_import/loaders/staging_loader.py`
- `backend/app/temporal/schemas/provisioning_signals.py`

**Changes:**

**staging_loader.py:**
- Add `target_schema` field to `ExtractAndStageParams` signal (default: `"pos_audit"`)
- `StagingConfig.target_schema` becomes dynamic from params, not hardcoded `"pos_operational"`
- Add `_TABLE_STAGING_META` entries for all `pos_audit` tables
- New delete strategy for audit tables: `DIRECT_DATE` on `business_date` with `location_id` scoping

**mssql_extractor.py:**
- `MainItemsExtractor`: **Remove** `mi.IsModifier = 0 AND mi.IsOption = 0` SQL filter (line 363). Import everything. Add `is_modifier` and `is_option` to `map_record()`.
- `HRSalesExtractor`: **Remove** SQL GROUP BY aggregation. Extract raw 15-min intervals (IntNo). Target: `pos_audit.interval_sales_raw`.
- `PrlDailyLaborExtractor`: **Remove** Python `extract_batched()` aggregation override. Extract raw employee/job/day rows. Target: `pos_audit.daily_labor_detail`.
- `ChecksExtractor`: **Keep** dedup logic (DATA QUALITY). Add `collision_count` to output. Target: `pos_audit.checks`.
- `PaymentsExtractor`: Target: `pos_audit.payments`.
- `SalesDeletesExtractor`: Target: `pos_audit.deleted_items`.
- `CheckItemDiscExtractor`: Target: `pos_audit.check_item_discounts`.
- `TaxesCheckExtractor`: Target: `pos_audit.taxes_check`.
- `TimePunchesExtractor`: **Keep** CTE + dedup (DATA QUALITY). Target: `pos_operational.employee_shifts` (unchanged — no artifacts).
- **Passthrough extractors (NO target change):** `EmployeesExtractor`, `ProductsExtractor`, `LocationsExtractor`, `TillsExtractor`, `TillTransactionsExtractor`, `RevenueClassesExtractor`, `EmployeeJobsExtractor`, `ItemModifiersExtractor` — continue to target `pos_operational.*` directly.

**staging_loader.py additional changes:**
- Add audit tables to `_TABLES_WITH_LOCATION_ID` and `_TABLES_WITH_SOURCE_SYSTEM` sets
- Pipeline ordering: passthrough children (`order_item_modifiers`, `surcharge_applications`, `order_voids`) must stage AFTER Phase 2 completes (they CASCADE-delete when parent orders are cleaned)

**provisioning_signals.py:**
- `ExtractAndStageParams`: add `target_schema: str = "pos_audit"` field

### WP3: ETL Phase 2 — Transform `pos_audit` → `pos_operational`
**File:** NEW `backend/scripts/pos_import/transformers/business_transform.py`

Phase 2 runs as a single SQL transaction per location per date window. Idempotent via DELETE window + INSERT.

```python
class BusinessTransform:
    """Transform raw audit data into clean business objects."""

    async def transform_window(
        self, conn: asyncpg.Connection, location_id: UUID, date_from: date, date_to: date
    ) -> TransformResult:
        """Transform all audit data in the date window to clean operational tables."""
        async with conn.transaction():
            # Step 1: Clean orders (CASCADE auto-cleans all children)
            await self._transform_orders(conn, location_id, date_from, date_to)
            # Step 2: Clean order_items (from audit.main_items)
            await self._transform_order_items(conn, location_id, date_from, date_to)
            # Step 3: Children — re-insert only for clean orders
            await self._transform_payments(conn, location_id, date_from, date_to)
            await self._transform_discounts(conn, location_id, date_from, date_to)
            await self._transform_taxes(conn, location_id, date_from, date_to)
            await self._transform_modifiers(conn, location_id, date_from, date_to)
            # Step 4: Hourly sales (aggregate from 15-min intervals)
            await self._transform_hourly_sales(conn, location_id, date_from, date_to)
            # Step 5: Daily labor summary (aggregate from employee-level)
            await self._transform_daily_labor(conn, location_id, date_from, date_to)
            # Step 6: Compute orders.net_revenue from clean items
            await self._compute_order_revenue(conn, location_id, date_from, date_to)
```

**Step 1: Orders transform SQL:**
```sql
-- Delete existing orders in window (CASCADE cleans children)
DELETE FROM pos_operational.orders
WHERE location_id = :location_id
  AND business_date BETWEEN :date_from AND :date_to
  AND source_system = 'mssql';

-- Insert only real orders
INSERT INTO pos_operational.orders (id, location_id, order_number, business_date, ...)
SELECT id, location_id, source_record_id, business_date, ...
FROM pos_audit.checks
WHERE location_id = :location_id
  AND business_date BETWEEN :date_from AND :date_to
  AND is_check = false
  AND is_overring = false;
```

**Step 2: Order items transform SQL:**
```sql
-- (CASCADE already cleaned order_items via Step 1)
-- Insert only real sale items for clean orders
INSERT INTO pos_operational.order_items (id, order_id, location_id, item_name, ...)
SELECT mi.id, mi.check_id, mi.location_id, mi.item_name, ...
FROM pos_audit.main_items mi
INNER JOIN pos_operational.orders o ON mi.check_id = o.id  -- only clean orders
WHERE mi.location_id = :location_id
  AND mi.business_date BETWEEN :date_from AND :date_to
  AND mi.is_modifier = false
  AND mi.is_option = false
  AND mi.not_sales = false
  AND mi.is_overring = false
  AND mi.delete_id = 0;  -- not deleted/voided
```

**Step 3: Children — re-insert for clean orders only (scoped by location + date window):**
```sql
-- Payments: insert only for clean orders, scoped by window
INSERT INTO pos_operational.payment_transactions (...)
SELECT p.id, p.check_id, p.location_id, ...
FROM pos_audit.payments p
INNER JOIN pos_operational.orders o ON p.check_id = o.id
WHERE p.location_id = $1
  AND p.business_date BETWEEN $2 AND $3;

-- Discounts: same pattern with window scoping
INSERT INTO pos_operational.discount_applications (...)
SELECT d.id, d.check_id, d.location_id, ...
FROM pos_audit.check_item_discounts d
INNER JOIN pos_operational.orders o ON d.check_id = o.id
WHERE d.location_id = $1
  AND d.business_date BETWEEN $2 AND $3;

-- Taxes: same pattern
INSERT INTO pos_operational.tax_details (...)
SELECT t.id, t.check_id, t.location_id, ...
FROM pos_audit.taxes_check t
INNER JOIN pos_operational.orders o ON t.check_id = o.id
WHERE t.location_id = $1
  AND t.business_date BETWEEN $2 AND $3;
```

**Step 3b: order_item_voids — explicit DELETE + re-insert (NO CASCADE — FKs dropped in migration 0005):**
```sql
-- Explicitly delete stale voids in window (no CASCADE to rely on)
DELETE FROM pos_operational.order_item_voids
WHERE location_id = $1
  AND business_date BETWEEN $2 AND $3
  AND source_system = 'mssql';

-- Re-insert from audit.deleted_items
-- order_id: matched to clean orders where possible, NULL for unresolved (~8%)
-- order_item_id: NULL (voided items excluded from clean order_items by DeleteID filter)
INSERT INTO pos_operational.order_item_voids (id, order_id, order_item_id, location_id, ...)
SELECT di.id,
    o.id as order_id,  -- NULL if no matching clean order (overring check or unresolved)
    NULL as order_item_id,
    di.location_id, ...
FROM pos_audit.deleted_items di
LEFT JOIN pos_operational.orders o ON di.check_id = o.id AND o.location_id = di.location_id
WHERE di.location_id = $1
  AND di.business_date BETWEEN $2 AND $3;
```

**NOTE: order_item_modifiers, surcharge_applications, order_voids** are direct-staged children. They stage AFTER Phase 2 via the normal pipeline (SKIP delete strategy). Their CASCADE cleanup happened in Step 1, and they get re-inserted by the staging loader with the standard pipeline. No explicit Phase 2 transform needed — but pipeline ordering must ensure they run AFTER Phase 2.

**NOTE on order_item_modifiers:** This table has FK to BOTH `orders.id` (CASCADE) AND `order_items.id` (CASCADE). Since modifiers are excluded from clean `order_items` (is_modifier = true items filtered out), and the FK to order_items is CASCADE... Actually, `order_item_modifiers` stores MODIFIER APPLICATION records (which item on which order got which modifier). The parent item IS in clean order_items (it's a real sale item). The modifier itself is NOT in order_items. The FK `order_item_id` references the PARENT item, not the modifier. So this works — parent items exist in clean table, modifiers reference them correctly.

**Step 4: Hourly sales (aggregate 15-min → hourly):**
```sql
DELETE FROM pos_operational.hourly_sales
WHERE location_id = :location_id AND business_date BETWEEN :date_from AND :date_to AND source_system = 'mssql';

INSERT INTO pos_operational.hourly_sales (location_id, business_date, hour_of_day, net_sales, gross_sales, order_count, guest_count, ...)
SELECT location_id, business_date,
    LEAST(interval_number / 4, 23) as hour_of_day,
    SUM(net_sales), SUM(gross_sales), SUM(order_count), SUM(guest_count), ...
FROM pos_audit.interval_sales_raw
WHERE location_id = :location_id AND business_date BETWEEN :date_from AND :date_to
GROUP BY location_id, business_date, LEAST(interval_number / 4, 23);
```

**Step 5: Daily labor (aggregate employee → location):**
```sql
DELETE FROM pos_operational.daily_labor_summary
WHERE location_id = :location_id AND business_date BETWEEN :date_from AND :date_to;

INSERT INTO pos_operational.daily_labor_summary (location_id, business_date, regular_hours, overtime_hours, total_labor_cost, employee_count, ...)
SELECT location_id, business_date,
    SUM(regular_hours), SUM(overtime_hours),
    SUM(regular_cost) + SUM(overtime_cost),  -- POS pre-computed amounts, not hours*rate
    COUNT(DISTINCT employee_number), ...
FROM pos_audit.daily_labor_detail
WHERE location_id = :location_id AND business_date BETWEEN :date_from AND :date_to
GROUP BY location_id, business_date;
```

**Step 6: Compute orders.net_revenue:**
```sql
UPDATE pos_operational.orders o SET
    net_revenue = sub.net_item_revenue + COALESCE(o.incl_adj, 0),
    subtotal = sub.gross_item_revenue
FROM (
    SELECT oi.order_id,
        SUM(oi.total_price) as net_item_revenue,       -- total_price = AmtSold (net of discounts)
        SUM(COALESCE(oi.full_price, oi.total_price)) as gross_item_revenue  -- full_price = FullPrice (before discounts)
    FROM pos_operational.order_items oi
    WHERE oi.location_id = $1
    GROUP BY oi.order_id
) sub
WHERE o.id = sub.order_id
  AND o.location_id = :location_id
  AND o.business_date BETWEEN :date_from AND :date_to;
```

### WP4: Wire Phase 2 into Temporal workflows
**Files:**
- `backend/app/temporal/merchant_provisioning.py`
- `backend/app/temporal/sync_schedules.py`
- `backend/app/temporal/schemas/provisioning_signals.py`

**Changes:**

**New Temporal activity: `run_phase2_transform_activity`**
```python
@activity.defn
async def run_phase2_transform_activity(params: RunPhase2Params) -> RunPhase2Result:
    """Transform pos_audit → pos_operational for a location + date window."""
    transformer = BusinessTransform()
    analytics_url = resolve_analytics_url()
    async with asyncpg.create_pool(analytics_url) as pool:
        async with pool.acquire() as conn:
            result = await transformer.transform_window(
                conn, params.location_id, params.date_from, params.date_to
            )
    return result
```

**Files (expanded):**
- `backend/app/temporal/merchant_provisioning.py`
- `backend/app/temporal/sync_schedules.py`
- `backend/app/temporal/worker.py`
- `backend/app/temporal/schemas/provisioning_signals.py`

**Injection points (ALL 4 workflows):**

1. **`LocationProvisioningWorkflow`** (merchant_provisioning.py ~line 2904):
   After audit-routed `extract_and_stage_table_activity` calls, BEFORE passthrough children + pipeline:
   ```python
   # Phase 1a: Extract audit-routed tables to pos_audit
   for source_table, target_table in AUDIT_TABLES:
       await workflow.execute_activity(extract_and_stage_table_activity, ...)
   # Phase 1b: Extract passthrough parent tables to pos_operational
   for source_table, target_table in PASSTHROUGH_PARENT_TABLES:
       await workflow.execute_activity(extract_and_stage_table_activity, ...)

   # Phase 2: Transform pos_audit → pos_operational (NEW)
   if workflow.patched("phase2-transform-v1"):
       await workflow.execute_activity(run_phase2_transform_activity, RunPhase2Params(...))

   # Phase 1c: Extract passthrough children (AFTER Phase 2 — they CASCADE-deleted)
   for source_table, target_table in PASSTHROUGH_CHILD_TABLES:
       await workflow.execute_activity(extract_and_stage_table_activity, ...)

   # Phase 3: Rebuild summaries + MV refresh (existing)
   await workflow.execute_activity(run_pos_import_pipeline_activity, ...)
   ```

2. **`IncrementalSyncWorkflow`** (sync_schedules.py ~line 350): Same pattern.
3. **`OnDemandSyncWorkflow`** (sync_schedules.py ~line 573): Same pattern.
4. **`FullReloadWorkflow`** (sync_schedules.py ~line 796): Same pattern.

**worker.py:** Register `run_phase2_transform_activity` in the worker's activity list (~line 123-167).

**Table routing constants (new):**
```python
AUDIT_TABLES = [
    ("tblPos_Checks", "checks", "pos_audit"),
    ("tblPos_MainItems", "main_items", "pos_audit"),
    ("tblPos_Payments", "payments", "pos_audit"),
    ("tblRpt_SalesDeletes", "deleted_items", "pos_audit"),
    ("tblPos_HRSales", "interval_sales_raw", "pos_audit"),
    ("tblRpt_PrlDailyLabor", "daily_labor_detail", "pos_audit"),
    ("tblPos_CheckItemDisc", "check_item_discounts", "pos_audit"),
    ("tblPos_TaxesCheck", "taxes_check", "pos_audit"),
]
PASSTHROUGH_PARENT_TABLES = [
    # Employees use dedicated create_employees_activity from tblPos_EEFile — not in this loop
    ("tblPos_InvItems", "products", "pos_operational"),
    ("tblPos_Tills", "tills", "pos_operational"),
]
PASSTHROUGH_CHILD_TABLES = [  # Must stage AFTER Phase 2 (CASCADE from orders)
    ("tblPos_TimePunches", "employee_shifts", "pos_operational"),
    ("tblPos_RevenueClasses", "revenue_classes", "pos_operational"),
    ("tblPos_EEJobs", "employee_job_assignments", "pos_operational"),
]
PASSTHROUGH_CHILD_TABLES = [  # Must stage AFTER Phase 2 (CASCADE from orders)
    ("tblPos_MainItemModifiers", "order_item_modifiers", "pos_operational"),
    ("tblPos_TillTransactions", "till_transactions", "pos_operational"),
]
```

**provisioning_signals.py:** Add `RunPhase2Params` model.

### WP5: Simplified MV (Alembic migration)
**File:** `backend/alembic_analytics/versions/0023_simplified_mv.py`

```sql
DROP MATERIALIZED VIEW IF EXISTS pos_operational.mv_daily_financial_metrics CASCADE;

CREATE MATERIALIZED VIEW pos_operational.mv_daily_financial_metrics AS
WITH daily_revenue AS (
    SELECT
        o.business_date,
        o.location_id,
        SUM(o.net_revenue) as net_revenue,          -- pre-computed in Phase 2
        SUM(o.subtotal) as gross_revenue,            -- pre-computed in Phase 2
        SUM(o.discount_amount) as discounts,
        SUM(o.tax_amount) as tax_collected,
        SUM(o.tip_amount) as tips_collected,
        SUM(o.total_amount) as total_collected,
        COUNT(*) as order_count,                     -- no is_check guard needed
        SUM(o.guest_count) as guest_count,           -- no is_check guard needed
        SUM(COALESCE(oi_cogs.cogs, 0)) as cogs
    FROM pos_operational.orders o
    LEFT JOIN (
        SELECT order_id, SUM(COALESCE(cost, 0) * quantity) as cogs
        FROM pos_operational.order_items
        GROUP BY order_id
    ) oi_cogs ON oi_cogs.order_id = o.id
    WHERE COALESCE(o.is_voided, false) = false       -- real voids still excluded from revenue
      AND EXISTS (                                     -- only orders with at least 1 sale item
          SELECT 1 FROM pos_operational.order_items oi2
          WHERE oi2.order_id = o.id
      )
    GROUP BY o.business_date, o.location_id
),
daily_labor AS (
    -- Same hybrid DLS/employee_shifts pattern (already clean, no changes)
    SELECT business_date, location_id,
        total_labor_cost as labor_cost,
        total_hours as labor_hours
    FROM pos_operational.daily_labor_summary
    UNION ALL
    SELECT shift_date, location_id,
        SUM(hours_worked * hourly_rate),
        SUM(hours_worked)
    FROM pos_operational.employee_shifts es
    WHERE NOT EXISTS (
        SELECT 1 FROM pos_operational.daily_labor_summary dls
        WHERE dls.location_id = es.location_id AND dls.business_date = es.shift_date
    )
    GROUP BY shift_date, location_id
)
SELECT
    COALESCE(r.business_date, l.business_date) as business_date,
    COALESCE(r.location_id, l.location_id) as location_id,
    COALESCE(r.gross_revenue, 0) as gross_revenue,
    COALESCE(r.net_revenue, 0) as net_revenue,
    COALESCE(r.discounts, 0) as discounts,
    COALESCE(r.tax_collected, 0) as tax_collected,
    COALESCE(r.tips_collected, 0) as tips_collected,
    COALESCE(r.total_collected, 0) as total_collected,
    COALESCE(r.order_count, 0) as order_count,
    COALESCE(r.guest_count, 0) as guest_count,
    COALESCE(r.cogs, 0) as cogs,
    COALESCE(l.labor_cost, 0) as labor_cost,
    COALESCE(l.labor_hours, 0) as labor_hours
FROM daily_revenue r
FULL OUTER JOIN daily_labor l
    ON r.business_date = l.business_date AND r.location_id = l.location_id;

-- Indexes (same as current)
CREATE UNIQUE INDEX idx_mv_financial_pk ON pos_operational.mv_daily_financial_metrics (business_date, location_id);
CREATE INDEX idx_mv_financial_date ON pos_operational.mv_daily_financial_metrics (business_date DESC);
CREATE INDEX idx_mv_financial_location ON pos_operational.mv_daily_financial_metrics (location_id);
```

### WP6: Strip filters from semantic layer + services (110 instances)
**Files and exact changes:**

**`semantic_layer_service.py`** (~50 removals):
- Delete constants: `_NOT_SALES_CATEGORIES` (line 98), `_NOT_SALES_EXISTS_TEMPLATE` (lines 99-104)
- `_fetch_guest_metrics`: Replace 6-line item subquery with `o.net_revenue`. Remove all `CASE WHEN is_check = false` guards → plain `COUNT(*)`, `SUM(guest_count)`. Remove `is_overring`, `is_voided` WHERE clauses on orders.
- `_fetch_operations_metrics`: Same pattern — replace subquery, remove filters.
- `_fetch_server_metrics`: Same pattern.
- Revenue DOW breakdown: Same pattern.
- Server breakdown: Same pattern.
- Total: ~50 filter removals, 5 subquery replacements.

**`unified_metrics_service.py`** (~30 removals):
- Server performance `order_base` CTE: Replace item subquery with `o.net_revenue`. Remove `is_check`, `is_overring`, `is_voided` guards.
- Tip compliance: Same pattern.
- Void summary: Remove `is_overring` guards. Change `oi.is_voided = true` queries to use `order_item_voids` table.
- `all_orders` CTE: Plain `COUNT(*)` instead of `CASE WHEN is_check = false`.

**`analytics.py`** (~14 removals):
- Overhead revenue: Replace item subquery. Remove order filters.
- P&L monthly: Replace item subquery. Remove order filters.
- P&L COGS: Remove order filters.

**`menu_impact_service.py`** (~12 removals):
- Remove all `not_sales = false`, `is_voided = false`, `is_overring = false` from 4 query methods.

**`skill_data_service.py`** (1 change):
- Server void subquery: Change `oi.is_voided = true` to query `order_item_voids` table.

**`shift_performance_cluster.py`** (2 changes):
- Void count/amount subqueries: Change from `order_items WHERE is_voided = true` to `order_item_voids`.

**`occasion_segmentation.py`** (1 removal):
- Remove `is_modifier = false` filter (modifiers not in clean order_items).

**`upsell_analysis.py`** (3 removals):
- Remove `is_modifier = false` from 3 queries.

### WP7: Update summary_builder + import pipeline
**Files:**
- `backend/scripts/pos_import/fixers/summary_builder.py`
- `backend/scripts/pos_import/importers/stbi_importer.py`

**summary_builder.py:** Remove all `is_check`, `is_overring`, `not_sales`, `is_voided` filters from `rebuild_hourly_sales()`, `rebuild_daily_business_summary()`, `rebuild_interval_sales()`. Clean tables mean no filters needed.

**stbi_importer.py:** Add Phase 2 transform call in pipeline:
```python
async def run_pipeline(self, ...):
    # Phase 2: transform audit → operational
    transformer = BusinessTransform()
    await transformer.transform_window(conn, location_id, date_from, date_to)
    # Existing: rebuild summaries
    await self._rebuild_summaries(conn, location_id, date_from, date_to)
```

### WP8: Update cleanup/rollback tooling
**Files:**
- `scripts/cleanup_location.sh`
- `backend/app/temporal/merchant_provisioning.py` (purge_location_data_activity)
- `docs/migration/ROLLBACK-GUIDE.md`

**All three tools:** Add `pos_audit` tables to cleanup sequence. Insert BEFORE Phase 1 (order leaf tables) since audit tables have NO FK dependencies:
```sql
-- Phase 0: Audit tables (no FKs, safe to delete in any order)
DELETE FROM pos_audit.main_items WHERE location_id = :location_id;
DELETE FROM pos_audit.checks WHERE location_id = :location_id;
DELETE FROM pos_audit.payments WHERE location_id = :location_id;
DELETE FROM pos_audit.deleted_items WHERE location_id = :location_id;
DELETE FROM pos_audit.interval_sales_raw WHERE location_id = :location_id;
DELETE FROM pos_audit.daily_labor_detail WHERE location_id = :location_id;
-- ... etc for all audit tables
```

### WP9: Update verification scripts
**Files:**
- `backend/scripts/verify_financial_accuracy.py`
- `backend/scripts/validate_migration.py`
- `scripts/mssql_ground_truth.py`
- `backend/app/services/ground_truth_service.py`

**Two-layer validation:**
1. **Raw parity** (MSSQL ↔ pos_audit): `COUNT(*)` and `SUM()` must match 1:1 (minus known dedup — ChecksExtractor collision_count)
2. **Business parity** (pos_audit filtered ↔ pos_operational): row counts must match after applying Phase 2 filters
3. **SP parity** (tblRpt_SalesSummary ↔ pos_operational aggregates): penny-exact revenue

**verify_financial_accuracy.py:** Change target from `pos_operational` to `pos_audit` for raw parity. Add separate business parity check against `pos_operational` (no filters needed — clean tables).

**validate_migration.py:** Split Gate A into Gate A1 (raw parity) and Gate A2 (business parity). Gate B monetary: compare MSSQL filtered sums ↔ pos_operational sums (no RDS-side filters needed).

**ground_truth_service.py:** Update documentation strings. Filter formulas become "N/A — clean schema, no filters required."

### WP10: Column changes (Alembic migration)
**File:** `backend/alembic_analytics/versions/0024_clean_schema_columns.py`

```sql
-- Add net_revenue to orders (computed by Phase 2)
ALTER TABLE pos_operational.orders ADD COLUMN IF NOT EXISTS net_revenue NUMERIC(12,2);

-- Drop ledger-artifact columns from orders
ALTER TABLE pos_operational.orders DROP COLUMN IF EXISTS is_check;
ALTER TABLE pos_operational.orders DROP COLUMN IF EXISTS is_overring;

-- Drop ledger-artifact columns from order_items
ALTER TABLE pos_operational.order_items DROP COLUMN IF EXISTS not_sales;
ALTER TABLE pos_operational.order_items DROP COLUMN IF EXISTS is_overring;
ALTER TABLE pos_operational.order_items DROP COLUMN IF EXISTS is_modifier;
```

**Also update SQLAlchemy models:**
- `core_entity_models.py`: Remove `is_check`, `is_overring` from Order model. Add `net_revenue`. Remove `not_sales`, `is_overring`, `is_modifier` from OrderItem model.

### WP11: Re-import CASK + verify penny-exact
**Execution (not code changes):**
1. Run full re-import for CASK: Phase 1 → pos_audit, Phase 2 → pos_operational
2. Verify raw parity: pos_audit row counts match MSSQL
3. Verify business parity: pos_operational clean counts match expected (non-check, non-overring)
4. Verify SP parity: revenue matches tblRpt_SalesSummary penny-exact for Sep 2025 – Feb 2026
5. If clean: re-import remaining 15 locations
6. If not: debug Phase 2 transform, iterate

---

## Execution Order

```
WP1  (pos_audit schema) + WP10a (ADD orders.net_revenue column)
  ↓
WP2  (extractors → audit-routed + passthrough split)
  ↓
WP3  (Phase 2 transform + child re-inserts)
  ↓
WP4  (Temporal workflow wiring — ALL 4 workflows + worker registration)
  ↓
WP5  (simplified MV — add net_revenue column to orders first)
  ↓
WP7  (summary_builder + importer)
  ↓
WP8  (cleanup tooling)
  ↓
WP9  (verification scripts)
  ↓
WP11 (CASK re-import + verify penny-exact)
  ↓
WP6  (strip filters — AFTER data proven clean)
  ↓
WP10b (column DROPS — VERY LAST, after all code references removed in WP6)
```

**Critical ordering notes:**
- WP10 (column drops) MUST come AFTER WP6 (filter removal) — dropping `is_check`/`is_overring` while code still references them causes runtime crashes.
- WP5 needs `orders.net_revenue` column added first (separate migration from column drops).
- WP6 strips filters AFTER WP11 proves the clean data is penny-exact — if verification fails, old filters are still functional as fallback.
- Passthrough children (order_item_modifiers, surcharges) must stage AFTER Phase 2 in the pipeline — this is enforced in WP4's table routing.

---

## Risk Register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Phase 2 transform rules wrong → bad revenue | Critical | Verify penny-exact against SPs before stripping filters (WP11 before WP6) |
| Temporal workflow replay incompatibility | High | `workflow.patched("phase2-transform-v1")` on all 4 workflows |
| CASCADE delete performance on large locations | Medium | FK indexes already exist (verified in ROLLBACK-GUIDE) |
| order_item_voids FK to deleted items | High | Change order_item_id FK to NO ACTION + nullable (WP1). Void events reference orders via order_id. |
| order_item_voids ~8% unresolved CheckID | Low | Existing behavior — unchanged, nullable order_id |
| Column drops before code cleanup | Critical | WP10 execution order AFTER WP6 — enforced in plan |
| Audit table DDL vs extractor output mismatch | High | WP2 must update extractor map_record() to match audit DDL OR vice versa. Builder gets both schemas as context. |
| Orders with all items filtered out inflate count | Medium | MV keeps EXISTS(sale items) check |
| HRSalesExtractor InclAdj in gross_sales | Medium | Phase 2 hourly transform preserves existing InclAdj handling |
| OnDemand/FullReload workflows missed | Critical | All 4 workflows explicitly listed in WP4 |
| Passthrough children staged before Phase 2 | High | Pipeline ordering enforced: PASSTHROUGH_CHILD_TABLES stage after Phase 2 |

## Codex Review History
- **Round 1** (codex-008, codex-009): 10 Critical, 8 High, 4 Medium findings → all addressed in plan v2
- **Round 2** (codex-001, codex-002): 7 Critical, 8 High, 3 Medium findings → all addressed in plan v3
- **Round 3** (codex-003, codex-004): 3 Critical, 5 High, 2 Medium findings → all addressed in plan v4
- Key recurring themes (now resolved): order_item_voids FKs dropped (migration 0005), Temporal table routing (tblPos_EEFile not tblPos_Employees), till_transactions CASCADE child, revenue formula (total_price=net, full_price=gross), passthrough vs audit table consistency, net_revenue column ordering
- **Convergence status**: Architecture is stable. Remaining findings are implementation-level (extractor map_record contracts, Temporal replay branching). These resolve during building, not planning.
