-- ============ SHAREPOINT CUTSHEETS, STAGE 1: FILE INDEX ============
-- The sharepoint-cutsheets edge function lists the vendor cutsheets folder in
-- SharePoint (Wiki library, "Vendor Docs, Cuts & CAD Blocks/Vendor Product
-- Cutsheets & Docs", every subfolder) and records what it found here. Later
-- stages match these files to products, create products from them and let
-- Microsoft 365 users open them; this stage only keeps an accurate list.
--
--   sharepoint_files     one row per file ever seen, keyed by its SharePoint
--                        drive + item id. That id survives renames and moves,
--                        so anything linked to a row stays linked. A file that
--                        disappears from the folder gets removed_at instead of
--                        being deleted; if it comes back, removed_at clears.
--   cutsheet_sync_runs   one row per sync: who/what started it, counts, and
--                        the error when it failed. Only one can run at a time.
--
-- Clients (admins only, for now) can SELECT; every write goes through the
-- functions below, which only service_role -- i.e. the edge function -- can
-- execute.
--
-- Applied 2026-09-26; record_sharepoint_sync's DROP TABLE IF EXISTS line was
-- added right after (CREATE OR REPLACE on the live project) when testing
-- showed a second call in one transaction failing on the leftover temp table.

BEGIN;

CREATE TABLE public.sharepoint_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Relative to the cutsheets folder, '/'-separated; '' = the folder itself.
  -- The first segment is normally the vendor.
  folder_path TEXT NOT NULL DEFAULT '',
  -- Lower case, no dot. NULL when the name has no extension.
  extension TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  web_url TEXT NOT NULL,
  sp_modified_at TIMESTAMPTZ,
  etag TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  CONSTRAINT sharepoint_files_item_key UNIQUE (drive_id, item_id)
);

CREATE TABLE public.cutsheet_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
  -- SET NULL so a sync never stops an account from being deleted.
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  folders_scanned INTEGER,
  files_seen INTEGER,
  files_added INTEGER,
  files_changed INTEGER,
  files_removed INTEGER,
  error TEXT
);

-- At most one running sync.
CREATE UNIQUE INDEX cutsheet_sync_runs_one_running ON public.cutsheet_sync_runs ((true)) WHERE status = 'running';
CREATE INDEX cutsheet_sync_runs_started_at_idx ON public.cutsheet_sync_runs (started_at DESC);

REVOKE ALL ON public.sharepoint_files, public.cutsheet_sync_runs FROM anon, authenticated;
GRANT SELECT ON public.sharepoint_files, public.cutsheet_sync_runs TO authenticated;
GRANT ALL ON public.sharepoint_files, public.cutsheet_sync_runs TO service_role;

