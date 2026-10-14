ALTER TABLE panel_visual_state
  ADD COLUMN IF NOT EXISTS current_asset_id uuid REFERENCES visual_asset (id),
  ADD COLUMN IF NOT EXISTS current_asset_origin text;

ALTER TABLE panel_visual_state
  DROP CONSTRAINT IF EXISTS panel_current_asset_origin_check;

ALTER TABLE panel_visual_state
  ADD CONSTRAINT panel_current_asset_origin_check CHECK (
    current_asset_origin IS NULL OR current_asset_origin IN ('upload', 'reuse', 'generation')
  );

ALTER TABLE panel_visual_state
  DROP CONSTRAINT IF EXISTS panel_current_asset_pair_check;

ALTER TABLE panel_visual_state
  ADD CONSTRAINT panel_current_asset_pair_check CHECK (
    (current_asset_id IS NULL AND current_asset_origin IS NULL)
    OR (current_asset_id IS NOT NULL AND current_asset_origin IS NOT NULL)
  );

UPDATE panel_visual_state
SET current_asset_id = assigned_asset_id,
    current_asset_origin = assignment_origin
WHERE current_asset_id IS NULL
  AND assigned_asset_id IS NOT NULL;

UPDATE panel_visual_state AS panel_state
SET current_asset_id = panel_generation.output_asset_id,
    current_asset_origin = 'generation'
FROM panel_generation
WHERE panel_state.current_asset_id IS NULL
  AND panel_state.current_generation_id = panel_generation.id
  AND panel_generation.status = 'ready'
  AND panel_generation.output_asset_id IS NOT NULL;
