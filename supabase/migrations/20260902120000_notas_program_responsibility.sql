-- Mileto Notas - program responsibility
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.notas_programs
  ADD COLUMN IF NOT EXISTS responsible_programmer_id uuid,
  ADD COLUMN IF NOT EXISTS responsible_programmer_name_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS responsible_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS responsible_assigned_by uuid;

ALTER TABLE public.notas_program_history
  ADD COLUMN IF NOT EXISTS responsible_programmer_id_snapshot uuid,
  ADD COLUMN IF NOT EXISTS responsible_programmer_name_snapshot text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_notas_programs_responsible
  ON public.notas_programs (account_id, responsible_programmer_id, active, name);
CREATE INDEX IF NOT EXISTS idx_notas_program_history_responsible
  ON public.notas_program_history
    (account_id, responsible_programmer_id_snapshot, completed_at DESC, id);

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notas_programs'::regclass
    AND conname = 'notas_programs_responsible_programmer_fkey') THEN
    ALTER TABLE public.notas_programs ADD CONSTRAINT notas_programs_responsible_programmer_fkey
      FOREIGN KEY (responsible_programmer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END
$constraints$;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notas_programs'::regclass
    AND conname = 'notas_programs_responsible_assigned_by_fkey') THEN
    ALTER TABLE public.notas_programs ADD CONSTRAINT notas_programs_responsible_assigned_by_fkey
      FOREIGN KEY (responsible_assigned_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END
$constraints$;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notas_program_history'::regclass
    AND conname = 'notas_program_history_responsible_programmer_fkey') THEN
    ALTER TABLE public.notas_program_history ADD CONSTRAINT notas_program_history_responsible_programmer_fkey
      FOREIGN KEY (responsible_programmer_id_snapshot) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END
$constraints$;

CREATE TABLE IF NOT EXISTS public.notas_program_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.notas_programs(id) ON DELETE CASCADE,
  from_programmer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  from_programmer_name_snapshot text NOT NULL DEFAULT '',
  to_programmer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_programmer_name_snapshot text NOT NULL DEFAULT '',
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_by_name_snapshot text NOT NULL DEFAULT '',
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notas_program_assignments_program
  ON public.notas_program_assignments (account_id, program_id, changed_at DESC, id);
ALTER TABLE public.notas_program_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notas_program_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notas_program_assignments TO service_role;

CREATE OR REPLACE FUNCTION public.notas_cargo_keys_named(p_nodes jsonb, p_name text)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_node jsonb;
  v_keys text[] := '{}';
  v_label text;
