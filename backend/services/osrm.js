// CRITICAL: OSRM URL takes lng,lat order (longitude FIRST), not lat,lng
const axios = require('axios');

const OSRM_BASE = 'http://router.project-osrm.org/route/v1/driving';

// In-memory cache keyed by "fromLat,fromLng->toLat,toLng"
const distanceCache = new Map();
const OSRM_CACHE_TTL_MS = 10 * 60 * 1000;

function decodePoly(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    // GeoJSON order: [lng, lat]
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

async function getRoadDistanceAndDuration(fromLat, fromLng, toLat, toLng) {
  const cacheKey = `${fromLat},${fromLng}->${toLat},${toLng}`;
  const cached = distanceCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < OSRM_CACHE_TTL_MS) return cached.data;
  if (cached) distanceCache.delete(cacheKey);

  const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
  let response;
  try {
    response = await axios.get(url, { timeout: 10000 });
  } catch (err) {
    throw new Error(`OSRM request failed: ${err.message}`);
  }

  if (response.data.code !== 'Ok' || !response.data.routes?.length) {
    throw new Error('OSRM routing failed for this stop');
  }

  const route = response.data.routes[0];
  const result = {
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };

  distanceCache.set(cacheKey, { data: result, ts: Date.now() });
  if (distanceCache.size > 5000) distanceCache.delete(distanceCache.keys().next().value);
  return result;
}

async function getOsrmPolyline(fromLat, fromLng, toLat, toLng) {
  const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=polyline`;
  let response;
  try {
    response = await axios.get(url, { timeout: 10000 });
  } catch (err) {
    throw new Error(`OSRM polyline request failed: ${err.message}`);
  }

  if (response.data.code !== 'Ok' || !response.data.routes?.length) {
    throw new Error('OSRM polyline routing failed');
  }

  const encoded = response.data.routes[0].geometry;
  const coordinates = decodePoly(encoded);
  return { type: 'LineString', coordinates };
}

module.exports = { getRoadDistanceAndDuration, getOsrmPolyline };
