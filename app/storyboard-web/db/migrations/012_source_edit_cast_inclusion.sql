-- Explicit cast inclusion. Existing rows stay included. extracted_name defaults
-- empty and is read as the canonical name until a cast write records the
-- Interpret-proposed surface.

ALTER TABLE canonical_character
  ADD COLUMN included boolean NOT NULL DEFAULT true,
  ADD COLUMN extracted_name text NOT NULL DEFAULT '';

ALTER TABLE pending_character
  ADD COLUMN included boolean NOT NULL DEFAULT true,
  ADD COLUMN extracted_name text NOT NULL DEFAULT '';

UPDATE canonical_character
SET extracted_name = name
WHERE extracted_name = '';

UPDATE pending_character
SET extracted_name = name
WHERE extracted_name = '';

CREATE TABLE character_exclusion (
  project_id uuid NOT NULL REFERENCES project (id),
  extracted_name text NOT NULL,
  PRIMARY KEY (project_id, extracted_name)
);
