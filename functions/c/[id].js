export async function onRequest(context) {
  const { params, env } = context;

  if (!env.CATALOGS_KV) {
    return new Response('Configuración pendiente.', { status: 503 });
  }

  const html = await env.CATALOGS_KV.get(params.id);

  if (!html) {
    return new Response('Catálogo no encontrado o expirado.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
