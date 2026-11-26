-- Optimistic concurrency: stale clients may read but cannot overwrite snapshots.
ALTER TABLE public.gestor_snapshots ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.guardar_gestor_snapshot(p_payload jsonb, p_revision bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
  revision_nueva bigint;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_payload->'clientes') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_payload->'recibos') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_payload->'transferencias') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_payload->'finanzas') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid snapshot' USING ERRCODE = '22023';
  END IF;
  IF p_revision IS NULL THEN
    INSERT INTO public.gestor_snapshots(user_id, payload, revision)
    VALUES (uid, p_payload, 1) ON CONFLICT (user_id) DO NOTHING
    RETURNING revision INTO revision_nueva;
  ELSE
    UPDATE public.gestor_snapshots SET payload = p_payload, revision = revision + 1
      WHERE user_id = uid AND revision = p_revision
    RETURNING revision INTO revision_nueva;
  END IF;
  IF revision_nueva IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN jsonb_build_object('ok', true, 'revision', revision_nueva);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_gestor_snapshot(jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_gestor_snapshot(jsonb, bigint) TO authenticated;
-- The previous app version does direct upserts without checking a revision.
-- Blocking those writes protects the newer data; old versions keep their local cache.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.gestor_snapshots FROM anon, authenticated;
