-- One open draft for a single panel. Candidates point at panel_generation
-- and do not copy prompts, trace rows, or image bytes.

CREATE TABLE panel_revision_session (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES project (id),
  panel_id text NOT NULL,
  storyboard_version_id uuid NOT NULL,
  baseline_asset_id uuid,
  baseline_generation_id uuid,
  baseline_performance_asset_id uuid,
  compiler_id text NOT NULL,
  compiler_version text NOT NULL,
  draft_mode text NOT NULL DEFAULT 'refine',
  draft_instruction text NOT NULL DEFAULT '',
  status text NOT NULL,
  selected_candidate_id uuid,
  accepted_candidate_id uuid,
  accepted_storyboard_version_id uuid,
  review_outcome text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT panel_revision_session_status_check CHECK (status IN ('open', 'accepted', 'cancelled')),
  CONSTRAINT panel_revision_session_mode_check CHECK (draft_mode IN ('refine', 'new-variation')),
  CONSTRAINT panel_revision_session_outcome_check CHECK (
    review_outcome IS NULL OR review_outcome IN ('accepted', 'cancelled')
  ),
  CONSTRAINT panel_revision_session_panel_check CHECK (length(panel_id) > 0)
);

CREATE UNIQUE INDEX panel_revision_session_one_open
  ON panel_revision_session (project_id, panel_id)
  WHERE status = 'open';

CREATE TABLE panel_revision_candidate (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES panel_revision_session (id),
  ordinal integer NOT NULL,
  mode text NOT NULL,
  visual_basis_kind text NOT NULL,
  visual_basis_asset_id uuid,
  visual_basis_ordinal integer,
  effective_intent jsonb NOT NULL,
  panel_generation_id uuid NOT NULL REFERENCES panel_generation (id),
  performance_asset_id uuid,
  reference_identity jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (session_id, ordinal),
  CONSTRAINT panel_revision_candidate_mode_check CHECK (mode IN ('refine', 'new-variation')),
  CONSTRAINT panel_revision_candidate_basis_check CHECK (
    visual_basis_kind IN ('current-panel', 'candidate', 'none')
  ),
  CONSTRAINT panel_revision_candidate_ordinal_check CHECK (ordinal > 0)
);

ALTER TABLE panel_revision_session
  ADD CONSTRAINT panel_revision_session_selected_fk
  FOREIGN KEY (selected_candidate_id) REFERENCES panel_revision_candidate (id);

ALTER TABLE panel_revision_session
  ADD CONSTRAINT panel_revision_session_accepted_fk
  FOREIGN KEY (accepted_candidate_id) REFERENCES panel_revision_candidate (id);

ALTER TABLE research_event
  DROP CONSTRAINT IF EXISTS research_event_semantic_action_check;

ALTER TABLE research_event
  ADD CONSTRAINT research_event_semantic_action_check CHECK (
    semantic_action IN (
      'note',
      'reading',
      'confirm_material',
      'stage_storyboard',
      'cast_edit',
      'structure_edit',
      'structure_undo',
      'identity_save',
      'anchor_generate',
      'anchor_approve',
      'anchor_retire',
      'anchor_restore',
      'frame_generate',
      'panel_generate',
      'panel_revision_open',
      'placement_commit',
      'visual_approve',
      'frame_insert',
      'frame_delete',
      'frame_reorder',
      'frame_duplicate',
      'panel_add',
      'panel_delete',
      'panel_reorder',
      'frame_duration',
      'text_card',
      'panel_subject',
      'asset_assign',
      'storyboard_undo',
      'render',
      'source_utterance_edit',
      'frame_dialogue'
    )
  );
