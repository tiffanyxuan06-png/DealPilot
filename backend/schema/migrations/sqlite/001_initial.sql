-- 001: the sales-agent schema (price list, reps, deals) plus settings, activity log,
-- customer memory, customers, staff permissions and the owner approval queue.
-- Never edit this file after it is pushed: add 002_….sql instead (docs/12_Data_Layer_Refactor_Plan.md).

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Price list. unit_cost is only used for the margin guard and is never sent to Staff.
CREATE TABLE products (
    sku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sell_price INTEGER NOT NULL,
    unit_cost INTEGER NOT NULL
);

CREATE TABLE reps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    commission_pct REAL NOT NULL DEFAULT 3.0,
    active INTEGER NOT NULL DEFAULT 1
);

-- Money is whole RM. Times are 'YYYY-MM-DD HH:MM:SS' text, so they compare correctly as text.
CREATE TABLE deals (
    id TEXT PRIMARY KEY,
    order_no TEXT DEFAULT NULL,
    customer TEXT NOT NULL,
    phone TEXT DEFAULT '',
    rep_id INTEGER REFERENCES reps(id),
    stage TEXT NOT NULL CHECK (stage IN ('INQUIRY', 'QUOTED', 'FOLLOW_UP', 'WON', 'LOST')),
    items_json TEXT NOT NULL DEFAULT '[]',
    discount INTEGER NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    follow_up_at TEXT DEFAULT NULL,
    follow_up_count INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0,
    loss_reason TEXT DEFAULT '',
    deposit_ref TEXT DEFAULT '',
    deposit_amount INTEGER DEFAULT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    won_at TEXT DEFAULT NULL
);

CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Mandatory rule: the activity log is append-only (a reset drops and recreates the whole table).
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

CREATE TABLE client_memories (
    customer TEXT PRIMARY KEY,
    phone TEXT DEFAULT '',
    tier TEXT NOT NULL DEFAULT 'NEW_CLIENT',
    score INTEGER NOT NULL DEFAULT 50,
    style_summary TEXT NOT NULL DEFAULT 'Direct SME buyer · Prefers fast quotes',
    payment_behavior TEXT NOT NULL DEFAULT 'No past deals yet',
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_paid_rm INTEGER NOT NULL DEFAULT 0,
    last_message TEXT DEFAULT '',
    recent_history_json TEXT DEFAULT '[]',
    cached_analysis_json TEXT DEFAULT '',
    updated_at TEXT NOT NULL
);

-- LHDN e-Invoice details go to the accountant in the won-orders CSV.
CREATE TABLE customers (
    name TEXT PRIMARY KEY,
    phone TEXT DEFAULT '',
    tin TEXT DEFAULT '',
    ssm_brn TEXT DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE role_permissions (
    action_key TEXT PRIMARY KEY,
    staff_mode TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
);

CREATE TABLE approval_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    reason TEXT NOT NULL,
    handler TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    decided_by TEXT DEFAULT NULL,
    decision_note TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    decided_at TEXT DEFAULT NULL
);
