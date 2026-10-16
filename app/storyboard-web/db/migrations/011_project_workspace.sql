-- Multiple projects. The existing singleton row stays the first project.

ALTER TABLE project ADD COLUMN title text;
ALTER TABLE project ADD COLUMN created_at timestamptz;
ALTER TABLE project ADD COLUMN updated_at timestamptz;
ALTER TABLE project ADD COLUMN last_opened_at timestamptz;

ALTER TABLE source_revision ADD COLUMN project_id uuid;
ALTER TABLE reading ADD COLUMN project_id uuid;
ALTER TABLE visual_asset ADD COLUMN project_id uuid;
ALTER TABLE research_event ADD COLUMN project_id uuid;

DO $$
DECLARE
  project_count integer;
  only_project uuid;
BEGIN
  SELECT count(*) INTO project_count FROM project;
  IF project_count = 0 THEN
    IF EXISTS (SELECT 1 FROM source_revision)
       OR EXISTS (SELECT 1 FROM reading)
       OR EXISTS (SELECT 1 FROM visual_asset)
       OR EXISTS (SELECT 1 FROM research_event)
       OR EXISTS (SELECT 1 FROM working_draft) THEN
      RAISE EXCEPTION 'project-migration-ambiguous';
    END IF;
  ELSIF project_count <> 1 THEN
    RAISE EXCEPTION 'project-migration-ambiguous';
  ELSE
    SELECT id INTO only_project FROM project;

    UPDATE project
    SET title = 'Текущий ролик',
        created_at = COALESCE(
          (SELECT MIN(source_revision.created_at) FROM source_revision),
          (SELECT MIN(working_draft.updated_at) FROM working_draft WHERE working_draft.project_id = project.id),
          clock_timestamp()
        ),
        updated_at = COALESCE(
          (
            SELECT MAX(stamp)
            FROM (
              SELECT working_draft.updated_at AS stamp
              FROM working_draft
              WHERE working_draft.project_id = project.id
              UNION ALL
              SELECT source_revision.created_at FROM source_revision
              UNION ALL
              SELECT material_state.created_at FROM material_state
              UNION ALL
              SELECT storyboard_result.created_at FROM storyboard_result
              UNION ALL
              SELECT panel_visual_state.updated_at FROM panel_visual_state
              UNION ALL
              SELECT character_anchor_version.created_at FROM character_anchor_version
              UNION ALL
              SELECT research_event.occurred_at FROM research_event
            ) stamps
          ),
          clock_timestamp()
        ),
        last_opened_at = NULL
    WHERE id = only_project;

    UPDATE source_revision SET project_id = only_project WHERE project_id IS NULL;
    UPDATE reading SET project_id = only_project WHERE project_id IS NULL;
    UPDATE visual_asset SET project_id = only_project WHERE project_id IS NULL;
    UPDATE research_event SET project_id = only_project WHERE project_id IS NULL;

    IF EXISTS (
      SELECT 1
      FROM project
      JOIN source_revision ON source_revision.id = project.active_source_revision_id
      WHERE source_revision.project_id IS DISTINCT FROM project.id
    ) OR EXISTS (
      SELECT 1
      FROM project
      JOIN material_state ON material_state.id = project.active_material_state_id
      JOIN source_revision ON source_revision.id = material_state.source_revision_id
      WHERE source_revision.project_id IS DISTINCT FROM project.id
    ) OR EXISTS (
      SELECT 1
      FROM project
      JOIN reading ON reading.id = project.current_reading_id
      WHERE reading.project_id IS DISTINCT FROM project.id
    ) OR EXISTS (SELECT 1 FROM source_revision WHERE project_id IS NULL)
       OR EXISTS (SELECT 1 FROM reading WHERE project_id IS NULL)
       OR EXISTS (SELECT 1 FROM visual_asset WHERE project_id IS NULL)
       OR EXISTS (SELECT 1 FROM research_event WHERE project_id IS NULL) THEN
      RAISE EXCEPTION 'project-migration-contradictory';
    END IF;
  END IF;
END $$;

ALTER TABLE project DROP CONSTRAINT project_singleton_is_true;
ALTER TABLE project DROP CONSTRAINT project_singleton_key;
ALTER TABLE project DROP COLUMN singleton;

ALTER TABLE project ALTER COLUMN title SET NOT NULL;
ALTER TABLE project ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE project ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE project ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE project ALTER COLUMN updated_at SET DEFAULT clock_timestamp();

ALTER TABLE source_revision
  ADD CONSTRAINT source_revision_project_fk FOREIGN KEY (project_id) REFERENCES project (id);
ALTER TABLE reading
  ADD CONSTRAINT reading_project_fk FOREIGN KEY (project_id) REFERENCES project (id);
ALTER TABLE visual_asset
  ADD CONSTRAINT visual_asset_project_fk FOREIGN KEY (project_id) REFERENCES project (id);
ALTER TABLE research_event
  ADD CONSTRAINT research_event_project_fk FOREIGN KEY (project_id) REFERENCES project (id);

ALTER TABLE source_revision ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE reading ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE visual_asset ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE research_event ALTER COLUMN project_id SET NOT NULL;

CREATE INDEX source_revision_project_idx ON source_revision (project_id);
CREATE INDEX reading_project_idx ON reading (project_id);
CREATE INDEX visual_asset_project_idx ON visual_asset (project_id);
CREATE INDEX research_event_project_seq ON research_event (project_id, seq);
