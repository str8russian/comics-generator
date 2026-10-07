-- Interpret document for the current reading, written once when the reading leaves pending.

ALTER TABLE reading ADD COLUMN snapshot jsonb;
