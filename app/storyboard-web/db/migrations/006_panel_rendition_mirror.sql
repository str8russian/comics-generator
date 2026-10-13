ALTER TABLE panel_visual_state
  ADD COLUMN IF NOT EXISTS mirrored boolean NOT NULL DEFAULT false;
