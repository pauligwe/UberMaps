// Coordinate order: lat, lng (Overpass uses lat,lng in around filter)
const https = require('https');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const encoded = `data=${encodeURIComponent(body)}`;
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(encoded),
        'Accept': '*/*',
        'User-Agent': 'UberMaps/1.0',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
        } else {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Overpass response is not valid JSON')); }
        }
      });
    });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Overpass request timed out')); });
    req.on('error', reject);
    req.write(encoded);
    req.end();
  });
}

async function fetchStops(lat, lng, radiusMeters) {
  const query = `
[out:json][timeout:25];
(
  node["public_transport"="stop_position"](around:${radiusMeters},${lat},${lng});
  node["highway"="bus_stop"](around:${radiusMeters},${lat},${lng});
);
out body;
`.trim();

  let data;
  try {
    data = await httpsPost(OVERPASS_URL, query);
  } catch (err) {
    console.error(`[overpass] HTTP ${err.status ?? 'ERR'}: ${err.message}`);
    if (err.status === 429 || err.status === 504) {
      throw new Error('Overpass timeout or rate limit — try again shortly');
    }
    throw new Error(`Overpass request failed: ${err.message}`);
  }

  const elements = data.elements || [];

  // Deduplicate by id (both query types can return the same stop)
  const seen = new Set();
  const stops = [];
  for (const el of elements) {
    if (!el.lat || !el.lon) continue;
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    stops.push({
      id: el.id,
      name: el.tags?.name || 'Unnamed Stop',
      lat: el.lat,
      lng: el.lon,
    });
  }

  return stops;
}

module.exports = { fetchStops };
