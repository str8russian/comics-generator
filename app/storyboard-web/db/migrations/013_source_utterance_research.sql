-- The Frame Editor utterance edit is a product operation on the existing research path.

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
      'render',
      'source_utterance_edit'
    )
  );
