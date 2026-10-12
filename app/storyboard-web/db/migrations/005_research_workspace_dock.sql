-- Append-only owner-research evidence. No foreign keys into product tables.
-- No research_error column. No universal submitted_text length CHECK.

CREATE TABLE research_event (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_kind text NOT NULL,
  semantic_action text NOT NULL,
  correlation_id uuid,
  surface text NOT NULL,
  submitted_text text,
  command_target jsonb,
  edit_target jsonb,
  context jsonb NOT NULL,
  outcome text,
  outcome_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome_kind text,
  duration_ms integer,
  CONSTRAINT research_event_kind_check CHECK (
    event_kind IN ('note', 'action_start', 'action_terminal')
  ),
  CONSTRAINT research_event_semantic_action_check CHECK (
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
      'frame_generate',
      'panel_generate',
      'placement_commit',
      'visual_approve'
    )
  ),
  CONSTRAINT research_event_surface_check CHECK (
    surface IN ('dock_notes', 'dock_commands', 'product_control')
  ),
  CONSTRAINT research_event_correlation_check CHECK (
    (event_kind = 'note' AND correlation_id IS NULL)
    OR (event_kind <> 'note' AND correlation_id IS NOT NULL)
  ),
  CONSTRAINT research_event_outcome_check CHECK (
    (event_kind = 'action_terminal' AND outcome IS NOT NULL)
    OR (event_kind <> 'action_terminal' AND outcome IS NULL)
  ),
  CONSTRAINT research_event_outcome_values_check CHECK (
    outcome IS NULL OR outcome IN ('success', 'failure', 'blocked')
  ),
  CONSTRAINT research_event_edit_target_check CHECK (
    (semantic_action = 'cast_edit' AND edit_target IS NOT NULL)
    OR (semantic_action <> 'cast_edit' AND edit_target IS NULL)
  )
);

CREATE UNIQUE INDEX research_event_one_start_per_correlation
  ON research_event (correlation_id)
  WHERE event_kind = 'action_start';

CREATE UNIQUE INDEX research_event_one_terminal_per_correlation
  ON research_event (correlation_id)
  WHERE event_kind = 'action_terminal';

CREATE INDEX research_event_kind_seq
  ON research_event (event_kind, seq);

CREATE INDEX research_event_surface_seq
  ON research_event (surface, seq);
