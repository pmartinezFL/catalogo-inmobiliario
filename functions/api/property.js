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

function isValidInput(url) {
  return /^https?:\/\/(www\.)?ferrerlanfranchi\.com\.ar\/p\/\d+/.test(url) ||
         /^https?:\/\/ficha\.info\/p\/[a-zA-Z0-9]+/.test(url);
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
    const data = await fetchPropertyData(inputUrl, env);
    return new Response(JSON.stringify(data), {
      headers: { ...CORS, 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: CORS },
    );
  }
}

// ─── Router principal ────────────────────────────────────────────────────────

async function fetchPropertyData(inputUrl, env) {
  const apiKey = env.TOKKO_JWT;
  if (!apiKey) throw new Error('TOKKO_JWT no está configurado. Actualizalo en Cloudflare → Workers → catalogo-fl → Settings → Variables y Secrets.');

  let propertyId = null;

  if (inputUrl.includes('ferrerlanfranchi.com.ar')) {
    // Caso A: URL del sitio web → extraer ID directamente
    propertyId = inputUrl.match(/\/p\/(\d+)/)?.[1];
  } else {
    // Caso B/C: URL de ficha.info → seguir redirecciones
    const res = await fetch(inputUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`La URL respondió con ${res.status}`);
    const finalUrl = res.url;

    if (finalUrl.includes('ferrerlanfranchi.com.ar')) {
      // Redirigió al sitio web → extraer ID
      propertyId = finalUrl.match(/\/p\/(\d+)/)?.[1];
    } else {
      // Se quedó en ficha.info (link para colegas) → scrape HTML
      const html = await res.text();
      return extractPropertyData(html, finalUrl);
    }
  }

  if (!propertyId) throw new Error('No se pudo extraer el ID de propiedad de la URL.');

  return await fetchFromTokkoV1(propertyId, apiKey, inputUrl);
}

// ─── Tokko API v1 (API key permanente, no requiere sesión) ───────────────────

async function fetchFromTokkoV1(propertyId, apiKey, sourceUrl) {
  const url = `https://www.tokkobroker.com/api/v1/property/${propertyId}/?format=json&key=${encodeURIComponent(apiKey)}&lang=es_ar`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tokko API respondió ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.detail) throw new Error(`Tokko API: ${data.detail}`);

  return mapV1Card(data, sourceUrl);
}

function mapV1Card(d, sourceUrl) {
  // Precio
  const op       = (d.operations || [])[0] || {};
  const priceObj = (op.prices || [])[0] || {};
  const currency = priceObj.currency || '';
  const amount   = priceObj.price || 0;
  const price    = amount
    ? `${currency} ${Number(amount).toLocaleString('es-AR')}`
    : '';
  const priceLabel = op.operation_type || '';

  // Fotos — portada primero, luego las demás, máx 8
  const sortedPhotos = (d.photos || []).slice().sort((a, b) =>
    (b.is_front_cover ? 1 : 0) - (a.is_front_cover ? 1 : 0)
  );
  const images     = sortedPhotos.map(p => p.image).filter(Boolean).slice(0, 8);
  const coverImage = images[0] || '';
  const coverImageOg =
    sortedPhotos.find(p => p.is_front_cover)?.social_media_url || coverImage;

  // Ubicación: "Valle del Golf | Malagueño | Santa Maria" → invertir para mostrar ciudad primero
  const locParts = (d.location?.short_location || '').split(' | ').filter(Boolean);
  const location = locParts.reverse().join(' | ');

  // Estado
  const statusMap = { 2: '', 3: 'Reservado', 4: 'Vendido', 5: 'Pausado', 6: 'Alquilado' };
  const status = statusMap[d.status] || '';

  // Atributos
  const surf   = d.total_surface    ? `${parseFloat(d.total_surface).toLocaleString('es-AR')} m2 construido` : '';
  const rooms  = d.room_amount      ? `${d.room_amount} ambiente${d.room_amount !== 1 ? 's' : ''}`            : '';
  const beds   = d.suite_amount     ? `${d.suite_amount} dormitorio${d.suite_amount !== 1 ? 's' : ''}`        : '';
  const baths  = d.bathroom_amount  ? `${d.bathroom_amount} baño${d.bathroom_amount !== 1 ? 's' : ''}`        : '';
  const park   = d.parking_lot_amount ? `${d.parking_lot_amount} cochera${d.parking_lot_amount !== 1 ? 's' : ''}` : '';

  const branch   = d.branch   || {};
  const producer = d.producer || {};

  return {
    url:         d.public_url || sourceUrl,
    title:       d.publication_title || d.address || d.fake_address || '',
    address:     d.address || d.fake_address || '',
    location,
    type:        d.type?.name || '',
    status,
    price, priceLabel, coverImage, coverImageOg, images,
    attributes:  { totalSurface: surf, rooms, bedrooms: beds, bathrooms: baths, parking: park },
    company:     { name: branch.display_name || branch.name || '', logo: branch.logo || '' },
    agent:       { name: producer.name || '', phone: producer.cellphone || producer.phone || '', email: producer.email || '' },
    _own: true,   // propiedad propia (Tokko v1) → usar nuestro logo en el catálogo
  };
}

