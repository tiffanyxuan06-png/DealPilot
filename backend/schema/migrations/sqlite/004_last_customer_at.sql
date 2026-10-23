-- 004: When the customer last wrote, so the agent can tell who went quiet (services/intent.py)
ALTER TABLE client_memories ADD COLUMN last_customer_at TEXT NOT NULL DEFAULT '';
