// Genera un SVG collage 2×2 con las fotos de portada de las propiedades.
// Usado como og:image — se llama desde el HTML generado con URLs absolutas.

exports.handler = async function (event) {
  const p = event.queryStringParameters || {};
  const urls  = [p.u0, p.u1, p.u2, p.u3].filter(Boolean);
  const title = p.t  || '';
  const count = p.c  || '';

  // Validate all URLs belong to tokkobroker CDN
  for (const u of urls) {
    if (!u.startsWith('https://static.tokkobroker.com/')) {
      return { statusCode: 400, body: 'URL inválida' };
    }
  }

  // Fetch images and convert to base64 data URIs
  const dataUris = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const b64 = Buffer.from(buf).toString('base64');
        const ct  = res.headers.get('content-type') || 'image/jpeg';
        return `data:${ct};base64,${b64}`;
      } catch { return null; }
    })
  );

  const valid = dataUris.filter(Boolean);

  // 2×2 grid layout
  const slots = [
    { x: 0,   y: 0,   w: 600, h: 315 },
    { x: 600, y: 0,   w: 600, h: 315 },
    { x: 0,   y: 315, w: 600, h: 315 },
    { x: 600, y: 315, w: 600, h: 315 },
  ];

  const images = valid.map((src, i) => {
    const { x, y, w, h } = slots[i];
    return `<image href="${src}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
    width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#12294a"/>
  ${images}
  <rect width="1200" height="630" fill="rgba(8,16,32,0.48)"/>
  <line x1="600" y1="0" x2="600" y2="630" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
  <line x1="0" y1="315" x2="1200" y2="315" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
  ${title ? `<text x="600" y="295" text-anchor="middle"
    font-family="-apple-system,Arial,sans-serif" font-weight="bold" font-size="52"
    fill="white" filter="url(#shadow)">${x(title)}</text>` : ''}
  ${count ? `<text x="600" y="358" text-anchor="middle"
    font-family="-apple-system,Arial,sans-serif" font-size="24"
    fill="rgba(255,255,255,0.65)">${x(count)}</text>` : ''}
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="rgba(0,0,0,0.6)"/>
    </filter>
  </defs>
</svg>`;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
    body: svg,
  };
};

function x(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
