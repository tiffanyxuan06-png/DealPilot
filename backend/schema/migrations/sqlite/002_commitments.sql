-- 002: Commitments and customer promises for the WhatsApp Sales Sidekick

CREATE TABLE commitments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL DEFAULT '',
    customer TEXT NOT NULL DEFAULT '',
    promise_text TEXT NOT NULL,
    due_date TEXT DEFAULT NULL,
    party TEXT NOT NULL DEFAULT 'customer' CHECK (party IN ('customer', 'seller')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'dismissed')),
    created_at TEXT NOT NULL
);

CREATE INDEX idx_commitments_phone ON commitments(phone);
CREATE INDEX idx_commitments_status ON commitments(status);
