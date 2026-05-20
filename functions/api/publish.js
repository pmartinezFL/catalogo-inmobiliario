const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: CORS });
  }

  if (!env.CATALOGS_KV) {
    return new Response(
      JSON.stringify({ error: 'KV no configurado. Vinculá el namespace CATALOGS_KV en Cloudflare.' }),
      { status: 500, headers: CORS },
    );
  }

  let html;
  try {
    ({ html } = await request.json());
    if (!html) throw new Error('html vacío');
  } catch {
    return new Response(JSON.stringify({ error: 'Datos inválidos' }), { status: 400, headers: CORS });
  }

  // 12-char random ID, e.g. "a3f9b2c1d4e5"
  const id  = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  // Keep catalogs 90 days
  await env.CATALOGS_KV.put(id, html, { expirationTtl: 7_776_000 });

  const origin = new URL(request.url).origin;
  const url    = `${origin}/c/${id}`;

  return new Response(JSON.stringify({ url }), { headers: CORS });
}
