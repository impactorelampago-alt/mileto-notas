ALTER TABLE notes
ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'LOW'
CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'));

CREATE TABLE IF NOT EXISTS note_client_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  excerpt TEXT NOT NULL,
  selection_start INTEGER NOT NULL DEFAULT 0,
  selection_end INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE note_client_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view annotations from accessible notes" ON note_client_annotations;
CREATE POLICY "Users can view annotations from accessible notes"
ON note_client_annotations
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM notes n
    WHERE n.id = note_client_annotations.note_id
      AND (
        n.creator_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM note_collaborators nc
          WHERE nc.note_id = n.id
            AND nc.user_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS "Users can insert annotations on accessible notes" ON note_client_annotations;
CREATE POLICY "Users can insert annotations on accessible notes"
ON note_client_annotations
FOR INSERT
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM notes n
    WHERE n.id = note_client_annotations.note_id
      AND (
        n.creator_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM note_collaborators nc
          WHERE nc.note_id = n.id
            AND nc.user_id = auth.uid()
            AND nc.permission IN ('VIEW', 'EDIT')
        )
      )
  )
);

DROP POLICY IF EXISTS "Users can delete own annotations" ON note_client_annotations;
CREATE POLICY "Users can delete own annotations"
ON note_client_annotations
FOR DELETE
USING (created_by = auth.uid());