ALTER TABLE public.sharepoint_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cutsheet_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sharepoint_files_select ON public.sharepoint_files FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));
CREATE POLICY cutsheet_sync_runs_select ON public.cutsheet_sync_runs FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- start_cutsheet_sync: opens a run. A run still "running" after 15 minutes
-- belongs to an edge function that died (they're cut off long before that),
-- so it's closed as failed first rather than blocking every sync after it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_cutsheet_sync(_trigger TEXT, _triggered_by UUID)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _run_id UUID;
BEGIN
  UPDATE public.cutsheet_sync_runs
     SET status = 'failed', finished_at = now(), error = 'Timed out: the sync stopped without reporting back.'
   WHERE status = 'running' AND started_at < now() - interval '15 minutes';

  BEGIN
    INSERT INTO public.cutsheet_sync_runs (trigger, triggered_by)
    VALUES (_trigger, _triggered_by)
    RETURNING id INTO _run_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A sync is already running. Try again in a minute.' USING ERRCODE = 'P0001';
  END;

  RETURN _run_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- record_sharepoint_sync: stores one complete listing and closes the run, in
-- one transaction. _files is a JSON array of
--   { item_id, name, folder_path, extension, mime_type, size_bytes, web_url,
--     sp_modified_at, etag }
-- Every known file missing from the listing is marked removed. An EMPTY
-- listing while files are known is refused: that's far more likely a
-- SharePoint or configuration problem than someone emptying the folder, and
-- accepting it would mark every cutsheet missing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_sharepoint_sync(_run_id UUID, _drive_id TEXT, _folders_scanned INTEGER, _files JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _seen INTEGER;
  _added INTEGER;
  _changed INTEGER;
  _removed INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.cutsheet_sync_runs WHERE id = _run_id AND status = 'running') THEN
    RAISE EXCEPTION 'Sync run % is not running', _run_id;
  END IF;
  IF jsonb_typeof(_files) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '_files must be a JSON array';
  END IF;

  -- ON COMMIT DROP only drops at the end of the transaction, so a second call
  -- inside the same one would find the table still there.
  DROP TABLE IF EXISTS pg_temp._incoming;
  CREATE TEMP TABLE _incoming ON COMMIT DROP AS
  SELECT DISTINCT ON (f.item_id) f.*
    FROM jsonb_to_recordset(_files) AS f(
      item_id TEXT, name TEXT, folder_path TEXT, extension TEXT, mime_type TEXT,
      size_bytes BIGINT, web_url TEXT, sp_modified_at TIMESTAMPTZ, etag TEXT)
   WHERE f.item_id IS NOT NULL AND f.name IS NOT NULL AND f.web_url IS NOT NULL;

  SELECT count(*) INTO _seen FROM _incoming;

  IF _seen = 0 AND EXISTS (SELECT 1 FROM public.sharepoint_files WHERE removed_at IS NULL) THEN
    RAISE EXCEPTION 'SharePoint returned no files, so nothing was changed. Check that the cutsheets folder still exists and the app still has access to it.';
  END IF;

  SELECT count(*) INTO _added
    FROM _incoming i
   WHERE NOT EXISTS (SELECT 1 FROM public.sharepoint_files s WHERE s.drive_id = _drive_id AND s.item_id = i.item_id);

  SELECT count(*) INTO _changed
    FROM _incoming i
    JOIN public.sharepoint_files s ON s.drive_id = _drive_id AND s.item_id = i.item_id
   WHERE s.etag IS DISTINCT FROM i.etag
      OR s.name IS DISTINCT FROM i.name
      OR s.folder_path IS DISTINCT FROM coalesce(i.folder_path, '')
      OR s.removed_at IS NOT NULL;

  INSERT INTO public.sharepoint_files AS s
    (drive_id, item_id, name, folder_path, extension, mime_type, size_bytes, web_url, sp_modified_at, etag, last_seen_at, removed_at)
  SELECT _drive_id, i.item_id, i.name, coalesce(i.folder_path, ''), nullif(lower(i.extension), ''), i.mime_type,
         i.size_bytes, i.web_url, i.sp_modified_at, i.etag, now(), NULL
    FROM _incoming i
  ON CONFLICT (drive_id, item_id) DO UPDATE
     SET name = EXCLUDED.name,
         folder_path = EXCLUDED.folder_path,
         extension = EXCLUDED.extension,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         web_url = EXCLUDED.web_url,
         sp_modified_at = EXCLUDED.sp_modified_at,
         etag = EXCLUDED.etag,
         last_seen_at = now(),
         removed_at = NULL;

  -- Anything not in this listing -- including files from a previously
  -- configured library -- is gone from the cutsheets folder.
  UPDATE public.sharepoint_files s
     SET removed_at = now()
   WHERE s.removed_at IS NULL
     AND NOT (s.drive_id = _drive_id AND EXISTS (SELECT 1 FROM _incoming i WHERE i.item_id = s.item_id));
  GET DIAGNOSTICS _removed = ROW_COUNT;

  UPDATE public.cutsheet_sync_runs
     SET status = 'succeeded', finished_at = now(), folders_scanned = _folders_scanned,
         files_seen = _seen, files_added = _added, files_changed = _changed, files_removed = _removed
   WHERE id = _run_id;

  RETURN jsonb_build_object(
    'folders_scanned', _folders_scanned, 'files_seen', _seen,
    'files_added', _added, 'files_changed', _changed, 'files_removed', _removed);
END;
$$;

-- fail_cutsheet_sync: closes a run with the error the edge function hit.
CREATE OR REPLACE FUNCTION public.fail_cutsheet_sync(_run_id UUID, _error TEXT)
RETURNS VOID
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.cutsheet_sync_runs
     SET status = 'failed', finished_at = now(), error = left(_error, 2000)
   WHERE id = _run_id AND status = 'running';
$$;

REVOKE ALL ON FUNCTION public.start_cutsheet_sync(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_sharepoint_sync(UUID, TEXT, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_cutsheet_sync(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_cutsheet_sync(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_sharepoint_sync(UUID, TEXT, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_cutsheet_sync(UUID, TEXT) TO service_role;

COMMIT;
