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

  const origin   = new URL(request.url).origin;
  const longUrl  = `${origin}/c/${id}`;
  const shortUrl = await shorten(longUrl);

  return new Response(JSON.stringify({ url: shortUrl }), { headers: CORS });
}

async function shorten(url) {
  try {
    const res = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(4000) },
    );
    if (res.ok) {
      const short = (await res.text()).trim();
      if (short.startsWith('https://tinyurl.com/')) return short;
    }
  } catch { /* si falla, devolvemos el link largo */ }
  return url;
}
