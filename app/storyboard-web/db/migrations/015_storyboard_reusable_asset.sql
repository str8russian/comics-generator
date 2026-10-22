-- Picker-visible images can outlive the panel assignment or generation row
-- that first made them selectable. A duplicate records that set explicitly
-- so the destination picker does not depend on copied history.

CREATE TABLE storyboard_reusable_asset (
  storyboard_result_id uuid NOT NULL REFERENCES storyboard_result (id),
  asset_id uuid NOT NULL REFERENCES visual_asset (id),
  PRIMARY KEY (storyboard_result_id, asset_id)
);
