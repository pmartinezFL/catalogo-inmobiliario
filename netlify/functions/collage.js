const Jimp = require('jimp');

const W = 1200, H = 630;

// Returns slot layout based on how many images are available
function getSlots(n) {
  if (n === 1) return [
    { x: 0, y: 0, w: W, h: H },
  ];
  if (n === 2) return [
    { x: 0,   y: 0, w: 600, h: H },
    { x: 600, y: 0, w: 600, h: H },
  ];
  if (n === 3) return [
    { x: 0,   y: 0,   w: 600, h: H   },  // left: full height
    { x: 600, y: 0,   w: 600, h: 315 },  // top-right
    { x: 600, y: 315, w: 600, h: 315 },  // bottom-right
  ];
  // 4+: 2×2 grid
  return [
    { x: 0,   y: 0,   w: 600, h: 315 },
    { x: 600, y: 0,   w: 600, h: 315 },
    { x: 0,   y: 315, w: 600, h: 315 },
    { x: 600, y: 315, w: 600, h: 315 },
  ];
}

function drawDividers(canvas, slots) {
  const xs = new Set(slots.map(s => s.x).filter(x => x > 0));
  const ys = new Set(slots.map(s => s.y).filter(y => y > 0));
  for (const x of xs) for (let y = 0; y < H; y++) canvas.setPixelColor(0xffffff22, x, y);
  for (const y of ys) for (let x = 0; x < W; x++) canvas.setPixelColor(0xffffff22, x, y);
}

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

  const slots = getSlots(Math.min(urls.length, 4));

  try {
    const canvas = new Jimp(W, H, 0x12294aff);

    await Promise.allSettled(
      urls.slice(0, slots.length).map(async (url, i) => {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        const img = await Jimp.read(buf);
        img.cover(slots[i].w, slots[i].h);
        canvas.composite(img, slots[i].x, slots[i].y);
      })
    );

    drawDividers(canvas, slots);

    const jpeg = await canvas.getBufferAsync(Jimp.MIME_JPEG);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'image/jpeg' },
      body: jpeg.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: err.message };
  }
};
