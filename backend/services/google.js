// Coordinate order: lat,lng (Google uses lat,lng)
const axios = require('axios');

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

const DIRECTIONS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const directionsCache = new Map(); // key -> { data, ts }

function getCached(key) {
  const entry = directionsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DIRECTIONS_CACHE_TTL_MS) { directionsCache.delete(key); return null; }
  return entry.data;
}

function setCached(key, data) {
  directionsCache.set(key, { data, ts: Date.now() });
  if (directionsCache.size > 2000) directionsCache.delete(directionsCache.keys().next().value);
}


function extractSteps(leg) {
  return leg.steps.map(step => {
    if (step.travel_mode === 'TRANSIT') {
      const t = step.transit_details;
      return {
        mode: 'TRANSIT',
        line: t.line.short_name || t.line.name,
        vehicle: t.line.vehicle.name,
        headsign: t.headsign,
        departureStop: t.departure_stop.name,
        departureTime: t.departure_time.text,
        arrivalStop: t.arrival_stop.name,
        arrivalTime: t.arrival_time.text,
        numStops: t.num_stops,
        duration: step.duration.text,
        encodedPolyline: step.polyline?.points ?? null,
      };
    }
    // WALKING — strip HTML tags from instructions
    return {
      mode: 'WALKING',
      instruction: step.html_instructions.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      duration: step.duration.text,
      distance: step.distance.text,
      encodedPolyline: step.polyline?.points ?? null,
    };
  });
}

async function callDirections(params) {
  let response;
  try {
    response = await axios.get(DIRECTIONS_URL, { params, timeout: 15000 });
  } catch (err) {
    throw new Error('Google Directions unavailable');
  }
  return response.data;
}

async function getTransitTime(originLat, originLng, stopLat, stopLng, departureTimeISO) {
  const departureUnix = Math.floor(new Date(departureTimeISO).getTime() / 1000);
  const cacheKey = `transit:${originLat},${originLng}->${stopLat},${stopLng}@${departureUnix}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const data = await callDirections({
    origin: `${originLat},${originLng}`,
    destination: `${stopLat},${stopLng}`,
    mode: 'transit',
    departure_time: departureUnix,
    key: process.env.GOOGLE_MAPS_API_KEY,
  });

  if (data.status === 'ZERO_RESULTS') throw new Error('ZERO_RESULTS');
  if (data.status === 'REQUEST_DENIED') throw new Error('Google API key is invalid or missing');
  if (data.status === 'OVER_DAILY_LIMIT' || data.status === 'OVER_QUERY_LIMIT') throw new Error('Google API quota exceeded');
  if (data.status !== 'OK') throw new Error(`Google Directions error: ${data.status}`);
  if (!data.routes?.length) throw new Error('Google returned OK but no routes');

  const best = data.routes[0];
  const leg = best.legs[0];
  const result = {
    durationMin: Math.ceil(leg.duration.value / 60),
    departureTime: leg.departure_time.text,
    arrivalTime: leg.arrival_time.text,
    arrivalUnix: leg.arrival_time.value,
    encodedPolyline: best.overview_polyline.points,
    steps: extractSteps(leg),
  };
  setCached(cacheKey, result);
  return result;
}

// Full origin→destination transit route (for baseline comparison)
async function getFullTransitRoute(originLat, originLng, destLat, destLng, departureTimeISO) {
  const departureUnix = Math.floor(new Date(departureTimeISO).getTime() / 1000);
  const cacheKey = `full:${originLat},${originLng}->${destLat},${destLng}@${departureUnix}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const data = await callDirections({
    origin: `${originLat},${originLng}`,
    destination: `${destLat},${destLng}`,
    mode: 'transit',
    departure_time: departureUnix,
    key: process.env.GOOGLE_MAPS_API_KEY,
  });

  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') throw new Error(`Google Directions error: ${data.status}`);
  if (!data.routes?.length) return null;

  const bestBaseline = data.routes[0];
  const leg = bestBaseline.legs[0];
  const result = {
    durationMin: Math.ceil(leg.duration.value / 60),
    departureTime: leg.departure_time.text,
    arrivalTime: leg.arrival_time.text,
    arrivalUnix: leg.arrival_time.value,
    encodedPolyline: bestBaseline.overview_polyline.points,
    steps: extractSteps(leg),
  };
  setCached(cacheKey, result);
  return result;
}

module.exports = { getTransitTime, getFullTransitRoute };
