-- Singleton project, insert-only artifacts, and one empty working draft.

CREATE TABLE project (
  id uuid PRIMARY KEY,
  singleton boolean NOT NULL,
  active_source_revision_id uuid,
  active_material_state_id uuid,
  current_reading_id uuid,
  CONSTRAINT project_singleton_is_true CHECK (singleton),
  CONSTRAINT project_singleton_key UNIQUE (singleton)
);

CREATE TABLE working_draft (
  project_id uuid PRIMARY KEY REFERENCES project (id),
  text text NOT NULL,
  revision_token uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_revision (
  id uuid PRIMARY KEY,
  parent_source_revision_id uuid REFERENCES source_revision (id),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reading (
  id uuid PRIMARY KEY,
  draft_text text NOT NULL,
  draft_revision_token uuid NOT NULL,
  status text NOT NULL,
  failure_kind text,
  blocked_codes text[],
  CONSTRAINT reading_status_check CHECK (status IN ('pending', 'ready', 'blocked', 'failed', 'stale'))
);

CREATE TABLE interpretation (
  id uuid PRIMARY KEY,
  source_revision_id uuid NOT NULL UNIQUE REFERENCES source_revision (id),
  reading_id uuid NOT NULL REFERENCES reading (id)
);

CREATE TABLE source_item (
  interpretation_id uuid NOT NULL REFERENCES interpretation (id),
  ordinal integer NOT NULL,
  model_id text NOT NULL,
  kind text NOT NULL,
  speaker_status text NOT NULL,
  speaker_label text,
  draft_start integer NOT NULL,
  draft_end integer NOT NULL,
  source_quote text NOT NULL,
  spoken_text text NOT NULL,
  PRIMARY KEY (interpretation_id, model_id),
  UNIQUE (interpretation_id, ordinal),
  CONSTRAINT source_item_kind_check CHECK (kind IN ('utterance', 'action', 'context', 'note')),
  CONSTRAINT source_item_speaker_status_check CHECK (
    (kind = 'utterance' AND speaker_status IN ('explicit', 'inferred', 'unresolved'))
    OR (kind <> 'utterance' AND speaker_status = 'none')
  ),
  CONSTRAINT source_item_speaker_label_check CHECK (
    (speaker_status IN ('explicit', 'inferred') AND speaker_label IS NOT NULL)
    OR (speaker_status NOT IN ('explicit', 'inferred') AND speaker_label IS NULL)
  ),
  CONSTRAINT source_item_offsets_check CHECK (draft_start >= 0 AND draft_end >= draft_start)
);

CREATE TABLE provisional_character (
  interpretation_id uuid NOT NULL REFERENCES interpretation (id),
  model_id text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (interpretation_id, model_id)
);

CREATE TABLE surface_form (
  interpretation_id uuid NOT NULL REFERENCES interpretation (id),
  model_id text NOT NULL,
  quote text NOT NULL,
  role text NOT NULL,
  proposed_character_model_id text,
  PRIMARY KEY (interpretation_id, model_id),
  CONSTRAINT surface_form_role_check CHECK (role IN ('speaker-label', 'address', 'mention'))
);

CREATE TABLE material_state (
  id uuid PRIMARY KEY,
  source_revision_id uuid NOT NULL REFERENCES source_revision (id),
  interpretation_id uuid NOT NULL REFERENCES interpretation (id),
  parent_material_state_id uuid REFERENCES material_state (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE canonical_character (
  id uuid PRIMARY KEY,
  material_state_id uuid NOT NULL REFERENCES material_state (id),
  ordinal integer NOT NULL,
  name text NOT NULL,
  UNIQUE (material_state_id, ordinal)
);

CREATE TABLE alias (
  id uuid PRIMARY KEY,
  material_state_id uuid NOT NULL REFERENCES material_state (id),
  surface_text text NOT NULL,
  character_id uuid NOT NULL REFERENCES canonical_character (id)
);

CREATE TABLE speaker_assignment (
  material_state_id uuid NOT NULL REFERENCES material_state (id),
  source_item_model_id text NOT NULL,
  character_id uuid NOT NULL REFERENCES canonical_character (id),
  PRIMARY KEY (material_state_id, source_item_model_id)
);

CREATE TABLE pending_character (
  id uuid PRIMARY KEY,
  reading_id uuid NOT NULL REFERENCES reading (id),
  ordinal integer NOT NULL,
  name text NOT NULL,
  UNIQUE (reading_id, ordinal)
);

CREATE TABLE pending_alias (
  id uuid PRIMARY KEY,
  reading_id uuid NOT NULL REFERENCES reading (id),
  surface_text text NOT NULL,
  character_id uuid NOT NULL REFERENCES pending_character (id)
);

CREATE TABLE pending_speaker (
  reading_id uuid NOT NULL REFERENCES reading (id),
  source_item_model_id text NOT NULL,
  character_id uuid NOT NULL REFERENCES pending_character (id),
  PRIMARY KEY (reading_id, source_item_model_id)
);

CREATE TABLE storyboard_result (
  id uuid PRIMARY KEY,
  material_state_id uuid NOT NULL REFERENCES material_state (id),
  status text NOT NULL,
  failures jsonb,
  stage_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storyboard_result_status_check CHECK (status IN ('checked', 'blocked', 'failed'))
);

ALTER TABLE project
  ADD CONSTRAINT project_active_source_revision_fk
  FOREIGN KEY (active_source_revision_id) REFERENCES source_revision (id);

ALTER TABLE project
  ADD CONSTRAINT project_active_material_state_fk
  FOREIGN KEY (active_material_state_id) REFERENCES material_state (id);

ALTER TABLE project
  ADD CONSTRAINT project_current_reading_fk
  FOREIGN KEY (current_reading_id) REFERENCES reading (id);

INSERT INTO project (id, singleton)
VALUES ('00000000-0000-4000-8000-000000000001', true);

INSERT INTO working_draft (project_id, text, revision_token)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '',
  '00000000-0000-4000-8000-000000000002'
);
