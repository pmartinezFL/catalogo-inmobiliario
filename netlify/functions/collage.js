const Jimp = require('jimp');

const W = 1200, H = 630, HW = 600, HH = 315;

const SLOTS = [
  { x: 0,  y: 0   },
  { x: HW, y: 0   },
  { x: 0,  y: HH  },
  { x: HW, y: HH  },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=3600',
};

exports.handler = async function (event) {
  const p    = event.queryStringParameters || {};
  const urls = [p.u0, p.u1, p.u2, p.u3]
    .filter(u => u && u.startsWith('https://static.tokkobroker.com/'));

  if (!urls.length) {
    return { statusCode: 400, body: 'No URLs válidas' };
  }

  try {
    // Navy background
    const canvas = new Jimp(W, H, 0x12294aff);

    // Fetch and composite up to 4 images
    await Promise.allSettled(
      urls.slice(0, 4).map(async (url, i) => {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        const img = await Jimp.read(buf);
        img.cover(HW, HH); // crop to slot size (cover fit)
        canvas.composite(img, SLOTS[i].x, SLOTS[i].y);
      })
    );

    // Thin white dividers between slots
    for (let xx = 0; xx < W; xx++) canvas.setPixelColor(0xffffff22, xx, HH);
    for (let yy = 0; yy < H; yy++) canvas.setPixelColor(0xffffff22, HW, yy);

    const jpeg = await canvas.getBufferAsync(Jimp.MIME_JPEG);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'image/jpeg' },
      body: jpeg.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: err.message,
    };
  }
};
