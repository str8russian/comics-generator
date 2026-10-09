-- Persist one project-level style authority per material state.
-- The first approved base anchor becomes the seed and must not rotate silently.

CREATE TABLE project_style_seed (
  material_state_id uuid PRIMARY KEY REFERENCES material_state (id),
  style_asset_id uuid NOT NULL REFERENCES visual_asset (id),
  source_anchor_version_id uuid NOT NULL REFERENCES character_anchor_version (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE character_anchor_version
  ADD COLUMN style_asset_id uuid REFERENCES visual_asset (id);
