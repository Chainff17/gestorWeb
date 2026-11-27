-- Historial acotado por cuenta; una copia se registra en la misma transacción
-- que el snapshot. Las versiones son de solo lectura para el cliente.
CREATE TABLE public.gestor_copias (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  payload jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, revision)
);
ALTER TABLE public.gestor_copias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gestor_copias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gestor_copias TO authenticated;
CREATE POLICY "Leer copias propias" ON public.gestor_copias FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE FUNCTION public.gestor_guardar_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.gestor_copias (user_id, revision, payload)
    VALUES (NEW.user_id, NEW.revision, NEW.payload)
    ON CONFLICT (user_id, revision) DO NOTHING;
  DELETE FROM public.gestor_copias WHERE user_id = NEW.user_id AND revision NOT IN
    (SELECT revision FROM public.gestor_copias WHERE user_id = NEW.user_id ORDER BY revision DESC LIMIT 30);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.gestor_guardar_version() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER gestor_versionar_snapshot AFTER INSERT OR UPDATE ON public.gestor_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.gestor_guardar_version();
-- Copia inicial para cuentas ya existentes, sin cambiar sus datos.
INSERT INTO public.gestor_copias (user_id, revision, payload)
SELECT user_id, revision, payload FROM public.gestor_snapshots ON CONFLICT DO NOTHING;