BEGIN
  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN RETURN v_keys; END IF;
  FOR v_node IN SELECT value FROM jsonb_array_elements(p_nodes) LOOP
    v_label := regexp_replace(translate(upper(coalesce(v_node->>'label', v_node->>'name',
      v_node->>'title', v_node->>'key', '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'AAAAAEEEEIIIIOOOOOUUUUC'), '[^A-Z0-9]+', '', 'g');
    IF v_label = regexp_replace(translate(upper(p_name),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'),
      '[^A-Z0-9]+', '', 'g')
       AND nullif(v_node->>'key', '') IS NOT NULL THEN
      v_keys := array_append(v_keys, v_node->>'key');
    END IF;
    v_keys := v_keys || public.notas_cargo_keys_named(v_node->'children', p_name);
  END LOOP;
  RETURN v_keys;
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_cargo_keys_named(jsonb, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notas_programmer_membership(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_account uuid := public.current_account_id();
  v_is_programmer boolean := false;
  v_is_lead boolean := false;
BEGIN
  IF p_user_id IS NULL OR v_account IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id AND p.account_id = v_account
      AND lower(coalesce(p.employment_status::text, 'active')) = 'active'
      AND p.terminated_at IS NULL
  ) THEN RETURN 'NONE'; END IF;
  SELECT
    coalesce(bool_or(
      regexp_replace(upper(cargo.key), '[^A-Z0-9]+', '', 'g') = 'PROGRAMADOR'
      OR cargo.key = ANY(public.notas_cargo_keys_named(settings.nucleo_tree, 'PROGRAMADOR'))
    ), false),
    coalesce(bool_or(
      regexp_replace(upper(cargo.key), '[^A-Z0-9]+', '', 'g') = 'PROGRAMADORLIDER'
      OR cargo.key = ANY(public.notas_cargo_keys_named(settings.nucleo_tree, 'PROGRAMADORLIDER'))
    ), false)
    INTO v_is_programmer, v_is_lead
  FROM public.permission_settings settings
  CROSS JOIN LATERAL jsonb_each(coalesce(settings.cargo_members, '{}'::jsonb))
    AS cargo(key, members)
  WHERE jsonb_typeof(cargo.members) = 'array'
    AND cargo.members ? p_user_id::text
    AND (NOT (to_jsonb(settings) ? 'account_id')
         OR to_jsonb(settings)->>'account_id' = v_account::text);

  IF v_is_lead THEN RETURN 'LEAD'; END IF;
  IF v_is_programmer THEN RETURN 'PROGRAMMER'; END IF;
  RETURN 'NONE';
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_programmer_membership(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notas_program_assignment_access()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.notas_programmer_membership(auth.uid());
$fn$;
REVOKE ALL ON FUNCTION public.notas_program_assignment_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_assignment_access()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notas_programmer_options()
RETURNS TABLE (user_id uuid, user_name text, is_lead boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_account uuid := public.current_account_id();
BEGIN
  IF public.notas_program_access_level() = 'NONE' THEN
    RAISE EXCEPTION 'no program access';
  END IF;
  RETURN QUERY
  SELECT p.id, coalesce(nullif(btrim(p.name), ''), p.email, 'Usuario'),
    public.notas_programmer_membership(p.id) = 'LEAD'
  FROM public.profiles p
  WHERE p.account_id = v_account
    AND lower(coalesce(p.employment_status::text, 'active')) = 'active'
    AND p.terminated_at IS NULL
    AND public.notas_programmer_membership(p.id) IN ('PROGRAMMER', 'LEAD')
  ORDER BY public.notas_programmer_membership(p.id) = 'LEAD' DESC,
    coalesce(nullif(btrim(p.name), ''), p.email);
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_programmer_options() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_programmer_options() TO authenticated;

CREATE OR REPLACE FUNCTION public.notas_assign_program_responsible(
  p_program_id uuid, p_programmer_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_account uuid := public.current_account_id();
  v_membership text := public.notas_programmer_membership(auth.uid());
  v_program record;
  v_target_name text := '';
  v_actor_name text := '';
BEGIN
  IF v_membership = 'NONE' THEN
    RAISE EXCEPTION 'only configured programmers can assign programs';
  END IF;
  SELECT * INTO v_program FROM public.notas_programs p
  WHERE p.id = p_program_id AND p.account_id = v_account AND p.active = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active program not found in current account'; END IF;

  IF p_programmer_id IS NOT NULL THEN
    IF public.notas_programmer_membership(p_programmer_id) = 'NONE' THEN
      RAISE EXCEPTION 'target must be an active configured programmer in this account';
    END IF;
    SELECT coalesce(nullif(btrim(p.name), ''), p.email, 'Usuario')
      INTO v_target_name FROM public.profiles p WHERE p.id = p_programmer_id;
  END IF;
  IF v_membership = 'PROGRAMMER' THEN
    IF v_program.responsible_programmer_id IS NULL THEN
      IF p_programmer_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'programmer can only assume an unassigned program';
      END IF;
    ELSIF v_program.responsible_programmer_id = v_uid THEN
      IF p_programmer_id IS NULL THEN
        RAISE EXCEPTION 'only the programmer leader can leave a program unassigned';
      END IF;
    ELSE
      RAISE EXCEPTION 'program already belongs to another programmer';
    END IF;
  END IF;
  IF v_program.responsible_programmer_id IS NOT DISTINCT FROM p_programmer_id THEN
    RETURN v_program.id;
  END IF;
  SELECT coalesce(nullif(btrim(p.name), ''), p.email, 'Usuario')
    INTO v_actor_name FROM public.profiles p WHERE p.id = v_uid;

  UPDATE public.notas_programs SET
    responsible_programmer_id = p_programmer_id,
    responsible_programmer_name_snapshot = coalesce(v_target_name, ''),
    responsible_assigned_at = CASE WHEN p_programmer_id IS NULL THEN NULL ELSE now() END,
    responsible_assigned_by = v_uid,
    updated_at = now()
  WHERE id = v_program.id;
  INSERT INTO public.notas_program_assignments (
    account_id, program_id, from_programmer_id, from_programmer_name_snapshot,
    to_programmer_id, to_programmer_name_snapshot,
    changed_by, changed_by_name_snapshot
  ) VALUES (
    v_account, v_program.id, v_program.responsible_programmer_id,
    coalesce(v_program.responsible_programmer_name_snapshot, ''),
    p_programmer_id, coalesce(v_target_name, ''), v_uid, coalesce(v_actor_name, 'Usuario')
  );
  RETURN v_program.id;
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_assign_program_responsible(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_assign_program_responsible(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.notas_program_access_level()
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_account uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN 'NONE'; END IF;
  SELECT p.role::text, p.account_id INTO v_role, v_account
    FROM public.profiles p WHERE p.id = v_uid;
  IF v_account IS NULL THEN RETURN 'NONE'; END IF;
  IF v_role IN ('DONO', 'GERENTE', 'COORDENADOR') THEN RETURN 'TEAM'; END IF;
  IF public.notas_programmer_membership(v_uid) IN ('PROGRAMMER', 'LEAD') THEN
    RETURN 'SELF';
  END IF;
  RETURN 'REPORTER';
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_program_access_level() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_access_level()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notas_program_assignment_history_list(p_program_id uuid)
RETURNS TABLE (
  id uuid, from_programmer_id uuid, from_programmer_name text,
  to_programmer_id uuid, to_programmer_name text,
  changed_by uuid, changed_by_name text, changed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_account uuid := public.current_account_id();
  v_membership text := public.notas_programmer_membership(auth.uid());
  v_access text := public.notas_program_access_level();
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.notas_programs p
    WHERE p.id = p_program_id AND p.account_id = v_account
      AND (v_access = 'TEAM' OR v_membership = 'LEAD'
           OR p.responsible_programmer_id = auth.uid())
  ) THEN RAISE EXCEPTION 'no access to program assignment history'; END IF;

  RETURN QUERY SELECT a.id, a.from_programmer_id,
    a.from_programmer_name_snapshot, a.to_programmer_id,
    a.to_programmer_name_snapshot, a.changed_by,
    a.changed_by_name_snapshot, a.changed_at
  FROM public.notas_program_assignments a
  WHERE a.account_id = v_account AND a.program_id = p_program_id
  ORDER BY a.changed_at DESC, a.id DESC;
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_program_assignment_history_list(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_assignment_history_list(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.notas_program_report_target(p_requested uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_access text := public.notas_program_access_level();
  v_membership text := public.notas_programmer_membership(auth.uid());
  v_target uuid;
BEGIN
  IF v_access = 'TEAM' THEN
    v_target := coalesce(p_requested,
      CASE WHEN v_membership IN ('PROGRAMMER', 'LEAD') THEN v_uid END);
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'management must choose a programmer';
    END IF;
  ELSIF v_membership IN ('PROGRAMMER', 'LEAD') THEN
    IF p_requested IS NOT NULL AND p_requested <> v_uid THEN
      RAISE EXCEPTION 'programmers can only read their own report';
    END IF;
    v_target := v_uid;
  ELSE
    RAISE EXCEPTION 'no access to programmer report';
  END IF;
  IF public.notas_programmer_membership(v_target) = 'NONE' THEN
    RAISE EXCEPTION 'report target is not an active configured programmer';
  END IF;
  RETURN v_target;
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_program_report_target(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notas_program_pending_report(
  p_programmer_id uuid DEFAULT NULL, p_program_id uuid DEFAULT NULL
)
RETURNS TABLE (
  program_id uuid, program_name text, responsible_programmer_id uuid,
  responsible_programmer_name text, responsible_assigned_at timestamptz,
  note_id uuid, root_note_id uuid, root_title text, title text, content text,
  priority text, due_date timestamptz, requested_at timestamptz,
  reporter_id uuid, reporter_name text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_account uuid := public.current_account_id();
  v_target uuid := public.notas_program_report_target(p_programmer_id);
BEGIN
  RETURN QUERY
  SELECT program.id, program.name, program.responsible_programmer_id,
    program.responsible_programmer_name_snapshot, program.responsible_assigned_at,
    child.id, root.id, coalesce(root.title, ''), coalesce(child.title, ''),
    coalesce(child.content, ''), child.priority::text, child.due_date,
    child.created_at, coalesce(task.assignee_id, root.creator_id),
    coalesce(nullif(btrim(root.title), ''), reporter.name, reporter.email, 'Usuario')
  FROM public.notas_programs program
  JOIN public.tasks task ON task.account_id = v_account
    AND task.status = program.category_key
  JOIN public.notes root ON root.task_id = task.id
    AND root.parent_note_id IS NULL AND root.is_archived = false
  JOIN public.notes child ON child.parent_note_id = root.id
    AND child.is_archived = false
  LEFT JOIN public.profiles reporter
    ON reporter.id = coalesce(task.assignee_id, root.creator_id)
  WHERE program.account_id = v_account
    AND program.active = true
    AND program.responsible_programmer_id = v_target
    AND (p_program_id IS NULL OR program.id = p_program_id)
  ORDER BY program.name, child.priority, child.due_date NULLS LAST,
    child.created_at, child.id;
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_program_pending_report(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_pending_report(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notas_program_completed_report(
  p_programmer_id uuid DEFAULT NULL, p_program_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  history_id uuid, program_id uuid, program_name text,
  responsible_programmer_id uuid, responsible_programmer_name text,
  note_id uuid, root_note_id uuid, root_title text, title text, content text,
  priority text, reporter_id uuid, reporter_name text,
  completed_by uuid, completed_by_name text,
  requested_at timestamptz, completed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_account uuid := public.current_account_id();
  v_target uuid := public.notas_program_report_target(p_programmer_id);
BEGIN
  RETURN QUERY
  SELECT h.id, h.program_id, h.program_name_snapshot,
    h.responsible_programmer_id_snapshot,
    h.responsible_programmer_name_snapshot,
    h.note_id, h.root_note_id, h.root_title_snapshot, h.title_snapshot,
    h.content_snapshot, h.priority_snapshot, h.reporter_id,
    h.reporter_name_snapshot, h.completed_by,
    h.completed_by_name_snapshot, h.source_created_at, h.completed_at
  FROM public.notas_program_history h
  WHERE h.account_id = v_account
    AND h.responsible_programmer_id_snapshot = v_target
    AND h.reopened_at IS NULL
    AND (p_program_id IS NULL OR h.program_id = p_program_id)
    AND (p_from IS NULL OR h.completed_at >= p_from)
    AND (p_to IS NULL OR h.completed_at < p_to)
  ORDER BY h.completed_at DESC, h.id DESC;
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_program_completed_report(
  uuid, uuid, timestamptz, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notas_program_completed_report(
  uuid, uuid, timestamptz, timestamptz
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notas_snapshot_program_responsibility()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE v_program record;
BEGIN
  SELECT p.responsible_programmer_id, p.responsible_programmer_name_snapshot
    INTO v_program FROM public.notas_programs p
    WHERE p.id = NEW.program_id AND p.account_id = NEW.account_id;
  IF FOUND THEN
    NEW.responsible_programmer_id_snapshot := v_program.responsible_programmer_id;
    NEW.responsible_programmer_name_snapshot :=
      coalesce(v_program.responsible_programmer_name_snapshot, '');
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION public.notas_snapshot_program_responsibility()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notas_snapshot_program_responsibility
  ON public.notas_program_history;
CREATE TRIGGER trg_notas_snapshot_program_responsibility
BEFORE INSERT ON public.notas_program_history
FOR EACH ROW EXECUTE FUNCTION public.notas_snapshot_program_responsibility();

COMMENT ON TABLE public.notas_program_assignments IS
  'Immutable responsibility transfer audit. Read only through scoped RPC.';
COMMENT ON FUNCTION public.notas_program_pending_report(uuid, uuid) IS
  'Pending unarchived subnotes from programs currently assigned to the scoped programmer.';
COMMENT ON FUNCTION public.notas_program_completed_report(uuid, uuid, timestamptz, timestamptz) IS
  'Completed subnotes scoped by the immutable responsibility snapshot.';

NOTIFY pgrst, 'reload schema';

COMMIT;