// ─── Scraping ficha.info (fallback para links "para colegas") ────────────────

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
    } catch { /* intentar siguiente chunk */ }
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

  const toUrl = (x) => !x ? '' : typeof x === 'string' ? x : (x.url || x.src || '');

  const propPics = prop.pictures  || {};
  const editPics = edited.pictures || {};
  const coverImage =
    toUrl(editPics.front_cover_image?.url || editPics.front_cover_image) ||
    toUrl(propPics.front_cover_image?.url || propPics.front_cover_image) ||
    toUrl((propPics.images || [])[0]) || '';
  const coverImageOg =
    editPics.front_cover_image?.social_media_url ||
    propPics.front_cover_image?.social_media_url ||
    toUrl((propPics.images_social_media || [])[0]) ||
    coverImage;

  const rawImgs = [
    ...(editPics.images || []),
    ...(propPics.images || []),
  ].map(toUrl).filter(Boolean);

  let images;
  if (rawImgs.length > 1) {
    images = [...new Set([coverImage, ...rawImgs].filter(Boolean))].slice(0, 8);
  } else {
    images = extractTokkoImageUrls(JSON.stringify(data), coverImage);
  }

  return {
    url:        edited.url || sourceUrl,
    title:      edited.title || prop.address || '',
    address:    prop.address || prop.fake_address || '',
    location:   prop.location || '',
    type:       prop.type?.name   || '',
    status:     prop.status?.name || '',
    price, priceLabel, coverImage, coverImageOg, images,
    attributes: {
      totalSurface: attrs.total_surface       || '',
      rooms:        attrs.room_amount         || '',
      bedrooms:     attrs.suite_amount        || '',
      bathrooms:    attrs.bathroom_amount     || '',
      parking:      attrs.parking_lot_amount  || '',
    },
    company: { name: company.name || '', logo: company.logo || data.company_logo || '' },
    _own: false,  // ficha de colega (scraping) → no usar este logo en el header
    agent:   {
      name:  data.user?.name || '',
      phone: data.user?.cellphone || data.user?.phone || '',
      email: data.user?.email || '',
    },
  };
}

function extractTokkoImageUrls(jsonStr, coverImage) {
  const seen = new Set();
  const imgs = [];
  const rx = /https:\/\/static\.tokkobroker\.com\/(?:pictures|fotos)\/[^"\\]+\.(?:jpe?g|png|webp|gif)/gi;
  let m;
  while ((m = rx.exec(jsonStr)) !== null) {
    const url = m[0];
    if (/thumbnail|_thumb|\/sm\/|social_media/i.test(url)) continue;
    if (!seen.has(url)) { seen.add(url); imgs.push(url); }
  }
  if (coverImage && !seen.has(coverImage)) imgs.unshift(coverImage);
  else if (coverImage && imgs[0] !== coverImage) {
    const idx = imgs.indexOf(coverImage);
    if (idx > 0) imgs.splice(idx, 1);
    imgs.unshift(coverImage);
  }
  return imgs.slice(0, 8);
}

function metaFallback(html, sourceUrl) {
  const g = (rx) => html.match(rx)?.[1] || '';
  return {
    url: sourceUrl,
    title:    g(/<title[^>]*>([^<]+)/i),
    address:  g(/<title[^>]*>([^<]+)/i),
    location: '', type: '', status: '', price: '', priceLabel: '',
    coverImage: g(/property="og:image" content="([^"]+)"/),
    images: [],
    attributes: {},
    company: { name: '', logo: '' },
    agent:   { name: '', phone: '', email: '' },
  };
}
