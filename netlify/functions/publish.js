const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function netlify(method, path, body, contentType = 'application/json') {
  const token = process.env.NETLIFY_TOKEN;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
  };
  if (body !== undefined) {
    opts.body = contentType === 'application/json' ? JSON.stringify(body) : body;
  }
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, opts);
  if (contentType !== 'application/octet-stream') return res.json();
  return res.ok ? { ok: true } : { error: await res.text() };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const token = process.env.NETLIFY_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'NETLIFY_TOKEN no configurado en el servidor.' }),
    };
  }

  let html, rawTitle;
  try {
    ({ html, title: rawTitle } = JSON.parse(event.body));
    if (!html) throw new Error('html vacío');
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Datos inválidos.' }) };
  }

  // Build a URL-safe site name  (max 63 chars, letters/numbers/hyphens, start with letter)
  const base = (rawTitle || 'catalogo')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'catalogo';
  const siteName = `${base}-${Date.now()}`;

  try {
    // 1. Create a new Netlify site
    const site = await netlify('POST', '/sites', { name: siteName });
    if (!site.id) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'No se pudo crear el sitio.', detail: site }),
      };
    }

    // 2. Open a deploy with file digest
    const sha1 = crypto.createHash('sha1').update(html).digest('hex');
    const deploy = await netlify('POST', `/sites/${site.id}/deploys`, {
      files: { '/index.html': sha1 },
    });
    if (!deploy.id) {
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: 'No se pudo iniciar el deploy.', detail: deploy }),
      };
    }

    // 3. Upload the HTML file
    const up = await netlify(
      'PUT',
      `/deploys/${deploy.id}/files/index.html`,
      Buffer.from(html),
      'application/octet-stream',
    );
    if (up.error) {
      return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: up.error }) };
    }

    const url = site.ssl_url || site.url;
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ url }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
