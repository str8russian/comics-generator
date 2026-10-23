-- Derived transparent foregrounds for generated and uploaded panel images.
-- Original visual_asset bytes stay unchanged. Composites are not stored.

ALTER TABLE visual_asset DROP CONSTRAINT IF EXISTS visual_asset_kind_check;

ALTER TABLE visual_asset
  ADD CONSTRAINT visual_asset_kind_check CHECK (
    kind IN (
      'identity-reference',
      'base-anchor',
      'performance-reference',
      'panel-image',
      'uploaded-image',
      'panel-foreground'
    )
  );

CREATE TABLE panel_foreground_extraction (
  source_asset_id uuid PRIMARY KEY REFERENCES visual_asset (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES project (id),
  foreground_asset_id uuid REFERENCES visual_asset (id) ON DELETE CASCADE,
  extractor_version text NOT NULL,
  contract_version text,
  status text NOT NULL,
  findings jsonb NOT NULL,
  timing_ms numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT panel_foreground_status_check CHECK (
    status IN ('candidate-pass', 'review', 'reject', 'failed')
  ),
  CONSTRAINT panel_foreground_asset_check CHECK (
    (status = 'candidate-pass' AND foreground_asset_id IS NOT NULL)
    OR (status <> 'candidate-pass' AND foreground_asset_id IS NULL)
  )
);

CREATE INDEX panel_foreground_project_idx
  ON panel_foreground_extraction (project_id);
