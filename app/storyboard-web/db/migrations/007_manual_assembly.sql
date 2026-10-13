ALTER TABLE panel_visual_state
  ADD COLUMN IF NOT EXISTS panel_id text,
  ADD COLUMN IF NOT EXISTS assigned_asset_id uuid REFERENCES visual_asset (id),
  ADD COLUMN IF NOT EXISTS assignment_origin text;

ALTER TABLE panel_visual_state
  DROP CONSTRAINT IF EXISTS panel_assignment_origin_check;

ALTER TABLE panel_visual_state
  ADD CONSTRAINT panel_assignment_origin_check CHECK (
    assignment_origin IS NULL OR assignment_origin IN ('upload', 'reuse')
  );

ALTER TABLE panel_visual_state
  DROP CONSTRAINT IF EXISTS panel_assignment_pair_check;

ALTER TABLE panel_visual_state
  ADD CONSTRAINT panel_assignment_pair_check CHECK (
    (assigned_asset_id IS NULL AND assignment_origin IS NULL)
    OR (assigned_asset_id IS NOT NULL AND assignment_origin IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS panel_visual_state_panel_id_key
  ON panel_visual_state (storyboard_version_id, panel_id)
  WHERE panel_id IS NOT NULL;

ALTER TABLE visual_asset DROP CONSTRAINT IF EXISTS visual_asset_kind_check;

ALTER TABLE visual_asset
  ADD CONSTRAINT visual_asset_kind_check CHECK (
    kind IN (
      'identity-reference',
      'base-anchor',
      'performance-reference',
      'panel-image',
      'uploaded-image'
    )
  );
