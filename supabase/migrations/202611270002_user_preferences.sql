-- Las preferencias son independientes de los saldos y su sincronización por revisión.
CREATE TABLE IF NOT EXISTS public.gestor_preferencias (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferencias jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preferencias_objeto CHECK (jsonb_typeof(preferencias) = 'object')
);
ALTER TABLE public.gestor_preferencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gestor_preferencias FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.gestor_preferencias TO authenticated;
CREATE POLICY "Leer preferencias propias" ON public.gestor_preferencias FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Crear preferencias propias" ON public.gestor_preferencias FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Actualizar preferencias propias" ON public.gestor_preferencias FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
