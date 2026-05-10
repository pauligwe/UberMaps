// Coordinate order: lat,lng (Google uses lat,lng)
const axios = require('axios');

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

// Pick the route with the earliest arrival_time across all alternatives
function earliestArrivalRoute(routes) {
  return routes.reduce((best, r) =>
    r.legs[0].arrival_time.value < best.legs[0].arrival_time.value ? r : best
  );
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
    throw new Error(`Google Directions request failed: ${err.message}`);
  }
  return response.data;
}

async function getTransitTime(originLat, originLng, stopLat, stopLng, departureTimeISO) {
  const departureUnix = Math.floor(new Date(departureTimeISO).getTime() / 1000);
  const data = await callDirections({
    origin: `${originLat},${originLng}`,
    destination: `${stopLat},${stopLng}`,
    mode: 'transit',
    departure_time: departureUnix,
    alternatives: true,
    key: process.env.GOOGLE_MAPS_API_KEY,
  });

  if (data.status === 'ZERO_RESULTS') throw new Error('ZERO_RESULTS');
  if (data.status === 'REQUEST_DENIED') throw new Error('Google API key is invalid or missing');
  if (data.status === 'OVER_DAILY_LIMIT' || data.status === 'OVER_QUERY_LIMIT') throw new Error('Google API quota exceeded');
  if (data.status !== 'OK') throw new Error(`Google Directions error: ${data.status}`);

  const best = earliestArrivalRoute(data.routes);
  const leg = best.legs[0];
  return {
    durationMin: Math.ceil(leg.duration.value / 60),
    departureTime: leg.departure_time.text,
    arrivalTime: leg.arrival_time.text,
    arrivalUnix: leg.arrival_time.value,
    encodedPolyline: best.overview_polyline.points,
    steps: extractSteps(leg),
  };
}

// Full origin→destination transit route (for baseline comparison)
async function getFullTransitRoute(originLat, originLng, destLat, destLng, departureTimeISO) {
  const departureUnix = Math.floor(new Date(departureTimeISO).getTime() / 1000);
  const data = await callDirections({
    origin: `${originLat},${originLng}`,
    destination: `${destLat},${destLng}`,
    mode: 'transit',
    departure_time: departureUnix,
    alternatives: true,
    key: process.env.GOOGLE_MAPS_API_KEY,
  });

  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') throw new Error(`Google Directions error: ${data.status}`);

  const bestBaseline = earliestArrivalRoute(data.routes);
  const leg = bestBaseline.legs[0];
  return {
    durationMin: Math.ceil(leg.duration.value / 60),
    departureTime: leg.departure_time.text,
    arrivalTime: leg.arrival_time.text,
    arrivalUnix: leg.arrival_time.value,
    encodedPolyline: bestBaseline.overview_polyline.points,
    steps: extractSteps(leg),
  };
}

module.exports = { getTransitTime, getFullTransitRoute };
