// Coordinate order: lat, lng (Overpass uses lat,lng in around filter)
const https = require('https');

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

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
  let lastErr;
  for (const mirror of OVERPASS_MIRRORS) {
    try {
      data = await httpsPost(mirror, query);
      break;
    } catch (err) {
      console.error(`[overpass] ${mirror} failed: HTTP ${err.status ?? 'ERR'}: ${err.message}`);
      lastErr = err;
    }
  }
  if (!data) {
    if (lastErr?.status === 429 || lastErr?.status === 504) {
      throw new Error('Overpass timeout or rate limit, try again shortly');
    }
    throw new Error(`Overpass request failed: ${lastErr?.message}`);
  }

  const elements = data.elements || [];

  // Deduplicate by id (both query types can return the same stop)
  const seen = new Set();
  const raw = [];
  for (const el of elements) {
    if (!el.lat || !el.lon) continue;
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    raw.push({
      id: el.id,
      name: el.tags?.name || 'Unnamed Stop',
      lat: el.lat,
      lng: el.lon,
    });
  }

  return clusterStops(raw, 250);
}

// Group stops within clusterRadiusM metres of each other, keep one representative per cluster.
// This eliminates redundant stops on the same block without dropping meaningfully different candidates.
function clusterStops(stops, clusterRadiusM) {
  const R = 6371000; // earth radius in metres
  const assigned = new Set();
  const clusters = [];

  for (const stop of stops) {
    if (assigned.has(stop.id)) continue;
    const cluster = [stop];
    assigned.add(stop.id);

    for (const other of stops) {
      if (assigned.has(other.id)) continue;
      const dLat = (other.lat - stop.lat) * Math.PI / 180;
      const dLng = (other.lng - stop.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(stop.lat * Math.PI / 180) * Math.cos(other.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const distM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (distM <= clusterRadiusM) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    // Representative: named stop preferred, otherwise first in cluster
    const rep = cluster.find(s => s.name !== 'Unnamed Stop') ?? cluster[0];
    clusters.push(rep);
  }

  return clusters;
}

module.exports = { fetchStops };
