// Adaptador de solo lectura para Cuba USD Rate API; no reenvía información de usuarios.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const codigos = new Set(['USD', 'EUR', 'MLC', 'CAD', 'MXN', 'ZELLE', 'CLA']);
let cache: { body: string; until: number } | null = null;
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: cors });
  if (cache && cache.until > Date.now()) return new Response(cache.body, { headers: cors });
  try {
    const response = await fetch('https://cubausdrateapi.5-l.cc/api/v2/rates', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Proveedor no disponible');
    const data = await response.json();
    if (data.success !== true || !Array.isArray(data.rates)) throw new Error('Respuesta inválida');
    const rates = data.rates.filter((r: any) => codigos.has(r.code) && typeof r.informal?.cup === 'number' && Number.isFinite(r.informal.cup) && r.informal.cup > 0)
      .map((r: any) => ({ code: r.code, cup: r.informal.cup, scraped_at: r.scraped_at }));
    if (!rates.length) throw new Error('Sin tasas disponibles');
    const body = JSON.stringify({ rates, generated_at: data.generated_at });
    cache = { body, until: Date.now() + 15 * 60 * 1000 };
    return new Response(body, { headers: cors });
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Tasas no disponibles' }), { status: 503, headers: cors });
  }
});
