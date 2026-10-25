-- Anchor identity for the two production anchor routes.
-- Panel and frame rows leave the new columns null.
-- A fresh database applies 018, then 019, then this file.
-- An already-migrated database applies only this file.

ALTER TABLE image_generation_attempt
  ADD COLUMN character_name text,
  ADD COLUMN material_state_id uuid,
  ADD COLUMN anchor_version_id uuid,
  ADD COLUMN basis_kind text;

ALTER TABLE image_generation_attempt
  DROP CONSTRAINT image_generation_attempt_kind_check;

ALTER TABLE image_generation_attempt
  ADD CONSTRAINT image_generation_attempt_kind_check CHECK (
    generation_kind IN ('panel', 'frame-panel', 'anchor-session', 'anchor')
  );

ALTER TABLE image_generation_attempt
  DROP CONSTRAINT image_generation_attempt_action_check;

ALTER TABLE image_generation_attempt
  ADD CONSTRAINT image_generation_attempt_action_check CHECK (
    action_kind IN ('panel', 'frame-panel', 'anchor-session', 'anchor')
  );

ALTER TABLE image_generation_attempt
  ADD CONSTRAINT image_generation_attempt_basis_check CHECK (
    basis_kind IS NULL OR basis_kind IN ('from-source', 'selected', 'accepted', 'persisted')
  );

ALTER TABLE image_generation_attempt
  ADD CONSTRAINT image_generation_attempt_anchor_identity_check CHECK (
    (
      generation_kind IN ('panel', 'frame-panel')
      AND character_name IS NULL
      AND material_state_id IS NULL
      AND anchor_version_id IS NULL
      AND basis_kind IS NULL
    )
    OR (
      generation_kind = 'anchor-session'
      AND action_kind = 'anchor-session'
      AND character_name IS NOT NULL
      AND anchor_version_id IS NULL
      AND basis_kind IN ('from-source', 'selected', 'accepted')
      AND panel_generation_id IS NULL
      AND storyboard_version_id IS NULL
      AND frame_id IS NULL
      AND panel_id IS NULL
      AND panel_index IS NULL
    )
    OR (
      generation_kind = 'anchor'
      AND action_kind = 'anchor'
      AND character_name IS NOT NULL
      AND material_state_id IS NOT NULL
      AND anchor_version_id IS NOT NULL
      AND basis_kind = 'persisted'
      AND panel_generation_id IS NULL
      AND storyboard_version_id IS NULL
      AND frame_id IS NULL
      AND panel_id IS NULL
      AND panel_index IS NULL
    )
  );

CREATE INDEX image_generation_attempt_anchor_version_idx
  ON image_generation_attempt (anchor_version_id);

COMMENT ON COLUMN image_generation_attempt.character_name IS
  'Server route character for an anchor attempt. NULL for panel and frame attempts.';

COMMENT ON COLUMN image_generation_attempt.material_state_id IS
  'Active or pending material state when the server already has one. NULL when a session attempt has none.';

COMMENT ON COLUMN image_generation_attempt.anchor_version_id IS
  'Pending character_anchor_version id for a persisted /anchor attempt. NULL for anchor-session attempts.';

COMMENT ON COLUMN image_generation_attempt.basis_kind IS
  'from-source, selected, accepted, or persisted. NULL for panel and frame attempts.';
