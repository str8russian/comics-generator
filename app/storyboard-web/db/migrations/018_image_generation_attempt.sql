-- One attempt row for a production image-provider call that reached external I/O.
-- This is not a generic event log and it does not replace panel_generation.

CREATE TABLE image_generation_attempt (
  id uuid PRIMARY KEY,
  diagnostic_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES project (id),
  generation_kind text NOT NULL,
  action_kind text NOT NULL,
  panel_generation_id uuid,
  storyboard_version_id uuid,
  frame_id text,
  panel_id text,
  panel_index integer,
  correlation_id uuid,
  compiler_id text NOT NULL,
  compiler_version text NOT NULL,
  build_id text NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  state text NOT NULL,
  prompt text NOT NULL,
  prompt_sha256 text NOT NULL,
  model text NOT NULL,
  aspect_ratio text NOT NULL,
  reference_strategy text NOT NULL,
  budget_bytes integer NOT NULL,
  original_body_bytes integer NOT NULL,
  final_body_bytes integer NOT NULL,
  request_sha256 text NOT NULL,
  sent_references jsonb NOT NULL,
  omissions jsonb NOT NULL,
  provider_io_started boolean NOT NULL DEFAULT false,
  timeout_ms integer,
  latency_ms integer,
  http_status integer,
  outcome_kind text,
  usage jsonb,
  output_sha256 text,
  output_mime text,
  output_byte_length integer,
  output_width integer,
  output_height integer,
  CONSTRAINT image_generation_attempt_kind_check CHECK (
    generation_kind IN ('panel', 'frame-panel')
  ),
  CONSTRAINT image_generation_attempt_action_check CHECK (
    action_kind IN ('panel', 'frame-panel')
  ),
  CONSTRAINT image_generation_attempt_state_check CHECK (
    state IN ('prepared', 'succeeded', 'failed')
  ),
  CONSTRAINT image_generation_attempt_panel_index_check CHECK (
    panel_index IS NULL OR panel_index >= 0
  ),
  CONSTRAINT image_generation_attempt_budget_check CHECK (budget_bytes > 0),
  CONSTRAINT image_generation_attempt_prompt_sha_check CHECK (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT image_generation_attempt_request_sha_check CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT image_generation_attempt_output_sha_check CHECK (
    output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT image_generation_attempt_references_check CHECK (
    jsonb_typeof(sent_references) = 'array'
  ),
  CONSTRAINT image_generation_attempt_omissions_check CHECK (
    jsonb_typeof(omissions) = 'array'
  )
);

CREATE INDEX image_generation_attempt_panel_generation_idx
  ON image_generation_attempt (panel_generation_id);

CREATE INDEX image_generation_attempt_correlation_idx
  ON image_generation_attempt (correlation_id);
