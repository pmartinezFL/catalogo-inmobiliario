const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

const FETCH_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Accept:            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9',
};

// ─── Accepted URL patterns ───────────────────────────────────────────────────
// 1. http(s)://www.ferrerlanfranchi.com.ar/p/DIGITS(-anything)?
// 2. https://ficha.info/p/HEX (para-colegas OR regular — both accepted)
function isValidInput(url) {
  return /^https?:\/\/(www\.)?ferrerlanfranchi\.com\.ar\/p\/\d+/.test(url) ||
         /^https?:\/\/ficha\.info\/p\/[a-f0-9]+/.test(url);
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS });
  }

  const inputUrl = new URL(request.url).searchParams.get('url');

  if (!inputUrl || !isValidInput(inputUrl)) {
    return new Response(
      JSON.stringify({ error: 'URL inválida. Usá un link de ficha.info o del sitio web de la propiedad.' }),
      { status: 400, headers: CORS },
    );
  }

  try {
    const { html, resolvedUrl } = await resolveToColleagueHtml(inputUrl, env);
    const data = extractPropertyData(html, resolvedUrl);
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: CORS },
    );
  }
}

// ─── URL resolution ──────────────────────────────────────────────────────────

/**
 * Always returns the HTML of the "para colegas" ficha.info page.
 * Three input cases:
 *   A) ferrerlanfranchi.com.ar/p/ID  → get colleague link from Tokko, fetch it
 *   B) ficha.info/p/HASH (non-colegas, redirects to website) → extract ID, Tokko, fetch
 *   C) ficha.info/p/HASH (para colegas, stays on ficha.info) → use directly
 */
async function resolveToColleagueHtml(inputUrl, env) {
  // ── Case A: website URL ───────────────────────────────────────────────────
  if (inputUrl.includes('ferrerlanfranchi.com.ar')) {
    const id = inputUrl.match(/\/p\/(\d+)/)?.[1];
    if (!id) throw new Error('No se pudo extraer el ID de propiedad de la URL.');
    const fichaUrl = await getColleagueLink(id, env);
    const res = await fetch(fichaUrl, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`ficha.info respondió con ${res.status}`);
    return { html: await res.text(), resolvedUrl: fichaUrl };
  }

  // ── Cases B & C: ficha.info URL ────────────────────────────────────────────
  const res = await fetch(inputUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`La URL respondió con ${res.status}`);

  const finalUrl = res.url;

  // Case B: ficha.info redirected us to the website → need Tokko lookup
  if (!finalUrl.includes('ficha.info')) {
    const id = finalUrl.match(/\/p\/(\d+)/)?.[1];
    if (!id) throw new Error('No se pudo extraer el ID de propiedad tras la redirección.');
    const fichaUrl = await getColleagueLink(id, env);
    const res2 = await fetch(fichaUrl, { headers: FETCH_HEADERS });
    if (!res2.ok) throw new Error(`ficha.info respondió con ${res2.status}`);
    return { html: await res2.text(), resolvedUrl: fichaUrl };
  }

  // Case C: already on ficha.info (para colegas) → use as-is
  return { html: await res.text(), resolvedUrl: finalUrl };
}

// ─── Tokko API ───────────────────────────────────────────────────────────────

async function getColleagueLink(propertyId, env) {
  const jwt = env.TOKKO_JWT;
  if (!jwt) throw new Error('TOKKO_JWT no está configurado en el servidor. Actualizalo en Cloudflare → Workers → catalogo-fl → Bindings.');

  const apiUrl =
    `https://www.tokkobroker.com/api3/property/get_ficha_info_url` +
    `?properties_id=${propertyId}&is_edited=False&for_colleague=True&is_for_edit=False`;

  const res = await fetch(apiUrl, {
    headers: {
      Authorization:  `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Tokko respondió con ${res.status}. El JWT puede haber expirado.`);

  const data = await res.json();
  if (!data.ficha_info_url) throw new Error('Tokko no devolvió el link para colegas.');
  return data.ficha_info_url;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

function extractPropertyData(html, sourceUrl) {
  const pushRx = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;

  while ((m = pushRx.exec(html)) !== null) {
    try {
      const content = JSON.parse(`"${m[1]}"`);
      if (!content.includes('"hash"') || !content.includes('"property"')) continue;
      const dataKey = '"data":';
      const idx = content.indexOf(dataKey);
      if (idx === -1) continue;
      const jsonStr = extractObject(content, idx + dataKey.length);
      if (!jsonStr) continue;
      return mapCard(JSON.parse(jsonStr), sourceUrl);
    } catch {
      // try next chunk
    }
  }

  return metaFallback(html, sourceUrl);
}

function extractObject(str, start) {
  if (str[start] !== '{') return null;
  let depth = 0, inStr = false, i = start;
  while (i < str.length) {
    const ch = str[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '"')   inStr = false;
    } else {
      if (ch === '"')  inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
    }
    i++;
  }
  return null;
}

function mapCard(data, sourceUrl) {
  const prop    = data.property     || {};
  const edited  = data.edited_ficha || {};
  const company = prop.company      || {};

  const ops        = edited.operations || prop.operations || {};
  const rawPrice   = ops.Sale?.[0] || ops.Rent?.[0] || ops['Temporary Rent']?.[0] || '';
  const price      = String(rawPrice).replace(/\$+/, '$').trim();
  const priceLabel = ops.Sale ? 'Venta' : ops.Rent ? 'Alquiler' : ops['Temporary Rent'] ? 'Alquiler temporal' : '';

  const attrs = {};
  for (const a of prop.attributes_list || []) attrs[a.attr] = a.value;

  const propPics = prop.pictures  || {};
  const editPics = edited.pictures || {};
  const coverImage =
    editPics.front_cover_image?.url ||
    propPics.front_cover_image?.url ||
    propPics.images?.[0] || '';
  const coverImageOg =
    editPics.front_cover_image?.social_media_url ||
    propPics.front_cover_image?.social_media_url ||
    propPics.images_social_media?.[0] ||
    coverImage;

  return {
    url:        edited.url || sourceUrl,
    title:      edited.title || prop.address || '',
    address:    prop.address || prop.fake_address || '',
    location:   prop.location || '',
    type:       prop.type?.name   || '',
    status:     prop.status?.name || '',
    price, priceLabel, coverImage, coverImageOg,
    attributes: {
      totalSurface: attrs.total_surface       || '',
      rooms:        attrs.room_amount         || '',
      bedrooms:     attrs.suite_amount        || '',
      bathrooms:    attrs.bathroom_amount     || '',
      parking:      attrs.parking_lot_amount  || '',
    },
    company: { name: company.name || '', logo: company.logo || data.company_logo || '' },
    agent:   {
      name:  data.user?.name || '',
      phone: data.user?.cellphone || data.user?.phone || '',
      email: data.user?.email || '',
    },
  };
}

function metaFallback(html, sourceUrl) {
  const g = (rx) => html.match(rx)?.[1] || '';
  return {
    url: sourceUrl,
    title:    g(/<title[^>]*>([^<]+)/i),
    address:  g(/<title[^>]*>([^<]+)/i),
    location: '', type: '', status: '', price: '', priceLabel: '',
    coverImage: g(/property="og:image" content="([^"]+)"/),
    attributes: {},
    company: { name: '', logo: '' },
    agent:   { name: '', phone: '', email: '' },
  };
}
