-- 005: The rep who looks after a customer before their first deal (services/customers.py, customers_payload).
-- Once a customer has a deal, the rep on their newest deal wins; this only fills the gap so Staff see new customers.
ALTER TABLE customers ADD COLUMN rep_id INTEGER REFERENCES reps(id);
-- Customers added before this had no rep, so Staff could not see them: give them the default rep, the same one
-- new customers and deals get (services/pipeline.py, staff_rep_id: the first active rep).
UPDATE customers SET rep_id = (SELECT id FROM reps WHERE active = 1 ORDER BY id LIMIT 1) WHERE rep_id IS NULL;
