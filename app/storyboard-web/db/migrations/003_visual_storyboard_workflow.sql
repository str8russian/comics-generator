-- End-to-end visual storyboard spike. Artifacts are append-only. Small head tables
-- point at the version currently shown in the workspace.

CREATE TABLE storyboard_version (
  id uuid PRIMARY KEY,
  storyboard_result_id uuid NOT NULL REFERENCES storyboard_result (id),
  parent_storyboard_version_id uuid REFERENCES storyboard_version (id),
  instruction text,
  frames jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE storyboard_head (
  storyboard_result_id uuid PRIMARY KEY REFERENCES storyboard_result (id),
  active_storyboard_version_id uuid NOT NULL REFERENCES storyboard_version (id)
);

CREATE TABLE visual_asset (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  mime text NOT NULL,
  width integer,
  height integer,
  byte_length integer NOT NULL,
  sha256 text NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visual_asset_kind_check CHECK (
    kind IN ('identity-reference', 'base-anchor', 'performance-reference', 'panel-image')
  ),
  CONSTRAINT visual_asset_mime_check CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  CONSTRAINT visual_asset_size_check CHECK (byte_length > 0 AND byte_length <= 12582912),
  CONSTRAINT visual_asset_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE character_identity (
  material_state_id uuid NOT NULL REFERENCES material_state (id),
  character_name text NOT NULL,
  current_asset_id uuid NOT NULL REFERENCES visual_asset (id),
  comment text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (material_state_id, character_name)
);

CREATE TABLE character_anchor_version (
  id uuid PRIMARY KEY,
  material_state_id uuid NOT NULL REFERENCES material_state (id),
  character_name text NOT NULL,
  parent_anchor_version_id uuid REFERENCES character_anchor_version (id),
  identity_asset_id uuid NOT NULL REFERENCES visual_asset (id),
  output_asset_id uuid REFERENCES visual_asset (id),
  instruction text NOT NULL DEFAULT '',
  status text NOT NULL,
  error_kind text,
  provider_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CONSTRAINT character_anchor_status_check CHECK (status IN ('pending', 'ready', 'failed', 'approved'))
);

CREATE INDEX character_anchor_lookup
  ON character_anchor_version (material_state_id, character_name, created_at DESC);

CREATE TABLE panel_visual_state (
  id uuid PRIMARY KEY,
  storyboard_version_id uuid NOT NULL REFERENCES storyboard_version (id),
  frame_id text NOT NULL,
  panel_index integer NOT NULL,
  subject text,
  performance_asset_id uuid REFERENCES visual_asset (id),
  current_generation_id uuid,
  zoom numeric(6,3) NOT NULL DEFAULT 1,
  position_x numeric(6,3) NOT NULL DEFAULT 50,
  position_y numeric(6,3) NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storyboard_version_id, frame_id, panel_index),
  CONSTRAINT panel_index_check CHECK (panel_index >= 0),
  CONSTRAINT panel_zoom_check CHECK (zoom >= 1 AND zoom <= 3),
  CONSTRAINT panel_position_x_check CHECK (position_x >= 0 AND position_x <= 100),
  CONSTRAINT panel_position_y_check CHECK (position_y >= 0 AND position_y <= 100)
);

CREATE TABLE panel_generation (
  id uuid PRIMARY KEY,
  panel_visual_state_id uuid NOT NULL REFERENCES panel_visual_state (id),
  parent_generation_id uuid REFERENCES panel_generation (id),
  anchor_version_id uuid REFERENCES character_anchor_version (id),
  performance_asset_id uuid REFERENCES visual_asset (id),
  output_asset_id uuid REFERENCES visual_asset (id),
  resolved_description text NOT NULL,
  instruction text NOT NULL DEFAULT '',
  status text NOT NULL,
  error_kind text,
  provider_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT panel_generation_status_check CHECK (status IN ('pending', 'ready', 'failed'))
);

ALTER TABLE panel_visual_state
  ADD CONSTRAINT panel_visual_current_generation_fk
  FOREIGN KEY (current_generation_id) REFERENCES panel_generation (id);

CREATE INDEX panel_generation_lookup
  ON panel_generation (panel_visual_state_id, created_at DESC);

CREATE TABLE visual_approval (
  id uuid PRIMARY KEY,
  storyboard_version_id uuid NOT NULL REFERENCES storyboard_version (id),
  snapshot jsonb NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX visual_approval_lookup
  ON visual_approval (storyboard_version_id, approved_at DESC);
