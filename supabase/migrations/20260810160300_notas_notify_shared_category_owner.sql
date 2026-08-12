-- =============================================================================
-- Mileto Notas - avisar tambem o dono de uma categoria compartilhada
-- =============================================================================
-- A versao anterior notificava somente category_shares.shared_with. Quando um
-- destinatario criava uma nota, o dono/shared_by (ex.: Thales) nao recebia nada.
-- Esta versao une os destinatarios ao dono canonico codificado na category_key,
-- deduplica por destinatario e continua sem notificar o autor/ator.
-- =============================================================================

BEGIN;

-- As notificacoes historicas podem conter duplicatas da implementacao anterior.
-- Nao apagamos nenhuma delas. O guard abaixo fica NULL no historico e TRUE por
-- default nas novas linhas; assim o indice nasce sem conflitar com duplicatas
-- antigas, protege qualquer produtor futuro e a migration segue reaplicavel.
ALTER TABLE public.notas_notifications
  ADD COLUMN IF NOT EXISTS note_created_dedup_guard boolean;

ALTER TABLE public.notas_notifications
  ALTER COLUMN note_created_dedup_guard SET DEFAULT true;

-- Rede de seguranca para uma eventual execucao parcial anterior: conserva todas
-- as notificacoes e apenas desmarca o guard interno das repetidas. A mais antiga
-- continua protegida pelo indice.
WITH ranked_guarded AS (
  SELECT notification.id,
         row_number() OVER (
           PARTITION BY notification.recipient_id, notification.note_id
           ORDER BY notification.created_at, notification.id
         ) AS occurrence
    FROM public.notas_notifications AS notification
   WHERE notification.type = 'note_created'
     AND notification.note_id IS NOT NULL
     AND notification.note_created_dedup_guard IS TRUE
)
UPDATE public.notas_notifications AS notification
   SET note_created_dedup_guard = false
  FROM ranked_guarded AS ranked
 WHERE ranked.id = notification.id
   AND ranked.occurrence > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notas_notifications_note_created_guard
  ON public.notas_notifications (recipient_id, note_id)
  WHERE type = 'note_created'
    AND note_id IS NOT NULL
    AND note_created_dedup_guard IS TRUE;

CREATE OR REPLACE FUNCTION public.notas_notify_shared_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_status text;
  v_account uuid;
BEGIN
  IF NEW.task_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.title IS NULL OR NEW.title = '' OR NEW.title = 'Sem titulo'
     OR NEW.title = 'Sem título' OR NEW.title = 'Nova nota' THEN
    RETURN NEW;
  END IF;

  -- actor_id referencia profiles. Sem profile valido, usamos NULL para que a FK
  -- nao cancele os avisos dos destinatarios.
  SELECT profile.id INTO v_actor
    FROM public.profiles AS profile
   WHERE profile.id = auth.uid();

  SELECT task.status, task.account_id
    INTO v_status, v_account
    FROM public.tasks AS task
   WHERE task.id = NEW.task_id;
  IF v_status IS NULL THEN RETURN NEW; END IF;

  BEGIN
    WITH recipients AS (
      -- recipient_id referencia profiles: ignora share orfao em vez de deixar uma
      -- unica FK invalida cancelar o INSERT em lote inteiro.
      SELECT profile.id AS recipient_id
        FROM public.category_shares AS share
        JOIN public.profiles AS profile
          ON profile.id = share.shared_with
         AND profile.account_id = v_account
       WHERE share.category_key = v_status
      UNION
      -- O dono canonico vem do prefixo USR_<uuid32>_ da key, nao de shared_by
      -- (um DONO global pode compartilhar a categoria alheia). So o inclui se
      -- existir ao menos um compartilhamento vigente para este status.
      SELECT profile.id AS recipient_id
        FROM public.profiles AS profile
       WHERE v_status ~ '^USR_[0-9A-Fa-f]{32}_'
         AND profile.account_id = v_account
         AND replace(profile.id::text, '-', '') = lower(substring(v_status FROM 5 FOR 32))
         AND EXISTS (
           SELECT 1
             FROM public.category_shares AS share
            WHERE share.category_key = v_status
         )
    )
    INSERT INTO public.notas_notifications
      (recipient_id, actor_id, task_id, note_id, title, type, note_created_dedup_guard)
    SELECT recipient.recipient_id, v_actor, NEW.task_id, NEW.id, NEW.title,
           'note_created', true
      FROM recipients AS recipient
     WHERE recipient.recipient_id IS NOT NULL
       AND recipient.recipient_id IS DISTINCT FROM NEW.creator_id
       AND recipient.recipient_id IS DISTINCT FROM v_actor
       AND NOT EXISTS (
         SELECT 1
           FROM public.notas_notifications AS previous
          WHERE previous.note_id = NEW.id
            AND previous.type = 'note_created'
            AND previous.recipient_id = recipient.recipient_id
       )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort: o sino nunca pode impedir a escrita da nota
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Inclui falhas inesperadas anteriores ao INSERT (lookup da task/profile etc.).
  -- O sino e best-effort e jamais pode impedir INSERT/UPDATE da nota.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notas_notify_shared_note() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notas_notify_shared_note() FROM anon;

DROP TRIGGER IF EXISTS trg_notas_notify_shared_note_ins ON public.notes;
CREATE TRIGGER trg_notas_notify_shared_note_ins
  AFTER INSERT ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notas_notify_shared_note();

DROP TRIGGER IF EXISTS trg_notas_notify_shared_note_upd ON public.notes;
CREATE TRIGGER trg_notas_notify_shared_note_upd
  AFTER UPDATE OF title ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.notas_notify_shared_note();

COMMIT;
