ALTER TABLE visual_asset
  ADD COLUMN IF NOT EXISTS provenance jsonb;

ALTER TABLE panel_generation
  ADD COLUMN IF NOT EXISTS performance_intent text;

ALTER TABLE panel_generation
  DROP CONSTRAINT IF EXISTS panel_generation_performance_intent_check;

ALTER TABLE panel_generation
  ADD CONSTRAINT panel_generation_performance_intent_check CHECK (
    performance_intent IS NULL OR performance_intent IN ('keep', 'set', 'clear')
  );

ALTER TABLE storyboard_version
  ADD COLUMN IF NOT EXISTS operation_context jsonb;

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

ALTER TABLE research_event
  DROP CONSTRAINT IF EXISTS research_event_outcome_values_check;

ALTER TABLE research_event
  ADD CONSTRAINT research_event_outcome_values_check CHECK (
    outcome IS NULL OR outcome IN ('success', 'failure', 'blocked', 'no-change')
  );

UPDATE visual_asset AS asset
SET provenance = jsonb_strip_nulls(jsonb_build_object(
  'origin', 'generation',
  'subject', NULLIF(panel_state.subject, ''),
  'description', NULLIF(generation.resolved_description, ''),
  'submittedText', NULLIF(generation.instruction, ''),
  'structureFrameId', panel_state.frame_id,
  'panelId', panel_state.panel_id,
  'panelIndex', panel_state.panel_index,
  'anchorVersionId', generation.anchor_version_id,
  'storyboardResultId', version.storyboard_result_id
))
FROM panel_generation AS generation
JOIN panel_visual_state AS panel_state ON panel_state.id = generation.panel_visual_state_id
JOIN storyboard_version AS version ON version.id = panel_state.storyboard_version_id
WHERE asset.id = generation.output_asset_id
  AND generation.status = 'ready'
  AND asset.kind = 'panel-image'
  AND asset.provenance IS NULL;
