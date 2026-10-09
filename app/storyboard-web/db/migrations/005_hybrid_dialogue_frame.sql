-- Hybrid dialogue frame foundations: scene background, character states,
-- frame operations, finalize-once generation provenance.
-- Additive only. Historical panel_generation rows remain untouched.

ALTER TABLE visual_asset
  DROP CONSTRAINT visual_asset_kind_check;

ALTER TABLE visual_asset
  ADD CONSTRAINT visual_asset_kind_check CHECK (
    kind IN (
      'identity-reference',
      'base-anchor',
      'performance-reference',
      'panel-image',
      'scene-background',
      'character-state-raw',
      'character-state'
    )
  );

ALTER TABLE panel_visual_state
  ADD COLUMN current_character_generation_id uuid,
  ADD COLUMN fit_mode text NOT NULL DEFAULT 'manual';

ALTER TABLE panel_visual_state
  ADD CONSTRAINT panel_visual_fit_mode_check CHECK (fit_mode IN ('manual', 'fit'));

CREATE TABLE visual_frame_operation (
  id uuid PRIMARY KEY,
  storyboard_result_id uuid NOT NULL REFERENCES storyboard_result (id),
  storyboard_version_id uuid NOT NULL REFERENCES storyboard_version (id),
  frame_id text NOT NULL,
  scope text NOT NULL,
  panel_index integer,
  write_version integer NOT NULL,
  phase text NOT NULL,
  status text NOT NULL,
  error_kind text,
  component_failures_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT visual_frame_operation_scope_check CHECK (scope IN ('frame', 'panel')),
  CONSTRAINT visual_frame_operation_panel_index_check CHECK (
    (scope = 'frame' AND panel_index IS NULL)
    OR (scope = 'panel' AND panel_index IS NOT NULL AND panel_index >= 0)
  ),
  CONSTRAINT visual_frame_operation_write_version_check CHECK (write_version >= 1),
  CONSTRAINT visual_frame_operation_phase_check CHECK (
    phase IN (
      'queued',
      'preparing-background',
      'generating-background',
      'generating-character-states',
      'assembling',
      'complete',
      'failed'
    )
  ),
  CONSTRAINT visual_frame_operation_status_check CHECK (status IN ('running', 'complete', 'failed'))
);

CREATE INDEX visual_frame_operation_lookup
  ON visual_frame_operation (storyboard_version_id, frame_id, created_at DESC);

CREATE TABLE generation_record (
  id uuid PRIMARY KEY,
  operation_type text NOT NULL,
  storyboard_result_id uuid NOT NULL REFERENCES storyboard_result (id),
  storyboard_version_id uuid NOT NULL REFERENCES storyboard_version (id),
  frame_id text,
  panel_index integer,
  scene_key text,
  component_generation_id uuid,
  operation_id uuid REFERENCES visual_frame_operation (id),
  visual_intent_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  compiled_prompt text NOT NULL,
  prompt_compiler_version text NOT NULL,
  model text,
  generation_settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reference_manifest_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  omitted_references_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  app_git_commit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  error_kind text,
  provider_status text,
  latency_ms integer,
  output_asset_id uuid REFERENCES visual_asset (id),
  output_sha256 text,
  output_mime text,
  output_width integer,
  output_height integer,
  output_byte_length integer,
  finished_at timestamptz,
  CONSTRAINT generation_record_operation_type_check CHECK (
    operation_type IN ('scene-background', 'character-state')
  ),
  CONSTRAINT generation_record_status_check CHECK (status IN ('pending', 'ready', 'failed')),
  CONSTRAINT generation_record_output_sha_check CHECK (
    output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'
  )
);

CREATE INDEX generation_record_lookup
  ON generation_record (storyboard_version_id, frame_id, created_at DESC);

CREATE TABLE scene_background_state (
  id uuid PRIMARY KEY,
  storyboard_version_id uuid NOT NULL REFERENCES storyboard_version (id),
  scene_key text NOT NULL,
  current_generation_id uuid,
  active_operation_id uuid,
  write_version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storyboard_version_id, scene_key),
  CONSTRAINT scene_background_scene_key_check CHECK (scene_key = 'primary'),
  CONSTRAINT scene_background_write_version_check CHECK (write_version >= 0)
);

CREATE TABLE scene_background_generation (
  id uuid PRIMARY KEY,
  scene_background_state_id uuid NOT NULL REFERENCES scene_background_state (id),
  parent_generation_id uuid REFERENCES scene_background_generation (id),
  status text NOT NULL,
  error_kind text,
  output_asset_id uuid REFERENCES visual_asset (id),
  style_asset_id uuid NOT NULL REFERENCES visual_asset (id),
  captured_scene_write_version integer NOT NULL,
  generation_record_id uuid REFERENCES generation_record (id),
  operation_id uuid REFERENCES visual_frame_operation (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT scene_background_generation_status_check CHECK (
    status IN ('pending', 'ready', 'failed')
  ),
  CONSTRAINT scene_background_generation_write_version_check CHECK (
    captured_scene_write_version >= 1
  )
);

CREATE INDEX scene_background_generation_lookup
  ON scene_background_generation (scene_background_state_id, created_at DESC);

CREATE TABLE frame_hybrid_state (
  storyboard_version_id uuid NOT NULL REFERENCES storyboard_version (id),
  frame_id text NOT NULL,
  scene_key text NOT NULL DEFAULT 'primary',
  composition_mode text NOT NULL,
  active_operation_id uuid REFERENCES visual_frame_operation (id),
  assembly_status text NOT NULL DEFAULT 'not-ready',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (storyboard_version_id, frame_id),
  CONSTRAINT frame_hybrid_scene_key_check CHECK (scene_key = 'primary'),
  CONSTRAINT frame_hybrid_composition_mode_check CHECK (
    composition_mode IN ('near-frontal-pair', 'inward-conversation', 'asymmetric-pair')
  ),
  CONSTRAINT frame_hybrid_assembly_status_check CHECK (
    assembly_status IN ('not-ready', 'ready', 'invalid')
  )
);

CREATE TABLE character_visual_state_generation (
  id uuid PRIMARY KEY,
  panel_visual_state_id uuid NOT NULL REFERENCES panel_visual_state (id),
  parent_generation_id uuid REFERENCES character_visual_state_generation (id),
  anchor_version_id uuid NOT NULL REFERENCES character_anchor_version (id),
  style_asset_id uuid NOT NULL REFERENCES visual_asset (id),
  raw_asset_id uuid REFERENCES visual_asset (id),
  output_asset_id uuid REFERENCES visual_asset (id),
  status text NOT NULL,
  error_kind text,
  generation_record_id uuid REFERENCES generation_record (id),
  operation_id uuid REFERENCES visual_frame_operation (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT character_visual_state_generation_status_check CHECK (
    status IN ('pending', 'ready', 'failed')
  )
);

CREATE INDEX character_visual_state_generation_lookup
  ON character_visual_state_generation (panel_visual_state_id, created_at DESC);

ALTER TABLE scene_background_state
  ADD CONSTRAINT scene_background_current_generation_fk
  FOREIGN KEY (current_generation_id) REFERENCES scene_background_generation (id);

ALTER TABLE scene_background_state
  ADD CONSTRAINT scene_background_active_operation_fk
  FOREIGN KEY (active_operation_id) REFERENCES visual_frame_operation (id);

ALTER TABLE panel_visual_state
  ADD CONSTRAINT panel_visual_current_character_generation_fk
  FOREIGN KEY (current_character_generation_id) REFERENCES character_visual_state_generation (id);
