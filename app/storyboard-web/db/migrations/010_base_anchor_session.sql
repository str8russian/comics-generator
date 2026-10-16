-- Accepted base-anchor session: an approved anchor may have no real-photo identity,
-- deletion retires current use without destroying assets, and research can name
-- retire/restore separately from approval.

ALTER TABLE character_anchor_version
  ALTER COLUMN identity_asset_id DROP NOT NULL;

ALTER TABLE character_anchor_version
  ADD COLUMN IF NOT EXISTS provenance text;

ALTER TABLE character_anchor_version
  DROP CONSTRAINT IF EXISTS character_anchor_provenance_check;

ALTER TABLE character_anchor_version
  ADD CONSTRAINT character_anchor_provenance_check CHECK (
    provenance IS NULL
    OR provenance IN (
      'generated_from_source',
      'uploaded_as_ready_anchor',
      'refined_from_accepted_anchor'
    )
  );

ALTER TABLE character_anchor_version
  DROP CONSTRAINT IF EXISTS character_anchor_status_check;

ALTER TABLE character_anchor_version
  ADD CONSTRAINT character_anchor_status_check CHECK (
    status IN ('pending', 'ready', 'failed', 'approved', 'retired')
  );

CREATE TABLE IF NOT EXISTS character_anchor_head (
  material_state_id uuid NOT NULL REFERENCES material_state (id),
  character_name text NOT NULL,
  anchor_version_id uuid REFERENCES character_anchor_version (id) ON DELETE SET NULL,
  PRIMARY KEY (material_state_id, character_name)
);

INSERT INTO character_anchor_head (material_state_id, character_name, anchor_version_id)
SELECT DISTINCT ON (material_state_id, character_name)
       material_state_id,
       character_name,
       id
FROM character_anchor_version
WHERE status = 'approved'
ORDER BY material_state_id, character_name, approved_at DESC NULLS LAST, created_at DESC, id DESC
ON CONFLICT (material_state_id, character_name) DO NOTHING;

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
      'placement_commit',
      'visual_approve',
      'frame_insert',
      'frame_delete',
      'frame_reorder',
      'panel_add',
      'panel_delete',
      'panel_reorder',
      'frame_duration',
      'text_card',
      'panel_subject',
      'asset_assign',
      'storyboard_undo',
      'render'
    )
  );
