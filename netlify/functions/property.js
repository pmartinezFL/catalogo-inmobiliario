const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const url = event.queryStringParameters?.url;

  if (!url || !/^https:\/\/ficha\.info\/p\/[a-f0-9]+/.test(url)) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: 'URL inválida. Debe ser un link de ficha.info.' }),
    };
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9',
      },
    });

    if (!res.ok) throw new Error(`ficha.info respondió con ${res.status}`);

    const html = await res.text();
    const data = extractPropertyData(html, url);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Cache-Control': 'public, max-age=3600' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ─── Parsing ────────────────────────────────────────────────────────────────

function extractPropertyData(html, sourceUrl) {
  // All property data is embedded as JSON in __next_f.push([1, "..."]) chunks
  const pushRx = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;

  while ((m = pushRx.exec(html)) !== null) {
    try {
      const content = JSON.parse(`"${m[1]}"`); // unescape the inner JSON string

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

// Finds the full JSON object starting at `start` using bracket counting
function extractObject(str, start) {
  if (str[start] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let i = start;

  while (i < str.length) {
    const ch = str[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return str.slice(start, i + 1);
      }
    }
    i++;
  }
  return null;
}

function mapCard(data, sourceUrl) {
  const prop = data.property || {};
  const edited = data.edited_ficha || {};
  const company = prop.company || {};

  const ops = edited.operations || prop.operations || {};
  const price = ops.Sale?.[0] || ops.Rent?.[0] || ops['Temporary Rent']?.[0] || '';
  const priceLabel = ops.Sale ? 'Venta' : ops.Rent ? 'Alquiler' : ops['Temporary Rent'] ? 'Alquiler temporal' : '';

  const attrs = {};
  for (const a of prop.attributes_list || []) attrs[a.attr] = a.value;

  const propPics = prop.pictures || {};
  const editPics = edited.pictures || {};
  const coverImage =
    editPics.front_cover_image?.url ||
    propPics.front_cover_image?.url ||
    propPics.images?.[0] || '';

  return {
    url: edited.url || sourceUrl,
    title: edited.title || prop.address || '',
    address: prop.address || prop.fake_address || '',
    location: prop.location || '',
    type: prop.type?.name || '',
    status: prop.status?.name || '',
    price,
    priceLabel,
    coverImage,
    attributes: {
      totalSurface: attrs.total_surface || '',
      rooms: attrs.room_amount || '',
      bedrooms: attrs.suite_amount || '',
      bathrooms: attrs.bathroom_amount || '',
      parking: attrs.parking_lot_amount || '',
    },
    company: {
      name: company.name || '',
      logo: company.logo || data.company_logo || '',
    },
    agent: {
      name: data.user?.name || '',
      phone: data.user?.cellphone || data.user?.phone || '',
      email: data.user?.email || '',
    },
  };
}

function metaFallback(html, sourceUrl) {
  const g = (rx) => html.match(rx)?.[1] || '';
  return {
    url: sourceUrl,
    title: g(/<title[^>]*>([^<]+)/i),
    address: g(/<title[^>]*>([^<]+)/i),
    location: '',
    type: '',
    status: '',
    price: '',
    priceLabel: '',
    coverImage: g(/property="og:image" content="([^"]+)"/),
    attributes: {},
    company: { name: '', logo: '' },
    agent: { name: '', phone: '', email: '' },
  };
}
