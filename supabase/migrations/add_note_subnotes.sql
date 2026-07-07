ALTER TABLE notes
ADD COLUMN IF NOT EXISTS parent_note_id UUID NULL REFERENCES notes(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notes_parent_note_not_self'
  ) THEN
    ALTER TABLE notes
    ADD CONSTRAINT notes_parent_note_not_self
    CHECK (parent_note_id IS NULL OR parent_note_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS notes_parent_note_id_idx
ON notes(parent_note_id);

CREATE INDEX IF NOT EXISTS notes_parent_position_idx
ON notes(parent_note_id, position, updated_at DESC);

CREATE OR REPLACE FUNCTION public.user_can_view_note(target_note_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM notes n
    WHERE n.id = target_note_id
      AND (
        n.creator_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM note_collaborators nc
          WHERE nc.note_id = n.id
            AND nc.user_id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_edit_note(target_note_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM notes n
    WHERE n.id = target_note_id
      AND (
        n.creator_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM note_collaborators nc
          WHERE nc.note_id = n.id
            AND nc.user_id = auth.uid()
            AND nc.permission = 'EDIT'
        )
      )
  );
$$;

DROP POLICY IF EXISTS "Users can view subnotes from accessible parent notes" ON notes;
CREATE POLICY "Users can view subnotes from accessible parent notes"
ON notes
FOR SELECT
USING (
  parent_note_id IS NOT NULL
  AND public.user_can_view_note(parent_note_id)
);

DROP POLICY IF EXISTS "Users can insert subnotes on editable parent notes" ON notes;
CREATE POLICY "Users can insert subnotes on editable parent notes"
ON notes
FOR INSERT
WITH CHECK (
  parent_note_id IS NOT NULL
  AND creator_id = auth.uid()
  AND public.user_can_edit_note(parent_note_id)
);

DROP POLICY IF EXISTS "Users can update editable subnotes" ON notes;
CREATE POLICY "Users can update editable subnotes"
ON notes
FOR UPDATE
USING (
  parent_note_id IS NOT NULL
  AND public.user_can_edit_note(parent_note_id)
)
WITH CHECK (
  parent_note_id IS NOT NULL
  AND public.user_can_edit_note(parent_note_id)
);
